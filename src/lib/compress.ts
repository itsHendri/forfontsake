/**
 * The two compressors the web-font containers need, in a browser.
 *
 * `src/engine/webfont.ts` takes them as arguments rather than importing them,
 * because it is engine code and has to run in the CLI and in tests as well —
 * so this is the browser half of that arrangement, and Node's `zlib` is the
 * other.
 *
 * Brotli is not native to the platform, so it comes from wasm. The import is
 * dynamic: a megabyte of it should reach only the people who ask for a WOFF2,
 * not everybody who opens the page.
 */
import type { Compress } from '../engine/webfont'

/**
 * WOFF wants zlib-wrapped deflate — RFC 1950, not the bare stream. That is
 * what `'deflate'` means here; `'deflate-raw'` is the one that would produce a
 * file every browser rejects.
 */
export const deflate: Compress = async (data) => {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

let brotliReady: Promise<{ compress(data: Uint8Array, options?: { quality: number }): Uint8Array }> | null =
  null

export const brotli: Compress = async (data) => {
  brotliReady ??= import('brotli-wasm').then((m) => m.default)
  const lib = await brotliReady
  // 11 is the slowest setting and the one every font tool ships at: this runs
  // once, on a file somebody is about to put on a website and serve forever.
  return lib.compress(data, { quality: 11 })
}
