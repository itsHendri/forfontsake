import { Delaunay } from 'd3-delaunay'
import PoissonDiskSampling from 'poisson-disk-sampling'
import {
  union,
  intersect,
  inflatePaths,
  area,
  pointInPolygon,
  ramerDouglasPeuckerPaths,
  FillRule,
  JoinType,
  EndType,
  PointInPolygonResult,
  type Path64,
  type Paths64,
} from 'clipper2-ts'
import { mulberry32, type Rng } from './prng'
import { ribbonSlice } from './ribbon'
import type { Ring } from './flatten'

export interface MosaicParams {
  /** target tile pitch, in font units (upm 1000) */
  tileSize: number
  /** grout line width, font units */
  grout: number
  /** 0..1 — per-tile randomisation of grout width */
  groutJitter: number
  /** 0..1 — jitter of seed placement */
  irregularity: number
  /** Lloyd relaxation iterations, 0..3 */
  relax: number
  /** corner rounding radius, font units, 0 = sharp */
  cornerRound: number
  /** tiles smaller than this fraction of tileSize² are dropped */
  minTileArea: number
  seeding: 'ribbon' | 'bands' | 'poisson'
  /**
   * Tile length as a multiple of the local stroke width. 1 gives square tiles;
   * lower is stubbier, higher makes longer slabs. Ribbon mode only.
   */
  aspect: number
  seed: number
  /**
   * Point-reduction tolerance in font units. Tiles come out of the clipper with
   * far more vertices than a straight-edged tile needs, and every one of them
   * costs bytes in the exported font — 1 unit at upm 1000 is invisible.
   */
  simplify: number
}

export const DEFAULT_PARAMS: MosaicParams = {
  tileSize: 62,
  grout: 11,
  groutJitter: 0.35,
  irregularity: 0.45,
  relax: 1,
  cornerRound: 4,
  minTileArea: 0.06,
  seeding: 'ribbon',
  aspect: 1,
  seed: 1337,
  simplify: 1.2,
}

/** one tile = one or more closed rings (a ring may be a hole) */
export type Tile = Ring[]

const SCALE = 100

function ringsToPaths64(rings: Ring[]): Paths64 {
  return rings.map((r) => r.map((p) => ({ x: Math.round(p.x * SCALE), y: Math.round(p.y * SCALE) })))
}

function paths64ToRings(paths: Paths64): Ring[] {
  return paths.map((p) => p.map((pt) => ({ x: pt.x / SCALE, y: pt.y / SCALE })))
}

function bounds(paths: Paths64) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of paths)
    for (const pt of p) {
      if (pt.x < minX) minX = pt.x
      if (pt.x > maxX) maxX = pt.x
      if (pt.y < minY) minY = pt.y
      if (pt.y > maxY) maxY = pt.y
    }
  return { minX, minY, maxX, maxY }
}

function perimeter(path: Path64): number {
  let len = 0
  for (let i = 0; i < path.length; i++) {
    const a = path[i]
    const b = path[(i + 1) % path.length]
    len += Math.hypot(b.x - a.x, b.y - a.y)
  }
  return len
}

/** resample a closed polyline at ~spacing intervals, with jitter along the path */
function resampleRing(path: Path64, spacing: number, jitter: number, rng: Rng): [number, number][] {
  const total = perimeter(path)
  if (total < spacing * 0.6) {
    return [[path[0].x, path[0].y]]
  }
  const n = Math.max(2, Math.round(total / spacing))
  const step = total / n
  const targets: number[] = []
  const phase = rng() * step
  for (let i = 0; i < n; i++) {
    const t = phase + i * step + (rng() - 0.5) * jitter * step
    targets.push(((t % total) + total) % total)
  }
  targets.sort((a, b) => a - b)
  const out: [number, number][] = []
  let acc = 0
  let ti = 0
  for (let i = 0; i < path.length && ti < targets.length; i++) {
    const a = path[i]
    const b = path[(i + 1) % path.length]
    const seg = Math.hypot(b.x - a.x, b.y - a.y)
    while (ti < targets.length && targets[ti] <= acc + seg) {
      const f = seg === 0 ? 0 : (targets[ti] - acc) / seg
      out.push([a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f])
      ti++
    }
    acc += seg
  }
  return out
}

