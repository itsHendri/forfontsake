import { difference, union, FillRule, type Paths64 } from 'clipper2-ts'
import { normalise, pathsToRings, simplify, growStrict, roundPaths, dropTinyAreas, SCALE } from '../paths'
import { disc } from '../tone'
import type { Ring } from '../flatten'
import type { Treatment, ParamValues, TreatmentContext } from './types'

/**
 * Onion — every ring a letter can carry.
 *
 * One offset gives a band; the set of them gives the ringed look of a chrome
 * logotype or an engraved banknote. Where that band sits relative to the edge
 * is the only difference between an outline, a hairline and the inline stripe
 * of a Bungee, so those are a dial here rather than a treatment of their own —
 * and breaking the band into discs instead of drawing it whole is one more.
 *
 * Four pictures, one construction: the difference of two offsets a step apart.
 */

/**
 * Discs strung along a path at even arc length.
 *
 * The bead is as wide as the line it replaces, so Line weight keeps meaning the
 * same thing whichever way the ring is drawn. Spacing at one diameter puts them
 * shoulder to shoulder, which is the band again; the dial only ever pulls them
 * apart. Every disc is a contour, so they draw from one budget across the whole
 * set rather than per ring.
 */
function beadRing(paths: Paths64, spacing: number, radius: number, budget: { left: number }): Paths64 {
  const out: Paths64 = []
  const sides = radius > SCALE * 10 ? 10 : 8
  for (const ring of paths) {
    let carry = 0
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      if (len <= 0) continue
      let t = carry
      while (t < len) {
        if (budget.left <= 0) return out
        budget.left--
        out.push(disc(a.x + ((b.x - a.x) * t) / len, a.y + ((b.y - a.y) * t) / len, radius, sides))
        t += spacing
      }
      carry = t - len
    }
  }
  return out
}

