import { difference, union, FillRule } from 'clipper2-ts'
import { normalise, pathsToRings, growStrict, roundPaths, simplify, dropTinyAreas } from '../paths'
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
  family: 'structure',
  deterministic: true,
  blurb: 'Hollow the letter, or run a stripe inside the strokes.',
  story:
    'One operation, three results. Offset the shape twice and subtract one copy from '+
    'the other; which two copies you pick decides whether the line sits outside the '+
    'letter, on its boundary, or within its strokes — the inline stripe of Bungee and '+
    'Neutraface Inline.',
  params: [
    { key: 'mode', label: 'Style', min: 0, max: 2, step: 1, default: 0, note: '0 outline · 1 hairline · 2 inline stripe', primary: true, steady: true },
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

    const innerOff = centre - half
    const outer = growStrict(glyph, centre + half)
    const inner = growStrict(glyph, innerOff)
    let result = difference(outer, inner, FillRule.NonZero)

    if (innerOff < 0) {
      // The line weight is a share of the *median* stem, so on a face with any
      // contrast the thin strokes are narrower than the inset that carves the
      // band out of them: they vanish, and the difference then leaves them
      // filled flat with no stripe — or, before growStrict, handed back whole
      // and erased the band entirely. Recover exactly the too-thin regions with
      // a morphological opening and keep them solid. Neutraface puts no inline
      // in a hairline either; the letter staying whole is the honest failure.
      const reopened = growStrict(inner, -innerOff)
      const thin = difference(glyph, reopened, FillRule.NonZero)
      if (thin.length > 0) result = union([...result, ...thin], FillRule.NonZero)
    }

    // near the collapse the band pinches and sheds slivers a font cannot show
    result = dropTinyAreas(result, (half * half) / 2)
    if (result.length === 0) result = outer.length > 0 ? outer : glyph
    result = simplify(result, p.simplify)
    return pathsToRings(result)
  },
}