/** contour-following seeds: successive inner offset rings, points spaced along each */
function bandSeeds(glyph: Paths64, tileSize: number, irregularity: number, rng: Rng): [number, number][] {
  const seeds: [number, number][] = []
  const band = tileSize * SCALE
  let ringIdx = 0
  for (;;) {
    const inset = (ringIdx + 0.5) * band
    const rings = inflatePaths(glyph, -inset, JoinType.Miter, EndType.Polygon, 2)
    if (rings.length === 0) break
    for (const r of rings) {
      if (Math.abs(area(r)) < band * band * 0.02) continue
      for (const s of resampleRing(r, band, irregularity, rng)) {
        const jr = irregularity * band * 0.25
        seeds.push([s[0] + (rng() - 0.5) * jr, s[1] + (rng() - 0.5) * jr])
      }
    }
    ringIdx++
    if (ringIdx > 200) break
  }
  return seeds
}

function poissonSeeds(glyph: Paths64, tileSize: number, irregularity: number, rng: Rng): [number, number][] {
  const b = bounds(glyph)
  const pad = tileSize * SCALE
  const w = b.maxX - b.minX + pad * 2
  const h = b.maxY - b.minY + pad * 2
  const minDist = tileSize * SCALE * (1 - 0.35 * irregularity)
  const pds = new PoissonDiskSampling({ shape: [w, h], minDistance: minDist, tries: 20 }, rng)
  return pds.fill().map(([x, y]) => [x + b.minX - pad, y + b.minY - pad] as [number, number])
}

function centroid(poly: [number, number][]): [number, number] {
  let a = 0, cx = 0, cy = 0
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i]
    const [x1, y1] = poly[(i + 1) % poly.length]
    const f = x0 * y1 - x1 * y0
    a += f
    cx += (x0 + x1) * f
    cy += (y0 + y1) * f
  }
  if (Math.abs(a) < 1e-9) return poly[0]
  return [cx / (3 * a), cy / (3 * a)]
}

function insideAny(paths: Paths64, x: number, y: number): boolean {
  let winding = 0
  const pt = { x: Math.round(x), y: Math.round(y) }
  for (const p of paths) {
    const r = pointInPolygon(pt, p)
    if (r !== PointInPolygonResult.IsOutside) winding += area(p) > 0 ? 1 : -1
  }
  return winding !== 0
}

export interface MosaicResult {
  tiles: Tile[]
  seedCount: number
}

/**
 * Fracture one glyph's outline (rings, font units, y-up) into mosaic tiles.
 * Deterministic for a given (rings, params).
 */
