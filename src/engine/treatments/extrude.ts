import { union, difference, FillRule, type Paths64 } from 'clipper2-ts'
import { normalise, pathsToRings, shift, simplify, SCALE } from '../paths'
import type { Ring } from '../flatten'
import type { Treatment, ParamValues, TreatmentContext } from './types'

/**
 * Extrude — the block shadow under sign-painted and graffiti lettering.
 *
 * The solid is the letter swept along a direction: copies translated in small
 * steps and unioned. Stepping rather than offsetting matters — an offset grows
 * the shape in every direction, where a sweep only fills the corridor the
 * letter travels through, which is what gives the flat-sided look.
 *
 * `layer` picks what comes out. Splitting face from shade is what makes the
 * two-colour version possible later: build the font twice, stack the results.
 */
export const extrude: Treatment = {
  id: 'extrude',
  name: 'Extrude',
  deterministic: true,
  blurb: 'A block shadow swept behind the letter.',
  params: [
    { key: 'depth', label: 'Depth', min: 0, max: 220, step: 1, default: 70, primary: true },
    { key: 'angle', label: 'Angle', min: 0, max: 359, step: 1, default: 315, note: 'degrees, 315 throws it down-right', primary: true },
    { key: 'layer', label: 'Layer', min: 0, max: 2, step: 1, default: 0, note: '0 solid · 1 shade only · 2 face only', primary: true },
    { key: 'simplify', label: 'Simplify', min: 0, max: 4, step: 0.1, default: 0.5 },
  ],

  growth(p) {
    return Math.round(p.depth)
  },

  apply(rings: Ring[], p: ParamValues, ctx: TreatmentContext): Ring[] {
    if (rings.length === 0) return rings
    const glyph = simplify(normalise(rings), 1.5)
    if (glyph.length === 0) return rings
    void ctx

    const mode = Math.round(p.layer)
    if (p.depth <= 0 || mode === 2) return pathsToRings(glyph)

    const rad = (p.angle * Math.PI) / 180
    const dx = Math.cos(rad) * p.depth
    const dy = Math.sin(rad) * p.depth

    // enough steps that consecutive copies overlap rather than leaving gaps;
    // step length is capped so a deep extrude does not cost hundreds of unions
    const stepLen = Math.max(4, p.depth / 40)
    const steps = Math.max(2, Math.ceil(p.depth / stepLen))

    const copies: Paths64 = []
    for (let i = 0; i <= steps; i++) {
      const f = i / steps
      copies.push(...shift(glyph, dx * f, dy * f))
    }
    const swept = union(copies, FillRule.NonZero)
    if (swept.length === 0) return pathsToRings(glyph)

    let result = swept
    if (mode === 1) {
      // the shade alone: everything the sweep covers that the letter does not
      const shade = difference(swept, glyph, FillRule.NonZero)
      result = shade.length > 0 ? shade : swept
    }

    void SCALE
    result = simplify(result, p.simplify)
    return pathsToRings(result)
  },
}
