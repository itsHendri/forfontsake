import { union, area, FillRule, type Paths64 } from 'clipper2-ts'
import { NoiseField } from '../noise'
import { roughBlob } from '../blob'
import {
  SCALE,
  normalise,
  pathsToRings,
  resample,
  simplify,
  grow,
  roundPaths,
  keepCounters,
} from '../paths'
import type { Ring } from '../flatten'
import type { Treatment, ParamValues, TreatmentContext } from './types'

/**
 * Bleed — ink spreading into paper.
 *
 * Bubble grows the letter by the same amount everywhere, which reads as a
 * heavier weight rather than as wet ink. Bleed grows it *unevenly*: a modest
 * uniform spread, plus lumps of varying size unioned along the outline, so the
 * edge swells in some places and barely moves in others.
 *
 * Ink also pools where strokes meet, because two wet edges feed the same spot.
 * Blobs at concave turns are enlarged to reproduce that — it is the detail that
 * separates "printed slightly too heavy" from "printed wet".
 */
export const bleed: Treatment = {
  id: 'bleed',
  name: 'Bleed',
  family: 'ink',
  deterministic: false,
  blurb: 'Wet ink spreading unevenly into the paper, pooling where strokes meet.',
  story:
    'Growing a letter evenly just makes it heavier. Ink does not spread evenly: it '+
    'creeps further into some fibres than others, so the swelling here is lumps of '+
    'varying size unioned along the outline. And it pools where two wet edges feed the '+
    'same spot, which is why the blobs at concave turns are enlarged — that detail is '+
    'the whole difference between printed heavy and printed wet.',
  params: [
    { key: 'amount', label: 'Spread', min: 0, max: 120, step: 1, default: 22, note: 'how far ink creeps, as % of stroke', primary: true },
    { key: 'unevenness', label: 'Unevenness', min: 0, max: 100, step: 1, default: 65, note: 'how much the spread varies', primary: true },
    { key: 'pooling', label: 'Pooling', min: 0, max: 100, step: 1, default: 55, note: 'extra bloom where strokes meet', primary: true },
    { key: 'grain', label: 'Grain', min: 5, max: 140, step: 1, default: 22, note: 'size of the lumps', primary: true },
    { key: 'soften', label: 'Soften', min: 0, max: 100, step: 1, default: 10, note: 'rounds the wet edge' },
    { key: 'counters', label: 'Keep counters', min: 0, max: 100, step: 1, default: 70, note: 'how much of each hole the ink must leave open' },
    { key: 'simplify', label: 'Simplify', min: 0, max: 4, step: 0.1, default: 0.6 },
  ],

  presets: [
    { name: 'Damp', values: { amount: 10, unevenness: 55, pooling: 40, grain: 17, soften: 8, counters: 70, simplify: 0.6 } },
    { name: 'Wet ink', values: { amount: 23, unevenness: 70, pooling: 60, grain: 23, soften: 12, counters: 75, simplify: 0.6 } },
    { name: 'Blotted', values: { amount: 27, unevenness: 92, pooling: 70, grain: 33, soften: 7, counters: 35, simplify: 0.7 } },
    { name: 'Newsprint', values: { amount: 13, unevenness: 95, pooling: 25, grain: 10, soften: 3, counters: 80, simplify: 0.5 } },
  ],

  growth(p, ctx) {
    return Math.round((p.amount / 100) * ctx.strokeWidth * 1.6)
  },

  apply(rings: Ring[], p: ParamValues, ctx: TreatmentContext): Ring[] {
    if (rings.length === 0) return rings
    const glyph = simplify(normalise(rings), 1.5)
    if (glyph.length === 0) return rings
    if (p.amount <= 0) return pathsToRings(glyph)

    const rng = ctx.rng
    const noise = new NoiseField(rng)
    // shares of the stem, so a spread that reads as damp stays damp on a
    // heavier face instead of closing every counter
    const stem = ctx.strokeWidth
    const spread = (p.amount / 100) * stem
    const grain = (p.grain / 100) * stem
    const uneven = p.unevenness / 100
    const pooling = p.pooling / 100

    // a modest even spread underneath, so the letter thickens everywhere and
    // the lumps read as extra rather than as the whole effect
    const parts: Paths64 = [...grow(glyph, spread * 0.3)]

    const dense = resample(glyph, Math.max(grain * 0.7, 3))
    for (const ring of dense) {
      // holes wind the other way, so the sign of the turn has to be read
      // relative to the ring's own direction to tell convex from concave
      const ringSign = area(ring) > 0 ? 1 : -1
      const n = ring.length
      for (let i = 0; i < n; i++) {
        const prev = ring[(i - 1 + n) % n]
        const cur = ring[i]
        const next = ring[(i + 1) % n]

        const ax = cur.x - prev.x
        const ay = cur.y - prev.y
        const bx = next.x - cur.x
        const by = next.y - cur.y
        const cross = (ax * by - ay * bx) * ringSign
        const concave = cross < 0

        // wander the spread with coherent noise so neighbouring lumps agree
        const field = noise.fractal(cur.x / (grain * SCALE * 2), cur.y / (grain * SCALE * 2), 2)
        let r = spread * (1 + uneven * field * 1.1)
        if (concave) r *= 1 + pooling * 1.4
        if (r <= 0) continue

        // skip some, or the outline becomes a solid sausage of equal lumps
        if (rng() > 0.45 + uneven * 0.4) continue
        parts.push(roughBlob(cur.x, cur.y, r * SCALE, noise, rng))
      }
    }

    let result = union(parts, FillRule.NonZero)
    if (result.length === 0) result = glyph
    if (p.soften > 0) result = roundPaths(result, (p.soften / 100) * stem)
    // Lumps at a concave turn are the biggest ones, and the inside of a counter
    // is all concave — so the holes are exactly where the ink closes first.
    // Put them back before the pooling swallows the eye of the `e`.
    if (p.counters > 0) {
      // given back wider than the ink left it — see the note in bubble.ts
      const keep = p.counters / 100
      const minAperture = 0.15 + 0.5 * keep
      result = keepCounters(result, glyph, spread * 1.4 * (1 - 0.75 * keep), minAperture)
    }
    result = simplify(result, p.simplify)
    return pathsToRings(result)
  },
}
