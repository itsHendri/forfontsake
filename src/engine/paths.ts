import {
  union,
  difference,
  ramerDouglasPeuckerPaths,
  inflatePaths,
  area,
  pointInPolygon,
  PointInPolygonResult,
  FillRule,
  JoinType,
  EndType,
  type Path64,
  type Paths64,
} from 'clipper2-ts'
import type { Ring } from './flatten'

/**
 * Clipper works on integers. Font units at upm 1000 are far too coarse for
 * boolean work, so everything scales up on the way in and back down on the way
 * out. 100 puts the working grid two decimal places finer than a font unit.
 */
export const SCALE = 100

export function ringsToPaths(rings: Ring[]): Paths64 {
  return rings.map((r) => r.map((p) => ({ x: Math.round(p.x * SCALE), y: Math.round(p.y * SCALE) })))
}

export function pathsToRings(paths: Paths64): Ring[] {
  return paths.map((p) => p.map((pt) => ({ x: pt.x / SCALE, y: pt.y / SCALE })))
}

/**
 * Glyph outlines routinely contain overlapping contours, and composite glyphs
 * stack them. Every treatment needs a single clean region to work against.
 */
export function normalise(rings: Ring[]): Paths64 {
  if (rings.length === 0) return []
  return union(ringsToPaths(rings), FillRule.NonZero)
}

/**
 * Drop redundant points. Treatments that subdivide outlines to displace them
 * leave far more points than the shape needs, and every one costs bytes in the
 * exported font. Tolerance is in font units; 1 unit at upm 1000 is invisible.
 */
export function simplify(paths: Paths64, toleranceUnits: number): Paths64 {
  if (toleranceUnits <= 0) return paths
  const reduced = ramerDouglasPeuckerPaths(paths, toleranceUnits * SCALE)
  const kept = reduced.filter((r) => r.length >= 3)
  return kept.length > 0 ? kept : paths
}

/** Discard slivers, keeping holes (negative area) regardless of size. */
export function dropTinyAreas(paths: Paths64, minAreaUnits: number): Paths64 {
  const min = minAreaUnits * SCALE * SCALE
  return paths.filter((r) => area(r) < 0 || Math.abs(area(r)) >= min)
}

export function boundsOf(paths: Paths64) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of paths)
    for (const pt of p) {
      if (pt.x < minX) minX = pt.x
      if (pt.x > maxX) maxX = pt.x
      if (pt.y < minY) minY = pt.y
      if (pt.y > maxY) maxY = pt.y
    }
  return { minX, minY, maxX, maxY }
}

/** Total point count, for the per-glyph budget. */
export function pointCount(rings: Ring[]): number {
  return rings.reduce((n, r) => n + r.length, 0)
}

/**
 * Insert points along every edge so a displacement field has something to move.
 * A glyph outline has points only where the curve needs them; noise applied to
 * those alone barely registers.
 */
export function resample(paths: Paths64, spacing: number): Paths64 {
  const step = Math.max(spacing * SCALE, 1)
  return paths.map((ring) => {
    const out: typeof ring = []
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      out.push(a)
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      const n = Math.floor(len / step)
      for (let k = 1; k <= n; k++) {
        const f = (k * step) / len
        if (f >= 1) break
        out.push({ x: Math.round(a.x + (b.x - a.x) * f), y: Math.round(a.y + (b.y - a.y) * f) })
      }
    }
    return out
  })
}

/**
 * Round both convex and concave corners.
 *
 * Two passes, because a single offset only rounds one kind: shrinking then
 * growing rounds the outside and eats thin spurs; growing then shrinking fills
 * notches and rounds the inside. Bubble lettering needs both or the corners
 * stay sharp exactly where a marker nib would have rounded them.
 */
/**
 * How finely a round join is approximated. Clipper's default is proportional to
 * the offset, which at our working scale emits far more segments than a font
 * can show — one font unit of error is already invisible, and the segment count
 * is what makes repeated offsetting slow.
 */
const ARC_TOLERANCE = SCALE

export function roundPaths(paths: Paths64, radiusUnits: number): Paths64 {
  if (radiusUnits <= 0 || paths.length === 0) return paths
  const r = radiusUnits * SCALE
  const off = (src: Paths64, delta: number) =>
    inflatePaths(src, delta, JoinType.Round, EndType.Polygon, 2, ARC_TOLERANCE)
  const opened = off(off(paths, -r), r)
  const source = opened.length > 0 ? opened : paths
  const closed = off(off(source, r), -r)
  return closed.length > 0 ? closed : source
}

