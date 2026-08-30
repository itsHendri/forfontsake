import BuildWorker from '../workers/buildFont.worker?worker'
import type { ExtractRequest, ExtractResponse } from '../workers/buildFont.worker'
import type { FontData } from './glyphData'
import { rememberSource } from './glyphData'
import type { LicenceVerdict } from '../engine/extract'

/**
 * Bring in a font of your own.
 *
 * Seven faces is a demo; any face is a tool. The engine never cared where the
 * bytes came from — it is the *page* that assumed they came from `public/`, and
 * this is the small amount of plumbing that stops it assuming.
 *
 * Three things have to happen, and the second is the one that is easy to miss.
 */

export interface Imported {
  id: string
  data: FontData
  licence: { verdict: LicenceVerdict; note: string }
}

/** what the file input should accept, and what we can actually parse */
export const FONT_ACCEPT = '.ttf,.otf,.woff,font/ttf,font/otf,font/woff'
const MAX_BYTES = 12 * 1024 * 1024

let counter = 0

export async function importFont(file: File): Promise<Imported> {
  if (file.size > MAX_BYTES) {
    throw new Error(`${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB — too big to treat in a browser.`)
  }

  const source = await file.arrayBuffer()

  // 1. Read it, in the worker, because that is where the parser lives.
  //    A copy goes to the worker rather than a transfer: the transfer would
  //    detach the buffer here, and these are the very bytes the exporter needs
  //    to rewrite later.
  const extracted = await runExtract(source.slice(0))

  if (Object.keys(extracted.data.glyphs).length === 0) {
    throw new Error(`${file.name} has none of the characters the workbench draws with.`)
  }

  const id = `upload${++counter}`
  const label = extracted.data.licence.familyName || file.name.replace(/\.[^.]+$/, '')

  /*
   * 2. Register the font under the name the specimen field lays its text out
   *    in. This is what keeps the caret between the right letters — mechanism
   *    one. The seven shipped faces get it from a metrics-only woff2 subset cut
   *    at build time; an uploaded one cannot have a subset cut for it, so it
   *    supplies its own metrics, which is exact rather than merely equivalent.
   *    Failing here is not fatal: the type still draws, the caret drifts, and
   *    that is a far better outcome than refusing the font.
   */
  try {
    const face = new FontFace(`ffs-${id}`, source.slice(0))
    await face.load()
    document.fonts.add(face)
  } catch {
    // a face the browser will not load still treats and exports fine
  }

  // 3. Keep the original bytes, because the exporter rewrites *those*, not the
  //    outlines the preview draws with. Nothing else can fetch them later.
  rememberSource(id, source)

  const data: FontData = {
    label,
    note: extracted.data.licence.designer ? `Yours · ${extracted.data.licence.designer}` : 'Yours',
    reserved: extracted.reserved,
    src: `memory:${id}`,
    sourceGlyphs: extracted.data.sourceGlyphs,
    unitsPerEm: extracted.data.unitsPerEm,
    strokeWidth: extracted.data.strokeWidth,
    ascender: extracted.data.ascender,
    descender: extracted.data.descender,
    glyphs: extracted.data.glyphs,
  }

  return { id, data, licence: extracted.licence }
}

type Extracted_ = Extract<ExtractResponse, { ok: true }>

function runExtract(source: ArrayBuffer): Promise<Extracted_> {
  return new Promise((resolve, reject) => {
    const worker = new BuildWorker()
    const done = (fn: () => void) => {
      worker.terminate()
      fn()
    }
    worker.onmessage = (e: MessageEvent<ExtractResponse>) => {
      const msg = e.data
      if (msg.ok) done(() => resolve(msg))
      else done(() => reject(new Error(msg.error || 'that file is not a font we can read')))
    }
    worker.onerror = () => done(() => reject(new Error('that file is not a font we can read')))
    const message: ExtractRequest = { kind: 'extract', source }
    worker.postMessage(message, [source])
  })
}