export function mosaicGlyph(rings: Ring[], params: MosaicParams): MosaicResult {
  const p = params
  const rng = mulberry32(p.seed)
  if (rings.length === 0) return { tiles: [], seedCount: 0 }

  const glyph = union(ringsToPaths64(rings), FillRule.NonZero)
  if (glyph.length === 0) return { tiles: [], seedCount: 0 }

  const glyphArea = Math.abs(area(glyph[0]))
  const tilePx = p.tileSize * SCALE

  // small-glyph guard: components that can't hold a few tiles ship solid
  const totalArea = glyph.reduce((s, r) => s + area(r), 0)
  if (Math.abs(totalArea) < (2.2 * tilePx) ** 2) {
    return { tiles: [paths64ToRings(glyph)], seedCount: 0 }
  }
  void glyphArea

  // Ribbon mode cuts across the stroke instead of tessellating the area, so it
  // shares none of the Voronoi path below.
  if (p.seeding === 'ribbon') {
    const { pieces, ribCount } = ribbonSlice(glyph, {
      tileLength: tilePx,
      aspect: p.aspect,
      grout: p.grout * SCALE,
      groutJitter: p.groutJitter,
      irregularity: p.irregularity,
      rng,
    })
    const minArea = p.minTileArea * tilePx * tilePx
    const kept = pieces.filter((r) => area(r) < 0 || Math.abs(area(r)) >= minArea * 0.35)
    const simplified =
      p.simplify > 0
        ? ramerDouglasPeuckerPaths(kept, p.simplify * SCALE).filter((r) => r.length >= 3)
        : kept
    const source = simplified.length > 0 ? simplified : kept
    // Group each hole with the tile that contains it, so a tile is a complete
    // contour set — right for nonzero winding in the font, and it makes the
    // reported tile count mean what it says.
    const outers = source.filter((r) => area(r) > 0)
    const holes = source.filter((r) => area(r) < 0)
    const grouped: Tile[] = outers.map((o) => [o])
    for (const h of holes) {
      const probe = { x: h[0].x, y: h[0].y }
      const owner = outers.findIndex((o) => pointInPolygon(probe, o) !== PointInPolygonResult.IsOutside)
      if (owner >= 0) grouped[owner].push(h)
    }
    return { tiles: grouped.map((g) => paths64ToRings(g)), seedCount: ribCount }
  }

  let seeds =
    p.seeding === 'bands'
      ? bandSeeds(glyph, p.tileSize, p.irregularity, rng)
      : poissonSeeds(glyph, p.tileSize, p.irregularity, rng)

  if (seeds.length < 3) {
    return { tiles: [paths64ToRings(glyph)], seedCount: seeds.length }
  }

  const b = bounds(glyph)
  const pad = tilePx * 2
  const box: [number, number, number, number] = [b.minX - pad, b.minY - pad, b.maxX + pad, b.maxY + pad]

  let delaunay = Delaunay.from(seeds)
  let voronoi = delaunay.voronoi(box)

  for (let iter = 0; iter < p.relax; iter++) {
    const moved: [number, number][] = []
    for (let i = 0; i < seeds.length; i++) {
      const cell = voronoi.cellPolygon(i)
      if (!cell) {
        moved.push(seeds[i])
        continue
      }
      const c = centroid(cell as unknown as [number, number][])
      // only relax seeds inside the glyph — edge structure stays put
      if (insideAny(glyph, seeds[i][0], seeds[i][1])) {
        moved.push([seeds[i][0] + (c[0] - seeds[i][0]) * 0.6, seeds[i][1] + (c[1] - seeds[i][1]) * 0.6])
      } else {
        moved.push(seeds[i])
      }
    }
    seeds = moved
    delaunay = Delaunay.from(seeds)
    voronoi = delaunay.voronoi(box)
  }

  const tiles: Tile[] = []
  const minArea = p.minTileArea * tilePx * tilePx
  const groutHalf = (p.grout / 2) * SCALE

  for (let i = 0; i < seeds.length; i++) {
    const cell = voronoi.cellPolygon(i)
    if (!cell) continue
    const cellPath: Path64 = (cell as unknown as [number, number][]).map(([x, y]) => ({
      x: Math.round(x),
      y: Math.round(y),
    }))
    const piece = intersect([cellPath], glyph, FillRule.NonZero)
    if (piece.length === 0) continue

    const pieceArea = Math.abs(piece.reduce((s, r) => s + area(r), 0))
    if (pieceArea < minArea * 0.5) continue

    const inset = groutHalf * (1 + p.groutJitter * (rng() * 2 - 1))
    let tile = inflatePaths(piece, -inset, JoinType.Miter, EndType.Polygon, 2)
    // thin-feature fallback: halve, then drop the inset before dropping the piece
    if (tile.length === 0) tile = inflatePaths(piece, -inset / 2, JoinType.Miter, EndType.Polygon, 2)
    if (tile.length === 0 && pieceArea > minArea) tile = piece
    if (tile.length === 0) continue

    if (p.cornerRound > 0) {
      const r = p.cornerRound * SCALE
      const opened = inflatePaths(
        inflatePaths(tile, -r, JoinType.Round, EndType.Polygon),
        r,
        JoinType.Round,
        EndType.Polygon,
      )
      if (opened.length > 0) tile = opened
    }

    const tileArea = Math.abs(tile.reduce((s, r) => s + area(r), 0))
    if (tileArea < minArea) continue

    if (p.simplify > 0) {
      const reduced = ramerDouglasPeuckerPaths(tile, p.simplify * SCALE)
      const kept = reduced.filter((r) => r.length >= 3)
      if (kept.length > 0) tile = kept
    }

    tiles.push(paths64ToRings(tile))
  }

  return { tiles, seedCount: seeds.length }
}
