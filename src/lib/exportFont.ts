import BuildWorker from '../workers/buildFont.worker?worker&inline'
import type { BuildRequest, BuildResponse } from '../workers/buildFont.worker'
import { violatesReservedNames } from '../engine/fontio'
import { loadSource, type FontData } from './glyphData'
import type { ParamValues } from '../engine/treatments/registry'

export interface ExportRequest {
  font: FontData
  fontId: string
  treatmentId: string
  treatmentName: string
  params: ParamValues
  seed: number
  alternates: number
  familyName: string
}

export interface ExportResult {
  blob: Blob
  fileName: string
  glyphCount: number
  addedGlyphs: number
  maxPoints: number
  bytes: number
}

/**
 * The name is the one part of an export a person has to supply, because OFL
 * Reserved Font Names make it the one part we cannot choose for them: a
 * derivative of Pirata One may not have "Pirata" anywhere in its name.
 */
export function nameProblem(familyName: string, font: FontData): string | null {
  const name = familyName.trim()
  if (!name) return 'Give the font a name.'
  if (name.length > 60) return 'That name is too long.'
  const hit = violatesReservedNames(name, font.reserved)
  if (hit) {
    return `“${hit}” is a Reserved Font Name of ${font.label} — a font made from it cannot use that word.`
  }
  return null
}

/** a name that is safe by construction, to start people off */
export function suggestName(font: FontData, treatmentName: string): string {
  const base = font.label.split(' ')[0]
  const safe = violatesReservedNames(base, font.reserved) ? '' : base + ' '
  return `${safe}${treatmentName}`.trim() || `${treatmentName} One`
}

export function buildFont(
  req: ExportRequest,
  onProgress?: (fraction: number) => void,
): Promise<ExportResult> {
  return new Promise((resolve, reject) => {
    loadSource(req.font).then((source) => {
      const worker = new BuildWorker()
      const done = (fn: () => void) => {
        worker.terminate()
        fn()
      }

      worker.onmessage = (e: MessageEvent<BuildResponse>) => {
        const msg = e.data
        if ('progress' in msg) {
          onProgress?.(msg.progress)
          return
        }
        if (!msg.ok) {
          done(() => reject(new Error(msg.error)))
          return
        }
        const family = req.familyName.trim()
        done(() =>
          resolve({
            blob: new Blob([msg.bytes], { type: 'font/ttf' }),
            fileName: `${family.replace(/[^A-Za-z0-9]+/g, '')}-Regular.ttf`,
            glyphCount: msg.stats.glyphCount,
            addedGlyphs: msg.stats.addedGlyphs,
            maxPoints: msg.stats.maxPoints,
            bytes: msg.bytes.byteLength,
          }),
        )
      }
      worker.onerror = (e) => done(() => reject(new Error(e.message || 'the font builder failed')))

      const message: BuildRequest = {
        source,
        chain: [{ id: req.treatmentId, params: req.params }],
        seed: req.seed,
        alternates: req.alternates,
        names: {
          familyName: req.familyName.trim(),
          styleName: 'Regular',
          designer: '',
          copyright:
            `Derived from ${req.font.label}` +
            (req.font.reserved.length
              ? `, with Reserved Font Name ${req.font.reserved.map((r) => `"${r}"`).join(', ')}.`
              : '.'),
          description: "Generated with FOR FONT'S SAKE (forfontsake.xyz).",
          license: 'This Font Software is licensed under the SIL Open Font License, Version 1.1.',
          licenseURL: 'https://openfontlicense.org',
          version: 'Version 1.000',
        },
      }
      worker.postMessage(message, [source])
    }, reject)
  })
}

/** hand the finished font to the browser's downloader */
export function save(result: ExportResult) {
  const url = URL.createObjectURL(result.blob)
  const a = document.createElement('a')
  a.href = url
  a.download = result.fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  // revoked on the next turn of the loop, once the download has taken the URL
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
