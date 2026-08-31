import { normalise, pathsToRings, simplify, grow, roundPaths, keepCounters } from '../paths'
import type { Ring } from '../flatten'
import type { Treatment, ParamValues, TreatmentContext } from './types'

/**
 * Soak — wet ink, softened rather than lumped.
 *
 * Bleed makes an edge wet by making it irregular. This makes it wet by making
 * it *soft*: heavy rounding in both directions until every corner is gone and
 * the strokes swell into each other, while the counters are held open by the
 * guard so they shrink to slots and slivers without ever sealing. That surviving
 * aperture is the whole read — a blurred 8 with two eyes left is wet ink, and
 * the same shape with them filled is a blob.
 */
export const soak: Treatment = {
  id: 'soak',
  name: 'Soak',
  family: 'ink',
  deterministic: true,
  blurb: 'Wet ink gone soft — corners melted, counters squeezed to slits but never sealed.',
  story:
    'The counters are the effect. Round a letter hard enough for the strokes to bleed into '+
    'each other and the holes go first, which is the point at which soft ink becomes a blot. '+
    'So the original counters are put back, shrunk but never smaller than a fixed share of '+
    'their own width: they close to slits and stop. What is left reads as ink that soaked '+
    'into the paper rather than ink that filled the letter in.',
  params: [
    { key: 'swell', label: 'Swell', min: 0, max: 120, step: 1, default: 14, note: 'ink taken on, as % of stroke', primary: true },
    { key: 'melt', label: 'Melt', min: 0, max: 160, step: 1, default: 55, note: 'how far the corners go', primary: true },
    { key: 'counters', label: 'Keep counters', min: 0, max: 100, step: 1, default: 65, note: 'how much of each hole survives', primary: true },
    { key: 'squeeze', label: 'Squeeze', min: 0, max: 100, step: 1, default: 60, note: 'how hard the ink presses in on the holes', primary: true },
    { key: 'simplify', label: 'Simplify', min: 0, max: 4, step: 0.1, default: 0.5 },
  ],

  presets: [
    { name: 'Wet', values: { swell: 14, melt: 55, counters: 65, squeeze: 60, simplify: 0.5 } },
    { name: 'Soaked through', values: { swell: 45, melt: 110, counters: 45, squeeze: 60, simplify: 0.5 } },
    { name: 'Damp', values: { swell: 6, melt: 30, counters: 80, squeeze: 60, simplify: 0.5 } },
    { name: 'Blotted', values: { swell: 70, melt: 150, counters: 60, squeeze: 100, simplify: 0.5 } },
  ],


  growth(p, ctx) {
    return (p.swell / 100) * ctx.strokeWidth * 1.6
  },

  apply(rings: Ring[], p: ParamValues, ctx: TreatmentContext): Ring[] {
    if (rings.length === 0) return rings
    const glyph = simplify(normalise(rings), 1.5)
    if (glyph.length === 0) return rings

    const stem = ctx.strokeWidth
    const swell = (p.swell / 100) * stem
    // A rounding radius of a whole stem does not soften a letter, it dissolves
    // it — every feature narrower than the radius is simply gone. A third of the
    // stem is the point where corners melt and the skeleton survives.
    const melt = (p.melt / 100) * stem * 0.35

    let result = glyph
    if (swell > 0) result = grow(result, swell)
    if (melt > 0) result = roundPaths(result, melt)

    // the ink presses in on the counters harder than the swell alone would
    // Counters are what a soft letter loses first and what its legibility rests
    // on, so the hole goes back wider than the softening left it.
    const keep = p.counters / 100
    const closure = (swell + melt * 0.5 * (p.squeeze / 100)) * (1 - 0.7 * keep)
    const minAperture = 0.2 + 0.55 * keep
    if (p.counters > 0) result = keepCounters(result, glyph, closure, minAperture)

    return pathsToRings(simplify(result, p.simplify))
  },
}
