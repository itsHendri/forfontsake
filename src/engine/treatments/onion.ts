import { difference, union, FillRule, type Paths64 } from 'clipper2-ts'
import { normalise, pathsToRings, simplify, growStrict, roundPaths } from '../paths'
import type { Ring } from '../flatten'
import type { Treatment, ParamValues, TreatmentContext } from './types'

/**
 * Onion — concentric lines, in and out.
 *
 * Outline draws one band; this draws the whole set, each one inset a step
 * further than the last, until the letter runs out of room to hold another.
 * The rings can also grow outward, which is the halo of a chrome logotype
 * rather than the inline of a Bungee.
 */
export const onion: Treatment = {
  id: 'onion',
  name: 'Onion',
  family: 'structure',
  deterministic: true,
  blurb: 'Line inside line inside line, until the letter runs out of room.',
  story:
    'One offset gives you an outline; the set of them gives you the ringed look of a chrome '+
    'logotype or an engraved banknote. Each ring is the difference of two offsets a step '+
    'apart, and the run simply stops when the next inset collapses — which is why a stem '+
    'carries three rings and a hairline carries one, with no special case for either.',
  params: [
    { key: 'lines', label: 'Lines', min: 1, max: 8, step: 1, default: 3, primary: true },
    { key: 'weight', label: 'Line weight', min: 3, max: 60, step: 1, default: 13, note: '% of stroke width', primary: true },
    { key: 'gap', label: 'Gap', min: 3, max: 60, step: 1, default: 13, note: 'space between the lines', primary: true },
    { key: 'outward', label: 'Outward', min: 0, max: 100, step: 1, default: 0, note: 'grow the rings out of the letter instead of into it', primary: true },
    { key: 'rounding', label: 'Rounding', min: 0, max: 120, step: 1, default: 0 },
    { key: 'simplify', label: 'Simplify', min: 0, max: 4, step: 0.1, default: 0.4 },
  ],

  presets: [
    { name: 'Three rings', values: { lines: 3, weight: 13, gap: 13, outward: 0, rounding: 0, simplify: 0.4 } },
    { name: 'Tight engraving', values: { lines: 6, weight: 7, gap: 7, outward: 0, rounding: 0, simplify: 0.4 } },
    { name: 'Halo', values: { lines: 4, weight: 11, gap: 11, outward: 100, rounding: 0, simplify: 0.4 } },
    { name: 'Wide chrome', values: { lines: 3, weight: 20, gap: 16, outward: 0, rounding: 14, simplify: 0.4 } },
  ],


  growth(p, ctx) {
    const stem = ctx.strokeWidth / 100
    const out = p.outward / 100
    return out * Math.round(p.lines) * (p.weight + p.gap) * stem * 2
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
    // 0 walks inward from the edge, 1 walks outward; between, it does both
    const dir = p.outward / 100

    const bands: Paths64 = []
    for (let k = 0; k < lines; k++) {
      const step = k * (w + gap)
      // the ring's two edges, measured from the original outline
      const a = -step * (1 - dir) + step * dir
      const outer = growStrict(glyph, a + (dir > 0 ? w : 0))
      const inner = growStrict(glyph, a - (dir > 0 ? 0 : w))
      if (outer.length === 0) break
      const band = difference(outer, inner, FillRule.NonZero)
      // an empty band means the letter has no room left for another ring
      if (band.length === 0) break
      bands.push(...band)
    }
    if (bands.length === 0) return pathsToRings(glyph)

    const result = union(bands, FillRule.NonZero)
    if (result.length === 0) return pathsToRings(glyph)
    return pathsToRings(simplify(result, p.simplify))
  },
}
