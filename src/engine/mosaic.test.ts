import { describe, it, expect } from 'vitest'
import { mosaicGlyph, DEFAULT_PARAMS } from './mosaic'
import type { Ring } from './flatten'

function square(cx: number, cy: number, half: number, clockwise = false): Ring {
  const pts = [
    { x: cx - half, y: cy - half },
    { x: cx + half, y: cy - half },
    { x: cx + half, y: cy + half },
    { x: cx - half, y: cy + half },
  ]
  return clockwise ? pts.reverse() : pts
}

const ringArea = (r: Ring) => {
  let a = 0
  for (let i = 0; i < r.length; i++) {
    const p = r[i]
    const q = r[(i + 1) % r.length]
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

/** a tall thin stroke, the shape the engine is actually built for */
const stem = (): Ring[] => [
  [
    { x: 220, y: 60 },
    { x: 380, y: 60 },
    { x: 380, y: 1740 },
    { x: 220, y: 1740 },
  ],
]

describe('mosaicGlyph', () => {
  it('is deterministic for identical params', () => {
    const rings = stem()
    const a = mosaicGlyph(rings, DEFAULT_PARAMS)
    const b = mosaicGlyph(rings, DEFAULT_PARAMS)
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b))
    expect(a.tiles.length).toBeGreaterThan(2)
  })

  it('changes with the seed', () => {
    const rings = stem()
    const a = mosaicGlyph(rings, DEFAULT_PARAMS)
    const b = mosaicGlyph(rings, { ...DEFAULT_PARAMS, seed: 42 })
    expect(JSON.stringify(a)).not.toEqual(JSON.stringify(b))
  })

  it('emits small glyphs solid instead of tiling them (period survives)', () => {
    const period = [square(50, 50, 45)]
    const r = mosaicGlyph(period, DEFAULT_PARAMS)
    expect(r.tiles.length).toBe(1)
    const covered = Math.abs(r.tiles[0].reduce((s, ring) => s + ringArea(ring), 0))
    expect(covered).toBeGreaterThan(90 * 90 * 0.95)
  })

  it('keeps counters open (no tile centre inside the hole of an O)', () => {
    const outer = square(400, 400, 380)
    const hole = square(400, 400, 180, true)
    const r = mosaicGlyph([outer, hole], { ...DEFAULT_PARAMS, seeding: 'poisson' })
    expect(r.tiles.length).toBeGreaterThan(4)
    for (const tile of r.tiles) {
      const flat = tile.flat()
      const cx = flat.reduce((s, p) => s + p.x, 0) / flat.length
      const cy = flat.reduce((s, p) => s + p.y, 0) / flat.length
      const inHole = Math.abs(cx - 400) < 170 && Math.abs(cy - 400) < 170
      const tileHasHole = tile.length > 1
      expect(inHole && !tileHasHole).toBe(false)
    }
  })

  it('ribbon mode cuts a stroke into slabs and leaves the silhouette intact', () => {
    // a tall thin stem, like a blackletter stroke
    const r = mosaicGlyph(stem(), { ...DEFAULT_PARAMS, seeding: 'ribbon', tileSize: 100, grout: 12 })
    expect(r.tiles.length).toBeGreaterThan(4)
    // every slab should span most of the stem's width — that is the whole point
    for (const tile of r.tiles) {
      const xs = tile[0].map((pt) => pt.x)
      const width = Math.max(...xs) - Math.min(...xs)
      expect(width).toBeGreaterThan(150)
    }
  })

  it('band seeding also respects holes', () => {
    const outer = square(400, 400, 380)
    const hole = square(400, 400, 180, true)
    const r = mosaicGlyph([outer, hole], { ...DEFAULT_PARAMS, seeding: 'bands' })
    expect(r.tiles.length).toBeGreaterThan(4)
    let covered = 0
    for (const tile of r.tiles) covered += Math.abs(tile.reduce((s, ring) => s + ringArea(ring), 0))
    const glyphArea = 760 * 760 - 360 * 360
    expect(covered).toBeLessThan(glyphArea)
    expect(covered).toBeGreaterThan(glyphArea * 0.4)
  })

  it('returns nothing for empty input', () => {
    expect(mosaicGlyph([], DEFAULT_PARAMS).tiles).toEqual([])
  })
})