/** grow (or shrink, if negative) a shape by an even amount all round */
export function grow(paths: Paths64, units: number, join: JoinType = JoinType.Round): Paths64 {
  if (units === 0 || paths.length === 0) return paths
  const out = inflatePaths(paths, units * SCALE, join, EndType.Polygon, 2.5, ARC_TOLERANCE)
  return out.length > 0 ? out : paths
}

/**
 * grow(), but an empty result means empty.
 *
 * `grow` hands back its input when an offset collapses the shape, which keeps
 * the common case from vanishing. For anything that *subtracts* the offset,
 * that fallback is a bug: a stroke thinner than the inset comes back at full
 * size, and the difference then erases the very thing being drawn. Outline hit
 * exactly this on high-contrast faces — the band disappeared on the thin
 * strokes. Callers that can be handed nothing should use this and say what
 * nothing means.
 */
export function growStrict(
  paths: Paths64,
  units: number,
  join: JoinType = JoinType.Round,
): Paths64 {
  if (paths.length === 0) return []
  if (units === 0) return paths
  return inflatePaths(paths, units * SCALE, join, EndType.Polygon, 2.5, ARC_TOLERANCE)
}

function perimeterOf(ring: Path64): number {
  let total = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    total += Math.hypot(b.x - a.x, b.y - a.y)
  }
  return total
}

/**
 * Keep the counters open.
 *
 * Anything that grows a letter closes its holes, and past a point the hole is
 * gone — no later reopening pass can recover a shape that no longer exists.
 * So the holes are taken from the *original* glyph and put back: each one
 * shrunk by however much the treatment closed it, but never by more than its
 * own inradius allows, so a small counter still leaves an aperture instead of
 * sealing. That is the difference between a fat `e` and a blob.
 *
 * `closure` is in font units. `minAperture` (0..1) is the share of the hole's
 * half-width that must survive.
 */
export function keepCounters(
  result: Paths64,
  glyph: Paths64,
  closure: number,
  minAperture: number,
): Paths64 {
  if (result.length === 0 || glyph.length === 0) return result

  const cutters: Paths64 = []
  for (const ring of glyph) {
    // outers wind positive after normalise(); the holes are what we protect
    if (area(ring) >= 0) continue
    const hole = [...ring].reverse()
    const perim = perimeterOf(hole)
    if (perim <= 0) continue
    // 2A/P is the inradius of a circle and a fair proxy for anything rounder
    // than a slot, which counters are
    const inradius = (2 * Math.abs(area(hole))) / perim
    const maxShrink = inradius * (1 - Math.min(Math.max(minAperture, 0), 1))
    const shrink = Math.min(Math.max(closure, 0) * SCALE, maxShrink)

    if (shrink <= 0) {
      cutters.push(hole)
      continue
    }
    // inflatePaths directly, not grow(): grow()'s empty-fallback would hand
    // back the hole at full size and carve the letter open
    const shrunk = inflatePaths([hole], -shrink, JoinType.Round, EndType.Polygon, 2, ARC_TOLERANCE)
    cutters.push(...shrunk)
  }

  if (cutters.length === 0) return result
  const guarded = difference(result, union(cutters, FillRule.NonZero), FillRule.NonZero)
  return guarded.length > 0 ? guarded : result
}

/**
 * Is this point in the filled region? Winding, not a plain hit test, so a point
 * in a counter reads as outside. Coordinates are working-scale.
 */
export function isInside(paths: Paths64, x: number, y: number): boolean {
  let winding = 0
  const pt = { x: Math.round(x), y: Math.round(y) }
  for (const p of paths) {
    if (pointInPolygon(pt, p) !== PointInPolygonResult.IsOutside) winding += area(p) > 0 ? 1 : -1
  }
  return winding !== 0
}

/** distance from a point to the nearest outline segment, working-scale */
export function distanceToEdge(paths: Paths64, x: number, y: number): number {
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
      const d = Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t))
      if (d < best) best = d
    }
  }
  return best
}

export function shift(paths: Paths64, dx: number, dy: number): Paths64 {
  const x = dx * SCALE
  const y = dy * SCALE
  return paths.map((r) => r.map((p) => ({ x: Math.round(p.x + x), y: Math.round(p.y + y) })))
}
