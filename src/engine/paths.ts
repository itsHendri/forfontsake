import {
  union,
  ramerDouglasPeuckerPaths,
  area,
  FillRule,
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