export const onion: Treatment = {
  id: 'onion',
  name: 'Onion',
  family: 'structure',
  deterministic: true,
  blurb: 'Rings following the letter — hollow, hairline, inline, or a string of beads.',
  story:
    'Each ring is the difference of two offsets a step apart, and the run simply stops when '+
    'the next one collapses — which is why a stem carries three rings and a hairline carries '+
    'one, with no special case for either. Style decides which side of the edge the ring sits '+
    'on: outside is an outline, centred is a hairline, inside is the stripe Bungee and '+
    'Neutraface run through their strokes. Beaded swaps the drawn band for discs of the same '+
    'width, which is the same ring with the ink taken out of the spaces.',
  params: [
    { key: 'style', label: 'Style', min: 0, max: 2, step: 1, default: 0, note: '0 inside · 1 centred · 2 outside', primary: true, steady: true },
    { key: 'lines', label: 'Lines', min: 1, max: 8, step: 1, default: 3, primary: true },
    { key: 'weight', label: 'Line weight', min: 3, max: 150, step: 1, default: 13, note: '% of stroke width', primary: true },
    // 0 draws the band and anything above it draws discs — two constructions,
    // not two ends of one, so the sound leaves it where it was put
    { key: 'beaded', label: 'Beaded', min: 0, max: 100, step: 1, default: 0, note: 'break each ring into discs; 0 draws it whole', primary: true, steady: true },
    { key: 'gap', label: 'Gap', min: 3, max: 60, step: 1, default: 13, note: 'space between the lines' },
    { key: 'position', label: 'Position', min: -100, max: 100, step: 1, default: 0, note: 'push the whole set out of or into the letter' },
    { key: 'rounding', label: 'Rounding', min: 0, max: 130, step: 1, default: 0 },
    { key: 'simplify', label: 'Simplify', min: 0, max: 4, step: 0.1, default: 0.4 },
  ],

  presets: [
    { name: 'Three rings', values: { style: 0, lines: 3, weight: 13, beaded: 0, gap: 13, position: 0, rounding: 0, simplify: 0.4 } },
    { name: 'Tight engraving', values: { style: 0, lines: 6, weight: 7, beaded: 0, gap: 7, position: 0, rounding: 0, simplify: 0.4 } },
    { name: 'Halo', values: { style: 2, lines: 4, weight: 11, beaded: 0, gap: 11, position: 0, rounding: 0, simplify: 0.4 } },
    { name: 'Wide chrome', values: { style: 0, lines: 3, weight: 20, beaded: 0, gap: 16, position: 0, rounding: 14, simplify: 0.4 } },
    { name: 'Hollow', values: { style: 2, lines: 1, weight: 22, beaded: 0, gap: 13, position: 0, rounding: 0, simplify: 0.4 } },
    { name: 'Hairline', values: { style: 1, lines: 1, weight: 5, beaded: 0, gap: 13, position: 0, rounding: 0, simplify: 0.3 } },
    { name: 'Inline', values: { style: 0, lines: 1, weight: 12, beaded: 0, gap: 13, position: -5, rounding: 0, simplify: 0.4 } },
    { name: 'String of beads', values: { style: 1, lines: 1, weight: 40, beaded: 45, gap: 13, position: 0, rounding: 0, simplify: 0.5 } },
  ],

  growth(p, ctx) {
    const stem = ctx.strokeWidth / 100
    const style = Math.round(p.style)
    const step = Math.max(0, Math.round(p.lines) - 1) * (p.weight + p.gap)
    // only the rings that sit past the original edge widen the silhouette
    const outward = style === 2 ? step + p.weight : style === 1 ? p.weight / 2 : 0
    return (outward + Math.max(0, p.position)) * stem * 2
  },

  apply(rings: Ring[], p: ParamValues, ctx: TreatmentContext): Ring[] {
    if (rings.length === 0) return rings
    let glyph = simplify(normalise(rings), 1.5)
    if (glyph.length === 0) return rings
    const stem = ctx.strokeWidth / 100
    if (p.rounding > 0) glyph = roundPaths(glyph, p.rounding * stem)

    const w = p.weight * stem
    const gap = p.gap * stem
    const lines = Math.max(1, Math.round(p.lines))
    const style = Math.round(p.style)
    const pos = p.position * stem
    const half = w / 2

    // one budget for the whole set: a bead is a contour wherever it lands
    const budget = { left: 240 }
    // beads are walked along the offset paths, which are working-scale, while
    // every dial above is in font units
    const beadR = half * SCALE
    const beadStep = w * (1 + (p.beaded / 100) * 1.6) * SCALE

    const parts: Paths64 = []
    for (let k = 0; k < lines; k++) {
      const step = k * (w + gap)
      // where this ring's centreline sits relative to the original edge
      const centre = (style === 2 ? step + half : style === 1 ? -step : -(step + half)) + pos

      if (p.beaded > 0) {
        const path = growStrict(glyph, centre)
        if (path.length === 0) break
        const beads = beadRing(path, beadStep, beadR, budget)
        if (beads.length === 0) break
        parts.push(...beads)
        continue
      }

      const outer = growStrict(glyph, centre + half)
      if (outer.length === 0) break
      // A stroke narrower than the band cannot hold one: the inner offset
      // collapses there, the difference leaves it filled, and the stroke stays
      // on the page solid. Neutraface puts no inline in a hairline either.
      const inner = growStrict(glyph, centre - half)
      const band = difference(outer, inner, FillRule.NonZero)
      // an empty band means the letter has no room left for another ring
      if (band.length === 0) break
      parts.push(...band)
    }
    if (parts.length === 0) return pathsToRings(glyph)

    let result = union(parts, FillRule.NonZero)
    // Near the collapse a single band pinches and sheds slivers a font cannot
    // show. With rings stacked inside each other the small pieces are the look,
    // so the guard only runs on the one-ring case it was written for.
    if (lines === 1 && p.beaded === 0) result = dropTinyAreas(result, (half * half) / 2)
    if (result.length === 0) return pathsToRings(glyph)
    return pathsToRings(simplify(result, p.simplify))
  },
}
