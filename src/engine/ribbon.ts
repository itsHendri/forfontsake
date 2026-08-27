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
  /** arc positions of vertices where the outline turns hard */
  corners: number[]
}

/**
 * Where does this contour turn hard? Those points are serifs, spurs and
 * terminals; ribs placed near them fan out into wedges instead of slabs.
 *
 * Measured per vertex and stored as arc positions, so the test for a given
 * sample is "how far along the outline am I from a corner" — independent of
 * how the outline happens to be subdivided into segments.
 */
function measureRing(ring: Path64, cosLimit: number): RingMetrics {
  const n = ring.length
  const at: number[] = new Array(n)
  let perimeter = 0
  for (let i = 0; i < n; i++) {
    at[i] = perimeter
    const a = ring[i]
    const b = ring[(i + 1) % n]
    perimeter += Math.hypot(b.x - a.x, b.y - a.y)
  }

  const corners: number[] = []
  for (let i = 0; i < n; i++) {
    const prev = ring[(i - 1 + n) % n]
    const cur = ring[i]
    const next = ring[(i + 1) % n]
    const ix = cur.x - prev.x
    const iy = cur.y - prev.y
    const ox = next.x - cur.x
    const oy = next.y - cur.y
    const li = Math.hypot(ix, iy)
    const lo = Math.hypot(ox, oy)
    if (li < 1e-6 || lo < 1e-6) continue
    const cos = (ix * ox + iy * oy) / (li * lo)
    if (cos < cosLimit) corners.push(at[i])
  }
  return { at, perimeter, corners }
}

/** shortest distance around the closed contour from an arc position to a corner */
function nearCorner(m: RingMetrics, pos: number, radius: number): boolean {
  for (const c of m.corners) {
    let d = Math.abs(pos - c)
    if (d > m.perimeter / 2) d = m.perimeter - d
    if (d < radius) return true
  }
  return false
}

interface Rib {
  px: number
  py: number
  qx: number
  qy: number
  width: number
}

/**
 * Walk the outline; at intervals, shoot a ray straight into the shape to find
 * the opposite wall. That chord is where the stroke gets cut.
 */
export function findRibs(glyph: Paths64, tileLength: number, irregularity: number, rng: Rng): Rib[] {
  const segs = toSegments(glyph)
  let ribs: Rib[] = []
  const step = Math.max(tileLength / 4, 1)

  for (const ring of glyph) {
    const metrics = measureRing(ring, 0.45) // ~63 degrees counts as a corner
    const cornerRadius = tileLength * 0.3
    // walk this contour at a fixed step, carrying arc length so ribs land
    // evenly along the stroke rather than evenly around the outline
    let sinceRib = tileLength * (0.4 + 0.4 * rng())
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      const ex = b.x - a.x
      const ey = b.y - a.y
      const segLen = Math.hypot(ex, ey)
      if (segLen < 1e-6) continue
      const tx = ex / segLen
      const ty = ey / segLen

      for (let d = 0; d < segLen; d += step) {
        sinceRib += Math.min(step, segLen - d)
        const spacing = tileLength * (1 + irregularity * (rng() - 0.5) * 0.9)
        if (sinceRib < spacing) continue
        sinceRib = 0

        const px = a.x + tx * d
        const py = a.y + ty * d

        // Serifs and terminals turn sharply; ribs placed there fan out into
        // wedges instead of slabs, so leave corners uncut.
        if (nearCorner(metrics, metrics.at[i] + d, cornerRadius)) {
          continue
        }

        // inward normal: the filled side is to the left of travel for outers
        // and holes alike, but verify rather than trust the orientation
        let nx = -ty
        let ny = tx
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

  // both walls of a stroke generate the same cut; keep one of each pair
  const kept: Rib[] = []
  const minGap = tileLength * 0.72
  for (const r of ribs) {
    const mx = (r.px + r.qx) / 2
    const my = (r.py + r.qy) / 2
    let dupe = false
    for (const k of kept) {
      const kx = (k.px + k.qx) / 2
      const ky = (k.py + k.qy) / 2
      if (Math.hypot(mx - kx, my - ky) < minGap) {
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
  grout: number
  groutJitter: number
  irregularity: number
  rng: Rng
}

/** returns the glyph minus its grout lines, as separate contours */
export function ribbonSlice(glyph: Paths64, o: RibbonOptions): { pieces: Paths64; ribCount: number } {
  const ribs = findRibs(glyph, o.tileLength, o.irregularity, o.rng)
  if (ribs.length === 0) return { pieces: glyph, ribCount: 0 }
  const cutters = ribCutters(ribs, o.grout, o.groutJitter, o.rng)
  if (cutters.length === 0) return { pieces: glyph, ribCount: 0 }
  const merged = union(cutters, FillRule.NonZero)
  const pieces = difference(glyph, merged, FillRule.NonZero)
  return { pieces, ribCount: ribs.length }
}

export type { Rib }
