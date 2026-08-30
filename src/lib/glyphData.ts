import type { Ring } from '../engine/flatten'

export interface FontData {
  label: string
  note: string
  /** OFL Reserved Font Names a derivative of this font may not carry */
  reserved: string[]
  /** path to the original font, which the exporter needs the real bytes of */
  src: string
  /** glyphs in the whole source face — an export treats all of them */
  sourceGlyphs: number
  unitsPerEm: number
  /** median stem width, which every size parameter is measured against */
  strokeWidth: number
  ascender: number
  descender: number
  glyphs: Record<string, { adv: number; rings: number[][] }>
}

export type Library = Record<string, FontData>

declare global {
  interface Window {
    /** present when the page was built as a single self-contained file */
    __GLYPH_DATA__?: Library
    /** source font bytes as data URIs, inlined for the same reason */
    __FONT_SOURCES__?: Record<string, string>
  }
}

/**
 * Outlines are shipped as data rather than parsed from a font in the browser,
 * which keeps the font parser out of the bundle entirely. A published page
 * carries them inline; the dev server fetches them.
 */
export async function loadLibrary(): Promise<Library> {
  if (typeof window !== 'undefined' && window.__GLYPH_DATA__) return window.__GLYPH_DATA__
  const res = await fetch(`${import.meta.env.BASE_URL}glyph-data.json`)
  if (!res.ok) {
    throw new Error(`could not load glyph data (${res.status}) — run: npm run build:workbench`)
  }
  return (await res.json()) as Library
}

/** flat [x,y,x,y,…] back into points */
export function toRings(flat: number[][]): Ring[] {
  return flat.map((r) => {
    const ring: Ring = []
    for (let i = 0; i < r.length; i += 2) ring.push({ x: r[i], y: r[i + 1] })
    return ring
  })
}

/**
 * Uploaded fonts, held for as long as the tab lives.
 *
 * The exporter rewrites the *original bytes*, not the outlines the preview
 * draws with, so a font that came off a file input has to keep them somewhere —
 * there is no URL to fetch them back from. Deliberately not persisted: these
 * are whole font binaries, they are somebody else's licensed property as often
 * as not, and a shelf entry pointing at one that no longer exists already
 * degrades gracefully.
 */
const memorySources = new Map<string, ArrayBuffer>()

export function rememberSource(id: string, bytes: ArrayBuffer): void {
  memorySources.set(id, bytes)
}

/** the `src` an uploaded font carries, in place of a path */
export function isMemorySource(src: string): boolean {
  return src.startsWith('memory:')
}

/**
 * The original bytes of a source font, which the exporter rewrites into a new
 * one. An uploaded font has them in memory; a published single-file page
 * carries the shipped ones inline; everywhere else they are fetched on demand,
 * so nobody downloads a font binary just to look.
 */
export async function loadSource(data: FontData): Promise<ArrayBuffer> {
  if (isMemorySource(data.src)) {
    const held = memorySources.get(data.src.slice('memory:'.length))
    if (!held) {
      throw new Error(`${data.label} is no longer loaded — add the file again.`)
    }
    // a copy, because the export transfers the buffer it is given and would
    // otherwise detach the one we are holding for next time
    return held.slice(0)
  }
  const inlined = typeof window !== 'undefined' ? window.__FONT_SOURCES__?.[data.src] : undefined
  const url = inlined ?? `${import.meta.env.BASE_URL.replace(/\/$/, '')}${data.src}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`could not load ${data.label} (${res.status})`)
  return res.arrayBuffer()
}
