import { describe, it, expect } from 'vitest'
import { area } from 'clipper2-ts'
import { normalise, grow, growStrict, keepCounters, SCALE } from './paths'
import type { Ring } from './flatten'

/** a counter-bearing shape, like an O — outer box, inner hole */
const ring = (inner = 200): Ring[] => [
  [
    { x: 100, y: 100 },
    { x: 700, y: 100 },
    { x: 700, y: 700 },
    { x: 100, y: 700 },
  ],
  [
    { x: 400 - inner / 2, y: 400 - inner / 2 },
    { x: 400 - inner / 2, y: 400 + inner / 2 },
    { x: 400 + inner / 2, y: 400 + inner / 2 },
    { x: 400 + inner / 2, y: 400 - inner / 2 },
  ],
]

const solid = (): Ring[] => [
  [
    { x: 220, y: 60 },
    { x: 380, y: 60 },
    { x: 380, y: 740 },
    { x: 220, y: 740 },
  ],
]

/** total area of the negative-winding rings — the counters, in font units */
const holeArea = (paths: ReturnType<typeof normalise>) =>
  paths.reduce((sum, r) => (area(r) < 0 ? sum + Math.abs(area(r)) : sum), 0) / (SCALE * SCALE)

describe('growStrict', () => {
  it('returns nothing when the shape collapses', () => {
    const glyph = normalise(solid()) // 160 units wide
    expect(growStrict(glyph, -200)).toHaveLength(0)
  })

  it('is where grow differs — grow hands the input back instead', () => {
    const glyph = normalise(solid())
    expect(grow(glyph, -200)).toEqual(glyph)
  })
})

describe('keepCounters', () => {
  it('reopens a counter the growth sealed shut', () => {
    const glyph = normalise(ring(200))
    const closed = grow(glyph, 140) // 140 > half the 200-wide hole: sealed
    expect(holeArea(closed)).toBe(0)

    const guarded = keepCounters(closed, glyph, 140, 0.35)
    expect(holeArea(guarded)).toBeGreaterThan(0)
  })

  it('leaves an aperture in a counter smaller than the closure', () => {
    // hole inradius 40; a closure of 300 would shrink it out of existence
    const glyph = normalise(ring(80))
    const closed = grow(glyph, 300)
    const guarded = keepCounters(closed, glyph, 300, 0.35)
    expect(holeArea(guarded)).toBeGreaterThan(0)
  })

  it('keeps more of the counter as minAperture rises', () => {
    const glyph = normalise(ring(200))
    const closed = grow(glyph, 140)
    const tight = holeArea(keepCounters(closed, glyph, 140, 0.1))
    const open = holeArea(keepCounters(closed, glyph, 140, 0.8))
    expect(open).toBeGreaterThan(tight)
  })

  it('passes a glyph with no counters through untouched', () => {
    const glyph = normalise(solid())
    const grown = grow(glyph, 40)
    expect(keepCounters(grown, glyph, 40, 0.35)).toEqual(grown)
  })

  it('never carves the letter open — the guard only ever removes ink', () => {
    const glyph = normalise(ring(200))
    const closed = grow(glyph, 140)
    const guarded = keepCounters(closed, glyph, 140, 0.35)
    const total = (paths: ReturnType<typeof normalise>) =>
      Math.abs(paths.reduce((s, r) => s + area(r), 0))
    expect(total(guarded)).toBeLessThanOrEqual(total(closed))
  })
})
