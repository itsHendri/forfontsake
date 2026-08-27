import {
  union,
  difference,
  area,
  pointInPolygon,
  FillRule,
  PointInPolygonResult,
  type Path64,
  type Paths64,
} from 'clipper2-ts'
import type { Rng } from './prng'

/**
 * Ribbon slicing — the way the reference mosaics are actually built.
 *
 * A letter is not tessellated in 2D. Each stroke is cut straight across its
 * width, so every tile spans the full thickness of the stroke and the tiles
 * stack along its length. Nothing sits side by side across a stem, and the
 * outer silhouette stays crisp because the grout comes from cutting the shape,
 * never from shrinking the tiles.
 */

export interface Segment {
  ax: number
  ay: number
  bx: number
  by: number
}

export function toSegments(paths: Paths64): Segment[] {
  const segs: Segment[] = []
  for (const p of paths) {
    for (let i = 0; i < p.length; i++) {
      const a = p[i]
      const b = p[(i + 1) % p.length]
      if (a.x !== b.x || a.y !== b.y) segs.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y })
    }
  }
  return segs
}

/** distance from P along unit dir to the nearest boundary crossing, or Infinity */
export function rayHit(segs: Segment[], px: number, py: number, dx: number, dy: number, minT: number): number {
  let best = Infinity
  for (const s of segs) {
    const ex = s.bx - s.ax
    const ey = s.by - s.ay
    const denom = dx * ey - dy * ex
    if (Math.abs(denom) < 1e-9) continue
    const t = ((s.ax - px) * ey - (s.ay - py) * ex) / denom
    if (t <= minT || t >= best) continue
    const u = ex !== 0 || ey !== 0 ? ((s.ax - px) * dy - (s.ay - py) * dx) / denom : -1
    if (u < 0 || u > 1) continue
    best = t
  }
  return best
}

function insideShape(paths: Paths64, x: number, y: number): boolean {
  let winding = 0
  const pt = { x: Math.round(x), y: Math.round(y) }
  for (const p of paths) {
    if (pointInPolygon(pt, p) !== PointInPolygonResult.IsOutside) winding += area(p) > 0 ? 1 : -1
  }
  return winding !== 0
}

interface RingMetrics {
  /** cumulative arc length at each vertex */
  at: number[]
  perimeter: number
}

/** cumulative arc length around a contour, so positions can be addressed by distance */
function measureRing(ring: Path64): RingMetrics {
  const n = ring.length
  const at: number[] = new Array(n)
  let perimeter = 0
  for (let i = 0; i < n; i++) {
    at[i] = perimeter
    const a = ring[i]
    const b = ring[(i + 1) % n]
    perimeter += Math.hypot(b.x - a.x, b.y - a.y)
  }

  return { at, perimeter }
}

interface Rib {
  px: number
  py: number
  qx: number
  qy: number
  width: number
}

/** the point at arc position `s` around a closed contour */
function pointAtArc(ring: Path64, m: RingMetrics, s: number): { x: number; y: number } {
  const n = ring.length
  let pos = s % m.perimeter
  if (pos < 0) pos += m.perimeter
  for (let i = 0; i < n; i++) {
    const start = m.at[i]
    const end = i + 1 < n ? m.at[i + 1] : m.perimeter
    if (pos <= end || i === n - 1) {
      const a = ring[i]
      const b = ring[(i + 1) % n]
      const segLen = end - start
      const f = segLen > 1e-9 ? (pos - start) / segLen : 0
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }
    }
  }
  return ring[0]
}

/**
 * Direction of the outline at `s`, averaged over a window either side.
 *
 * The instantaneous tangent swings wildly around a serif or terminal, and cuts
 * taken from it fan out into wedges. Averaging gives each cut in a corner
 * roughly the same angle, so the corner is sliced rather than shattered.
 */
function smoothTangent(ring: Path64, m: RingMetrics, s: number, window: number) {
  const back = pointAtArc(ring, m, s - window)
  const fwd = pointAtArc(ring, m, s + window)
  const dx = fwd.x - back.x
  const dy = fwd.y - back.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-6) return null
  return { x: dx / len, y: dy / len }
}

export interface RibOptions {
  /** nominal tile size, also the fallback when a stroke width can't be read */
  tileLength: number
  /** tile length as a multiple of the local stroke width — 1 is square */
  aspect: number
  irregularity: number
  /** cuts never end up closer together than this */
  minSpacing: number
  rng: Rng
}

/**
 * Walk the outline; at intervals, shoot a ray straight into the shape to find
 * the opposite wall. That chord is where the stroke gets cut.
 *
 * Spacing is taken from the stroke's own width at that point rather than from a
 * fixed distance, so tiles stay square as the stroke thickens and thins — a
 * fixed spacing makes long thin slabs wherever the stroke narrows.
 */
