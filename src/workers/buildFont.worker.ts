/// <reference lib="webworker" />
/**
 * Builds the exported font off the main thread.
 *
 * Treating three hundred glyphs takes a couple of seconds, which is fine to
 * wait for and not fine to freeze the page for. The font writer and its parser
 * live in here rather than in the page bundle, so a visitor who only ever looks
 * at the preview never runs any of it.
 */
import { buildTreatedFont, type BuildOptions, type BuildResult } from '../engine/fontio'

export interface BuildRequest {
  source: ArrayBuffer
  chain: BuildOptions['chain']
  names: BuildOptions['names']
  seed: number
  alternates: number
}

export type BuildResponse =
  | { ok: true; bytes: ArrayBuffer; stats: Omit<BuildResult, 'bytes'> }
  | { ok: false; error: string }
  | { progress: number }

self.onmessage = (e: MessageEvent<BuildRequest>) => {
  const req = e.data
  try {
    const result = buildTreatedFont({
      source: req.source,
      chain: req.chain,
      names: req.names,
      seed: req.seed,
      alternates: req.alternates,
      onProgress: (fraction) => {
        ;(self as DedicatedWorkerGlobalScope).postMessage({ progress: fraction } as BuildResponse)
      },
    })
    const { bytes, ...stats } = result
    // copied out of the pooled buffer so the transfer cannot hand over more
    // than the font itself
    const out = bytes.slice().buffer
    ;(self as DedicatedWorkerGlobalScope).postMessage({ ok: true, bytes: out, stats } as BuildResponse, [out])
  } catch (err) {
    ;(self as DedicatedWorkerGlobalScope).postMessage({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    } as BuildResponse)
  }
}
