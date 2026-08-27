import {
  difference,
  inflatePaths,
  union,
  area,
  pointInPolygon,
  FillRule,
  JoinType,
  EndType,
  PointInPolygonResult,
  type Paths64,
} from 'clipper2-ts'
import { NoiseField } from '../noise'
import { SCALE, normalise, pathsToRings, resample, simplify, dropTinyAreas, boundsOf } from '../paths'
import type { Ring } from '../flatten'
import type { Treatment, ParamValues, TreatmentContext } from './types'

/**
 * Grit — parametric erosion.
 *
 * Three layers, all driven by one amount:
 *   1. coherent-noise displacement of the outline (the edge stops being clean)
 *   2. bites taken out along the edge (ink starvation at the boundary)
 *   3. speckle holes in the interior (photocopy / riso dropout)
 *
 * The rule that keeps it legible: erosion is allowed near the edge and
 * suppressed toward the middle of a stroke. Distressed faces die below display
 * size when the damage eats into stroke cores, so speckle is placed by distance
 * from the boundary rather than uniformly.
 */

function ringDistanceToEdge(paths: Paths64, x: number, y: number): number {
  // distance to the nearest outline segment; cheap enough at the sample counts
  // grit uses, and exact, which a rasterised distance field would not be
  let best = Infinity
  for (const ring of paths) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len2 = dx * dx + dy * dy
      let t = len2 > 0 ? ((x - a.x) * dx + (y - a.y) * dy) / len2 : 0
      t = t < 0 ? 0 : t > 1 ? 1 : t
      const px = a.x + dx * t
      const py = a.y + dy * t
      const d = Math.hypot(x - px, y - py)
      if (d < best) best = d
    }
  }
  return best
}

function isInside(paths: Paths64, x: number, y: number): boolean {
  let winding = 0
  const pt = { x: Math.round(x), y: Math.round(y) }
  for (const p of paths) {
    if (pointInPolygon(pt, p) !== PointInPolygonResult.IsOutside) winding += area(p) > 0 ? 1 : -1
  }
  return winding !== 0
}

/** a rough blob, used for both bites and speckle */
function blob(cx: number, cy: number, radius: number, noise: NoiseField, sides = 7) {
  const ring = []
  for (let i = 0; i < sides; i++) {
    const ang = (i / sides) * Math.PI * 2
    const wobble = 0.6 + 0.5 * (noise.sample(cx / 800 + Math.cos(ang), cy / 800 + Math.sin(ang)) * 0.5 + 0.5)
    const r = radius * wobble
    ring.push({ x: Math.round(cx + Math.cos(ang) * r), y: Math.round(cy + Math.sin(ang) * r) })
  }
  return ring
}

export const grit: Treatment = {
  id: 'grit',
  name: 'Grit',
  blurb: 'Erosion — the edge breaks up, ink starves, the surface speckles.',
  params: [
    { key: 'amount', label: 'grit', min: 0, max: 100, step: 1, default: 45, note: 'drives all three layers' },
    { key: 'scale', label: 'texture scale', min: 4, max: 120, step: 2, default: 34, note: 'size of the disruption' },
    { key: 'bite', label: 'edge bites', min: 0, max: 100, step: 1, default: 50 },
    { key: 'speckle', label: 'interior speckle', min: 0, max: 100, step: 1, default: 40 },
    { key: 'protect', label: 'protect stroke cores', min: 0, max: 100, step: 1, default: 55, note: 'keeps it legible small' },
    { key: 'simplify', label: 'simplify', min: 0, max: 4, step: 0.1, default: 0.8 },
  ],

  apply(rings: Ring[], p: ParamValues, ctx: TreatmentContext): Ring[] {
    if (rings.length === 0) return rings
    const glyph = normalise(rings)
    if (glyph.length === 0) return rings

    const amount = p.amount / 100
    if (amount <= 0) return rings

    const noise = new NoiseField(ctx.rng)
    const em = ctx.unitsPerEm
    const featureSize = (p.scale / 1000) * em * SCALE
    const bounds = boundsOf(glyph)

    // --- layer 1: coherent displacement of the outline ---------------------
    // resample first, or the noise has almost no points to act on
    const dense = resample(glyph, Math.max(p.scale / 3, 3))
    const maxShift = amount * featureSize * 0.16
    const displaced: Paths64 = dense.map((ring) =>
      ring.map((pt) => {
        const nx = noise.fractal(pt.x / featureSize, pt.y / featureSize, 2)
        const ny = noise.fractal((pt.x + 9173) / featureSize, (pt.y - 4271) / featureSize, 2)
        return {
          x: Math.round(pt.x + nx * maxShift),
          y: Math.round(pt.y + ny * maxShift),
        }
      }),
    )
    let result = union(displaced, FillRule.NonZero)
    if (result.length === 0) result = glyph

    // --- layer 2: bites along the edge -------------------------------------
    const biteAmount = (p.bite / 100) * amount
    if (biteAmount > 0) {
      // walk a ring just inside the outline and subtract blobs straddling it
      const edge = inflatePaths(result, -featureSize * 0.15, JoinType.Round, EndType.Polygon)
      const cutters: Paths64 = []
      const spacing = featureSize * (1.5 - biteAmount * 0.8)
      for (const ring of edge.length > 0 ? edge : result) {
        let carried = 0
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i]
          const b = ring[(i + 1) % ring.length]
          const segLen = Math.hypot(b.x - a.x, b.y - a.y)
          carried += segLen
          if (carried < spacing) continue
          carried = 0
          if (ctx.rng() > 0.35 + biteAmount * 0.55) continue
          const r = featureSize * (0.18 + ctx.rng() * 0.4) * biteAmount
          if (r < SCALE) continue
          cutters.push(blob(a.x, a.y, r, noise))
        }
      }
      if (cutters.length > 0) {
        result = difference(result, union(cutters, FillRule.NonZero), FillRule.NonZero)
      }
    }

    // --- layer 3: interior speckle, biased away from stroke cores -----------
    const speckleAmount = (p.speckle / 100) * amount
    if (speckleAmount > 0 && result.length > 0) {
      const protect = (p.protect / 100) * featureSize * 1.2
      const cutters: Paths64 = []
      const step = featureSize * (1.4 - speckleAmount * 0.7)
      const jitter = step * 0.5
      for (let y = bounds.minY; y <= bounds.maxY; y += step) {
        for (let x = bounds.minX; x <= bounds.maxX; x += step) {
          const px = x + (ctx.rng() - 0.5) * jitter
          const py = y + (ctx.rng() - 0.5) * jitter
          if (!isInside(result, px, py)) continue
          const d = ringDistanceToEdge(result, px, py)
          // deep inside a stroke is protected; the falloff is what keeps the
          // face readable once it is set small
          if (d > protect) continue
          const nearness = protect > 0 ? 1 - d / protect : 1
          if (ctx.rng() > nearness * speckleAmount * 0.9) continue
          const r = featureSize * (0.06 + ctx.rng() * 0.18) * speckleAmount
          if (r < SCALE * 0.6) continue
          cutters.push(blob(px, py, r, noise, 6))
        }
      }
      if (cutters.length > 0) {
        result = difference(result, union(cutters, FillRule.NonZero), FillRule.NonZero)
      }
    }

    result = dropTinyAreas(result, (featureSize / SCALE) * (featureSize / SCALE) * 0.02)
    result = simplify(result, p.simplify)
    return pathsToRings(result)
  },
}
