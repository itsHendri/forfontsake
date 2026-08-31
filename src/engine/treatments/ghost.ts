import { union, intersect, difference, FillRule, type Paths64 } from 'clipper2-ts'
import { normalise, pathsToRings, simplify, shift } from '../paths'
import type { Ring } from '../flatten'
import type { Treatment, ParamValues, TreatmentContext } from './types'

/**
 * Ghost — the plate out of register.
 *
 * A misprint in one colour is not a doubled image; it is the *fringe* the two
 * impressions leave where only one of them landed. That is a boolean: everything
 * either copy covers, minus everything all of them cover. Union alone gives the
 * heavy double-strike of a typewriter hitting twice.
 */
export const ghost: Treatment = {
  id: 'ghost',
  name: 'Ghost',
  family: 'press',
  deterministic: false,
  blurb: 'Out of register — the fringe two impressions leave where only one landed.',
  story:
    'Riso and offset misprints read as colour, and this pipeline has one colour. What '+
    'survives the translation is the geometry: everything either impression covers, minus '+
    'everything both do, which is exactly the fringe along the drift. Union instead, and you '+
    'get the doubled strike of a typewriter hitting the same key twice.',
  // Drift and direction lead because the sheet's sound rides the primaries in
  // declared order, and those two are the ones that swell and sweep.
  params: [
    { key: 'drift', label: 'Drift', min: 1, max: 60, step: 1, default: 14, note: 'how far out of register, as % of stroke', primary: true },
    { key: 'angle', label: 'Direction', min: 0, max: 360, step: 1, default: 0, note: '0 lets the drift wander freely', primary: true },
    { key: 'copies', label: 'Impressions', min: 2, max: 4, step: 1, default: 2, note: 'how many times it hit the paper', primary: true },
    { key: 'mode', label: 'Style', min: 0, max: 2, step: 1, default: 2, note: '0 doubled · 1 fringe only · 2 letter plus fringe', primary: true, steady: true },
    { key: 'simplify', label: 'Simplify', min: 0, max: 4, step: 0.1, default: 0.4 },
  ],

  presets: [
    { name: 'Letter and fringe', values: { copies: 2, drift: 14, mode: 2, angle: 0, simplify: 0.4 } },
    { name: 'Fringe alone', values: { copies: 2, drift: 26, mode: 1, angle: 0, simplify: 0.4 } },
    { name: 'Doubled strike', values: { copies: 3, drift: 10, mode: 0, angle: 0, simplify: 0.4 } },
    { name: 'Three-plate slip', values: { copies: 3, drift: 20, mode: 2, angle: 135, simplify: 0.4 } },
  ],


  growth(p, ctx) {
    return (p.drift / 100) * ctx.strokeWidth * (p.copies - 1)
  },

  apply(rings: Ring[], p: ParamValues, ctx: TreatmentContext): Ring[] {
    if (rings.length === 0) return rings
    const glyph = simplify(normalise(rings), 1.2)
    if (glyph.length === 0) return rings

    const rng = ctx.rng
    const drift = (p.drift / 100) * ctx.strokeWidth
    const copies = Math.max(2, Math.round(p.copies))
    const fixed = p.angle > 0 ? (p.angle * Math.PI) / 180 : null

    const impressions: Paths64[] = [glyph]
    for (let i = 1; i < copies; i++) {
      // a fixed direction is a plate slipping one way; free is a press shaking
      const a = fixed ?? rng() * Math.PI * 2
      const mag = drift * (fixed ? i : 0.5 + rng())
      impressions.push(shift(glyph, Math.cos(a) * mag, Math.sin(a) * mag))
    }

    const all = union(impressions.flat(), FillRule.NonZero)
    let common = impressions[0]
    for (let i = 1; i < impressions.length; i++) {
      common = intersect(common, impressions[i], FillRule.NonZero)
      if (common.length === 0) break
    }
    const fringe =
      common.length > 0 ? difference(all, common, FillRule.NonZero) : all

    const mode = Math.round(p.mode)
    let result: Paths64
    if (mode === 0) result = all
    else if (mode === 1) result = fringe
    else result = union([...glyph, ...fringe], FillRule.NonZero)

    if (result.length === 0) result = all.length > 0 ? all : glyph
    return pathsToRings(simplify(result, p.simplify))
  },
}
