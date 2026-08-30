import { getTreatment, applyChain } from '../engine/treatments/registry'
import { mulberry32 } from '../engine/prng'
import { ringsToPathD } from '../engine/svg'
import type { Ring } from '../engine/flatten'
import { toRings, type Library, type FontData } from './glyphData'
import type { Step } from './urlState'

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
  /** treatments in order, each working on what the last one produced */
  chain: Step[]
  text: string
  seed: number
  /**
   * How many differently-cut versions of each letter exist. With one, every `o`
   * in a word is identical and the eye reads the repetition as a pattern; with
   * three they cycle and the line stops looking stamped.
   */
  alternates?: number
}

/**
 * One glyph, put through the whole stack. The seed is derived from the
 * character and its variant so a letter always comes out the same way wherever
 * it appears in a line.
 *
 * One context — and therefore one random stream — is shared across every step,
 * exactly as `buildTreatedFont` does it. That is not an incidental detail: each
 * treatment draws from the stream as it goes, so giving the second step a fresh
 * rng here would make the preview and the exported font disagree about the same
 * settings, which is the one thing this tool cannot afford.
 */
function treat(
  data: FontData,
  chain: Step[],
  rings: number[][],
  adv: number,
  seed: number,
  ch: string,
  variant: number,
  penX: number,
): Ring[] {
  const charSeed = seed + (ch.codePointAt(0) ?? 0) * 7919 + variant * 104729
  const ctx = {
    rng: mulberry32(charSeed),
    unitsPerEm: data.unitsPerEm,
    strokeWidth: data.strokeWidth || data.unitsPerEm * 0.1,
    advanceWidth: adv,
    penX,
  }
  return applyChain(toRings(rings), chain, ctx)
}

export function render({
  library,
  fontId,
  chain,
  text,
  seed,
  alternates = 1,
}: RenderRequest): RenderResult {
  const t0 = performance.now()
  const data = library[fontId] ?? Object.values(library)[0]
  // Cutting alternates is only worth the work if something in the stack
  // consumes randomness; a wholly deterministic stack would just draw the same
  // letter several times.
  const varies = chain.some((s) => !getTreatment(s.id).deterministic)
  const variants = varies ? Math.max(1, Math.round(alternates)) : 1

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
        const rings = treat(data, chain, g.rings, g.adv, seed, ch, variant, penX)
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
  chain: Step[],
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
    const rings = treat(data, chain, g.rings, g.adv, seed, ch, 0, 0)
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
