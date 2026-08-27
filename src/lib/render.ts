import { getTreatment, type ParamValues } from '../engine/treatments/registry'
import { mulberry32 } from '../engine/prng'
import { ringsToPathD } from '../engine/svg'
import type { Ring } from '../engine/flatten'
import { toRings, type Library, type FontData } from './glyphData'

export interface RenderResult {
  /** one SVG path covering the whole line, in font units, y-up */
  d: string
  width: number
  ascender: number
  descender: number
  unitsPerEm: number
  contours: number
  ms: number
}

export interface GlyphResult {
  ch: string
  /** path for this glyph alone, drawn from its own origin */
  d: string
  adv: number
}

export interface GlyphSet {
  glyphs: GlyphResult[]
  ascender: number
  descender: number
  unitsPerEm: number
  ms: number
}

export interface RenderRequest {
  library: Library
  fontId: string
  treatmentId: string
  text: string
  params: ParamValues
  seed: number
  /**
   * How many differently-cut versions of each letter exist. With one, every `o`
   * in a word is identical and the eye reads the repetition as a pattern; with
   * three they cycle and the line stops looking stamped.
   */
  alternates?: number
}

/**
 * One glyph, treated. The seed is derived from the character and its variant so
 * a letter always comes out the same way wherever it appears in a line.
 */
function treat(
  data: FontData,
  treatmentId: string,
  rings: number[][],
  adv: number,
  params: ParamValues,
  seed: number,
  ch: string,
  variant: number,
  penX: number,
): Ring[] {
  const charSeed = seed + (ch.codePointAt(0) ?? 0) * 7919 + variant * 104729
  return getTreatment(treatmentId).apply(toRings(rings), params, {
    rng: mulberry32(charSeed),
    unitsPerEm: data.unitsPerEm,
    strokeWidth: data.strokeWidth || data.unitsPerEm * 0.1,
    advanceWidth: adv,
    penX,
  })
}

export function render({
  library,
  fontId,
  treatmentId,
  text,
  params,
  seed,
  alternates = 1,
}: RenderRequest): RenderResult {
  const t0 = performance.now()
  const data = library[fontId] ?? Object.values(library)[0]
  const treatment = getTreatment(treatmentId)
  const variants = treatment.deterministic ? 1 : Math.max(1, Math.round(alternates))

  const seen = new Map<string, number>()
  const cache = new Map<string, { rings: Ring[]; contours: number }>()
  let penX = 0
  let d = ''
  let contours = 0

  for (const ch of text) {
    const g = data.glyphs[ch]
    if (!g) continue
    if (g.rings.length > 0) {
      // cycle through the cuts as a letter repeats
      const nth = seen.get(ch) ?? 0
      seen.set(ch, nth + 1)
      const variant = nth % variants

      const key = `${ch}/${variant}`
      let entry = cache.get(key)
      if (!entry) {
        const rings = treat(data, treatmentId, g.rings, g.adv, params, seed, ch, variant, penX)
        entry = { rings, contours: rings.length }
        cache.set(key, entry)
      }
      contours += entry.contours
      d += ringsToPathD(entry.rings, penX, 0)
    }
    penX += g.adv
  }

  return {
    d,
    width: penX,
    ascender: data.ascender,
    descender: data.descender,
    unitsPerEm: data.unitsPerEm,
    contours,
    ms: performance.now() - t0,
  }
}

/** capitals, lowercase, figures, punctuation — how a specimen sheet reads */
const GLYPH_ORDER = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  ...'abcdefghijklmnopqrstuvwxyz',
  ...'0123456789',
  ...".,!?&'-",
]

/**
 * Every glyph in the font, treated once each — the specimen grid.
 *
 * Deliberately independent of the typed text so that typing never pays for it;
 * it only changes when the font, treatment, dials or seed do. Always the first
 * cut of each letter, because a grid is a reference sheet rather than a sample
 * of the variation.
 */
export function renderGlyphSet(
  library: Library,
  fontId: string,
  treatmentId: string,
  params: ParamValues,
  seed: number,
): GlyphSet {
  const t0 = performance.now()
  const data = library[fontId] ?? Object.values(library)[0]
  const glyphs: GlyphResult[] = []

  // Iterated in specimen order rather than the object's own: JavaScript hoists
  // integer-like keys to the front, which would open the grid on the digits.
  for (const ch of GLYPH_ORDER) {
    const g = data.glyphs[ch]
    if (!g || g.rings.length === 0) continue // absent, or space and its like
    const rings = treat(data, treatmentId, g.rings, g.adv, params, seed, ch, 0, 0)
    glyphs.push({ ch, d: ringsToPathD(rings, 0, 0), adv: g.adv })
  }

  return {
    glyphs,
    ascender: data.ascender,
    descender: data.descender,
    unitsPerEm: data.unitsPerEm,
    ms: performance.now() - t0,
  }
}
