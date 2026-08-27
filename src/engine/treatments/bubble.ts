import { normalise, pathsToRings, roundPaths, grow, simplify } from '../paths'
import type { Ring } from '../flatten'
import type { Treatment, ParamValues, TreatmentContext } from './types'

/**
 * Bubble — the fat rounded lettering a marker makes.
 *
 * Inflate the letter, then round the corners in both directions. Growing alone
 * gives a fat letter with the original's sharp joints still in it; the rounding
 * is what turns those joints into the soft turns a chisel or bullet nib leaves.
 *
 * Counters close up fast as the weight rises, so there is a floor on how much
 * you can inflate before an `e` becomes a blob. The rounding pass reopens some
 * of that, which is why it runs after the growth rather than before.
 */
export const bubble: Treatment = {
  id: 'bubble',
  name: 'Bubble',
  deterministic: true,
  blurb: 'Fattened and rounded, the way a marker nib turns a corner.',
  params: [
    { key: 'weight', label: 'Weight', min: 0, max: 90, step: 1, default: 34, note: 'how much fatter', primary: true },
    { key: 'rounding', label: 'Rounding', min: 0, max: 90, step: 1, default: 40, note: 'softness of the turns', primary: true },
    { key: 'squeeze', label: 'Keep counters', min: 0, max: 100, step: 1, default: 55, note: 'reopens holes the weight closes', primary: true },
    { key: 'simplify', label: 'Simplify', min: 0, max: 4, step: 0.1, default: 0.5 },
  ],

  presets: [
    { name: 'Marker', values: { weight: 26, rounding: 34, squeeze: 60, simplify: 0.5 } },
    { name: 'Balloon', values: { weight: 68, rounding: 74, squeeze: 80, simplify: 0.5 } },
    { name: 'Softened', values: { weight: 8, rounding: 62, squeeze: 30, simplify: 0.5 } },
  ],

  growth(p) {
    return p.weight * 2
  },

  apply(rings: Ring[], p: ParamValues, ctx: TreatmentContext): Ring[] {
    if (rings.length === 0) return rings
    // Offsetting costs time per point, and the flattened outline carries many
    // more than the result can show. Thinning first is the difference between
    // a draggable slider and a stuttering one.
    const glyph = simplify(normalise(rings), 1.5)
    if (glyph.length === 0) return rings
    void ctx

    let result = glyph
    if (p.weight > 0) result = grow(result, p.weight)
    if (p.rounding > 0) result = roundPaths(result, p.rounding)

    // Counters shrink by the same amount the strokes grew. Shrinking the whole
    // shape back and growing it again would just undo the weight, so instead
    // the holes are widened on their own by running a negative-then-positive
    // pass at a radius tied to how much was added.
    if (p.squeeze > 0 && p.weight > 0) {
      const relief = (p.squeeze / 100) * p.weight * 0.75
      const reopened = grow(grow(result, -relief), relief)
      if (reopened.length > 0) result = reopened
    }

    result = simplify(result, p.simplify)
    return pathsToRings(result)
  },
}
