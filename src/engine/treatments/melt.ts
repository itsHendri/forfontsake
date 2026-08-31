import { union, FillRule, type Paths64 } from 'clipper2-ts'
import {
  normalise,
  pathsToRings,
  simplify,
  growStrict,
  shift,
  roundPaths,
  keepCounters,
} from '../paths'
import type { Ring } from '../flatten'
import type { Treatment, ParamValues, TreatmentContext } from './types'

/**
 * Melt — the letter sagging off its own baseline.
 *
 * The trick is that the drips are not drawn. Copies of the letter are dropped
 * downward, each one pinched narrower than the last; the narrow copies stay
 * hidden inside the body of the letter everywhere except below its bottom
 * edges, where the descent carries them out into the open as tapering runs.
 * Nothing has to know where a drip belongs — the geometry decides.
 */
export const melt: Treatment = {
  id: 'melt',
  name: 'Melt',
  family: 'ink',
  deterministic: true,
  blurb: 'Sagging off the baseline, drips tapering out from wherever the ink pooled.',
  story:
    'The drips are never drawn. Narrowing copies of the letter are dropped downward; each '+
    'stays buried inside the body except under a bottom edge, where the fall carries it into '+
    'the open as a tapering run. Where a drip belongs is a question the geometry answers on '+
    'its own — a wide foot sheds a wide one, a hairline sheds a thread.',
  params: [
    { key: 'sag', label: 'Sag', min: 0, max: 250, step: 1, default: 60, note: 'how far it runs, as % of stroke', primary: true },
    { key: 'pinch', label: 'Taper', min: 0, max: 100, step: 1, default: 60, note: 'how fast a run narrows to nothing', primary: true },
    { key: 'soften', label: 'Soften', min: 0, max: 100, step: 1, default: 12, note: 'rounds the runs the way a wet edge is round', primary: true },
    { key: 'swell', label: 'Swell', min: 0, max: 60, step: 1, default: 4, note: 'ink gained before it started to run', primary: true },
    { key: 'counters', label: 'Keep counters', min: 0, max: 100, step: 1, default: 70, note: 'stops the runs filling the holes on the way past' },
    { key: 'steps', label: 'Smoothness', min: 4, max: 24, step: 1, default: 12, note: 'copies used to build a run; more is smoother and costlier' },
    { key: 'simplify', label: 'Simplify', min: 0, max: 4, step: 0.1, default: 0.5 },
  ],

  presets: [
    { name: 'Running', values: { sag: 60, pinch: 60, soften: 12, swell: 4, counters: 70, steps: 12, simplify: 0.5 } },
    { name: 'Long drips', values: { sag: 220, pinch: 85, soften: 8, swell: 4, counters: 70, steps: 12, simplify: 0.5 } },
    { name: 'Barely sagging', values: { sag: 30, pinch: 45, soften: 30, swell: 4, counters: 70, steps: 12, simplify: 0.5 } },
    { name: 'Molten', values: { sag: 160, pinch: 40, soften: 55, swell: 16, counters: 70, steps: 12, simplify: 0.5 } },
  ],


  growth(p, ctx) {
    return (p.swell / 100) * ctx.strokeWidth * 2
  },

  apply(rings: Ring[], p: ParamValues, ctx: TreatmentContext): Ring[] {
    if (rings.length === 0) return rings
    let glyph = simplify(normalise(rings), 1.5)
    if (glyph.length === 0) return rings

    const stem = ctx.strokeWidth
    if (p.swell > 0) glyph = growStrict(glyph, (p.swell / 100) * stem)
    if (glyph.length === 0) return rings

    const sag = (p.sag / 100) * stem
    if (sag <= 0) return pathsToRings(glyph)

    const steps = Math.max(4, Math.round(p.steps))
    // A run has to end somewhere, so the copy narrows as it falls — but pinch
    // it by more than a stem and it is gone before it clears the letter, and
    // nothing drips at all.
    const pinch = (p.pinch / 100) * stem * 0.55
    const parts: Paths64 = [...glyph]
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      // Narrowing in step with the fall gives a run the same width all the way
      // down, which is a stalactite, not a drip. Easing it means the copy holds
      // its width off the letter and then runs away to a point.
      const dropped = growStrict(glyph, -pinch * Math.pow(t, 1.8))
      if (dropped.length === 0) break
      parts.push(...shift(dropped, 0, -sag * t))
    }

    let result = union(parts, FillRule.NonZero)
    if (result.length === 0) result = glyph
    if (p.soften > 0) result = roundPaths(result, (p.soften / 100) * stem * 0.4)
    // A run falling past a counter fills it in on the way, which is how an `e`
    // becomes an `o`. The holes go back afterwards.
    if (p.counters > 0) {
      const keep = p.counters / 100
      result = keepCounters(result, glyph, sag * 0.4 * (1 - 0.8 * keep), 0.25 + 0.55 * keep)
    }
    return pathsToRings(simplify(result, p.simplify))
  },
}
