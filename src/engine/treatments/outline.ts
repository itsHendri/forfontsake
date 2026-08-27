import { difference, FillRule } from 'clipper2-ts'
import { normalise, pathsToRings, grow, roundPaths, simplify } from '../paths'
import type { Ring } from '../flatten'
import type { Treatment, ParamValues, TreatmentContext } from './types'

/**
 * Outline — hollow the letter, or run a line inside it.
 *
 * Both come from the same operation: offset the shape and subtract one copy
 * from another. Which two copies you pick decides whether the line sits outside
 * the letter (outline), on its boundary (hairline) or within its strokes
 * (inline, the Bungee/Neutraface stripe).
 */
export const outline: Treatment = {
  id: 'outline',
  name: 'Outline',
  deterministic: true,
  blurb: 'Hollow the letter, or run a stripe inside the strokes.',
  params: [
    { key: 'mode', label: 'Style', min: 0, max: 2, step: 1, default: 0, note: '0 outline · 1 hairline · 2 inline stripe', primary: true },
    { key: 'weight', label: 'Line weight', min: 3, max: 150, step: 1, default: 22, note: '% of stroke width', primary: true },
    { key: 'inset', label: 'Position', min: -100, max: 100, step: 1, default: 0, note: 'push the line out of or into the letter', primary: true },
    { key: 'rounding', label: 'Rounding', min: 0, max: 130, step: 1, default: 0, primary: true },
    { key: 'simplify', label: 'Simplify', min: 0, max: 4, step: 0.1, default: 0.4 },
  ],

  presets: [
    { name: 'Hollow', values: { mode: 0, weight: 22, inset: 0, rounding: 0, simplify: 0.4 } },
    { name: 'Hairline', values: { mode: 1, weight: 5, inset: 0, rounding: 0, simplify: 0.3 } },
    { name: 'Inline', values: { mode: 2, weight: 12, inset: -5, rounding: 0, simplify: 0.4 } },
    { name: 'Halo', values: { mode: 0, weight: 15, inset: 25, rounding: 20, simplify: 0.5 } },
  ],

  growth(p, ctx) {
    // only the outward-facing styles push past the original silhouette
    const stem = ctx.strokeWidth / 100
    const outward = p.mode === 2 ? 0 : (p.weight / 2 + Math.max(0, p.inset)) * stem
    return outward * 2
  },

  apply(rings: Ring[], p: ParamValues, ctx: TreatmentContext): Ring[] {
    if (rings.length === 0) return rings
    let glyph = simplify(normalise(rings), 1.5)
    if (glyph.length === 0) return rings
    // widths as shares of the stem, so a line weight means the same thing on
    // every face rather than vanishing on heavy ones
    const stem = ctx.strokeWidth / 100
    if (p.rounding > 0) glyph = roundPaths(glyph, p.rounding * stem)

    const half = (p.weight * stem) / 2
    const mode = Math.round(p.mode)
    const inset = p.inset * stem

    // where the band sits relative to the original edge
    const centre = mode === 0 ? half + inset : mode === 1 ? inset : -half + inset

    const outer = grow(glyph, centre + half)
    const inner = grow(glyph, centre - half)
    let result = difference(outer, inner, FillRule.NonZero)

    if (result.length === 0) result = outer
    result = simplify(result, p.simplify)
    return pathsToRings(result)
  },
}