export function findRibs(glyph: Paths64, o: RibOptions): Rib[] {
  const { tileLength, aspect, irregularity, minSpacing, rng } = o
  const segs = toSegments(glyph)
  let ribs: Rib[] = []
  const step = Math.max(tileLength / 8, 1)

  for (const ring of glyph) {
    const metrics = measureRing(ring)
    let sinceRib = tileLength * (0.3 + 0.5 * rng())
    let lastWidth = tileLength

    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      const ex = b.x - a.x
      const ey = b.y - a.y
      const segLen = Math.hypot(ex, ey)
      if (segLen < 1e-6) continue

      for (let d = 0; d < segLen; d += step) {
        const advance = Math.min(step, segLen - d)
        sinceRib += advance
        // cheapest possible reject before doing any ray work
        if (sinceRib < minSpacing) continue

        const arcPos = metrics.at[i] + d
        const px = a.x + (ex / segLen) * d
        const py = a.y + (ey / segLen) * d

        const tangent = smoothTangent(ring, metrics, arcPos, Math.max(lastWidth, tileLength) * 0.45)
        if (!tangent) continue

        // inward normal: the filled side is to the left of travel for outers
        // and holes alike, but verify rather than trust the orientation
        let nx = -tangent.y
        let ny = tangent.x
        if (!insideShape(glyph, px + nx * 2, py + ny * 2)) {
          nx = -nx
          ny = -ny
        }

        // angle the cut slightly so tiles are not perfectly rectangular
        const skew = irregularity * (rng() - 0.5) * 0.22
        const cs = Math.cos(skew)
        const sn = Math.sin(skew)
        const dx = nx * cs - ny * sn
        const dy = nx * sn + ny * cs

        const hit = rayHit(segs, px, py, dx, dy, 1)
        if (!isFinite(hit)) continue

        // square tiles: advance along the stroke by roughly its own width
        const spacing = Math.max(hit * aspect * (1 + irregularity * (rng() - 0.5) * 0.5), minSpacing)
        if (sinceRib < spacing) continue

        sinceRib = 0
        lastWidth = hit
        ribs.push({ px, py, qx: px + dx * hit, qy: py + dy * hit, width: hit })
      }
    }
  }

  // A chord much longer than the glyph's usual stroke width is cutting across a
  // counter or a junction rather than across the stroke. Judging that against
  // the glyph's own median width means thick and thin letterforms both work —
  // a fixed multiple of the tile size would leave bold shapes uncut entirely.
  if (ribs.length > 2) {
    const widths = ribs.map((r) => r.width).sort((a, b) => a - b)
    const median = widths[Math.floor(widths.length / 2)]
    ribs = ribs.filter((r) => r.width <= median * 2.2)
  }

  // both walls of a stroke generate the same cut; keep one of each pair.
  // The gap scales with the stroke so cuts stay square in thin features too.
  const kept: Rib[] = []
  for (const r of ribs) {
    const mx = (r.px + r.qx) / 2
    const my = (r.py + r.qy) / 2
    const gap = Math.max(r.width * aspect * 0.6, minSpacing * 0.9)
    let dupe = false
    for (const k of kept) {
      const kx = (k.px + k.qx) / 2
      const ky = (k.py + k.qy) / 2
      if (Math.hypot(mx - kx, my - ky) < gap) {
        dupe = true
        break
      }
    }
    if (!dupe) kept.push(r)
  }
  return kept
}

/** thin rectangles along each rib — subtracting these is what makes the grout */
function ribCutters(ribs: Rib[], grout: number, groutJitter: number, rng: Rng): Paths64 {
  const cutters: Paths64 = []
  for (const r of ribs) {
    const dx = r.qx - r.px
    const dy = r.qy - r.py
    const len = Math.hypot(dx, dy)
    if (len < 1e-6) continue
    const ux = dx / len
    const uy = dy / len
    // overshoot both ends so the cut fully crosses the stroke
    const over = grout * 2 + len * 0.06
    const ax = r.px - ux * over
    const ay = r.py - uy * over
    const bx = r.qx + ux * over
    const by = r.qy + uy * over
    const half = (grout / 2) * (1 + groutJitter * (rng() * 2 - 1))
    const nx = -uy * half
    const ny = ux * half
    cutters.push([
      { x: Math.round(ax + nx), y: Math.round(ay + ny) },
      { x: Math.round(bx + nx), y: Math.round(by + ny) },
      { x: Math.round(bx - nx), y: Math.round(by - ny) },
      { x: Math.round(ax - nx), y: Math.round(ay - ny) },
    ])
  }
  return cutters
}

export interface RibbonOptions {
  tileLength: number
  /** tile length as a multiple of the local stroke width — 1 is square */
  aspect: number
  grout: number
  groutJitter: number
  irregularity: number
  rng: Rng
}

/** returns the glyph minus its grout lines, as separate contours */
export function ribbonSlice(glyph: Paths64, o: RibbonOptions): { pieces: Paths64; ribCount: number } {
  const ribs = findRibs(glyph, {
    tileLength: o.tileLength,
    aspect: o.aspect,
    irregularity: o.irregularity,
    // never cut so finely that a tile ends up thinner than its own grout
    minSpacing: Math.max(o.grout * 2.2, o.tileLength * 0.18),
    rng: o.rng,
  })
  if (ribs.length === 0) return { pieces: glyph, ribCount: 0 }
  const cutters = ribCutters(ribs, o.grout, o.groutJitter, o.rng)
  if (cutters.length === 0) return { pieces: glyph, ribCount: 0 }
  const merged = union(cutters, FillRule.NonZero)
  const pieces = difference(glyph, merged, FillRule.NonZero)
  return { pieces, ribCount: ribs.length }
}

export type { Rib }
