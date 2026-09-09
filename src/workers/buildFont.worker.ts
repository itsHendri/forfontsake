/// <reference lib="webworker" />
/**
 * The font parser, off the main thread.
 *
 * Two jobs, both of which need the parser and neither of which should freeze
 * the page: **building** an export (treating three hundred glyphs takes a
 * couple of seconds) and **reading** a font somebody uploaded.
 *
 * They live together because the reason for the worker is the same in both
 * cases — the parser and the writer are the biggest thing in the project, and
 * keeping them here means a visitor who only ever looks at the preview never
 * downloads any of it. Adding upload to this worker costs nothing; giving
 * upload its own would have shipped a second copy.
 */
import { buildTreatedFont, type BuildOptions, type BuildResult } from '../engine/fontio'
import { extractFont, readLicence, guessReserved, type Extracted } from '../engine/extract'
import { toWoff, toWoff2, type WebFontFormat } from '../engine/webfont'
import { brotli, deflate } from '../lib/compress'

export interface BuildRequest {
  kind: 'build'
  source: ArrayBuffer
  chain: BuildOptions['chain']
  names: BuildOptions['names']
  seed: number
  alternates: number
  overrides?: BuildOptions['overrides']
  /**
   * Which containers to hand back. The font is built once whatever this says
   * — the web formats are wrappers over the same bytes — so asking for all
   * three costs a Brotli pass rather than a second treatment run.
   */
  formats: WebFontFormat[]
}

export interface BuiltFile {
  format: WebFontFormat
  bytes: ArrayBuffer
}

export interface ExtractRequest {
  kind: 'extract'
  source: ArrayBuffer
}

export type WorkerRequest = BuildRequest | ExtractRequest

export type BuildResponse =
  | { ok: true; files: BuiltFile[]; stats: Omit<BuildResult, 'bytes'> }
  | { ok: false; error: string }
  | { progress: number }

export type ExtractResponse =
  | {
      ok: true
      data: Extracted
      licence: ReturnType<typeof readLicence>
      reserved: string[]
    }
  | { ok: false; error: string }

const post = (msg: unknown, transfer?: Transferable[]) =>
  (self as DedicatedWorkerGlobalScope).postMessage(msg, transfer ?? [])

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data

  if (req.kind === 'extract') {
    try {
      const data = extractFont(req.source)
      post({
        ok: true,
        data,
        licence: readLicence(data.licence),
        reserved: guessReserved(data.licence.familyName),
      } as ExtractResponse)
    } catch (err) {
      post({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      } as ExtractResponse)
    }
    return
  }

  void (async () => {
    try {
      const result = buildTreatedFont({
        source: req.source,
        chain: req.chain,
        names: req.names,
        seed: req.seed,
        alternates: req.alternates,
        overrides: req.overrides,
        onProgress: (fraction) => post({ progress: fraction } as BuildResponse),
      })
      const { bytes, ...stats } = result

      const files: BuiltFile[] = []
      for (const format of req.formats) {
        // copied out of the pooled buffer so a transfer cannot hand over more
        // than the font itself
        const wrapped =
          format === 'woff'
            ? await toWoff(bytes, deflate)
            : format === 'woff2'
              ? await toWoff2(bytes, brotli)
              : bytes.slice()
        files.push({ format, bytes: wrapped.slice().buffer })
      }
      post({ ok: true, files, stats } as BuildResponse, files.map((f) => f.bytes))
    } catch (err) {
      post({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      } as BuildResponse)
    }
  })()
}
