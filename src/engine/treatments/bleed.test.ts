import { describe, it, expect } from 'vitest'
import { bleed } from './bleed'
import { defaults } from './types'
import { mulberry32 } from '../prng'
import { pointCount } from '../paths'
import type { Ring } from '../flatten'
import type { TreatmentContext } from './types'

const ctx = (seed = 1337): TreatmentContext => ({
  rng: mulberry32(seed),
  unitsPerEm: 1000,
  strokeWidth: 160,
  advanceWidth: 600,
  penX: 0,
})

const stem = (): Ring[] => [
  [
    { x: 220, y: 60 },
    { x: 380, y: 60 },
    { x: 380, y: 740 },
    { x: 220, y: 740 },
  ],
]

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

const signedArea = (r: Ring) => {
  let a = 0
  for (let i = 0; i < r.length; i++) {
    const p = r[i]
    const q = r[(i + 1) % r.length]
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

const counterArea = (rings: Ring[]) =>
  rings.reduce((sum, r) => (signedArea(r) < 0 ? sum + Math.abs(signedArea(r)) : sum), 0)

describe('bleed', () => {
  const p = defaults(bleed)

  it('is deterministic for the same seed', () => {
    const a = bleed.apply(ring(), p, ctx())
    const b = bleed.apply(ring(), p, ctx())
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b))
  })

  it('differs with the seed', () => {
    const a = bleed.apply(ring(), p, ctx(1))
    const b = bleed.apply(ring(), p, ctx(2))
    expect(JSON.stringify(a)).not.toEqual(JSON.stringify(b))
  })

  it('spreads the ink outward', () => {
    const before = Math.abs(signedArea(stem()[0]))
    const after = bleed.apply(stem(), p, ctx()).reduce((s, r) => s + Math.abs(signedArea(r)), 0)
    expect(after).toBeGreaterThan(before)
  })

  it('keeps the counter open where the pooling would seal it', () => {
    // the inside of a counter is all concave, so pooling attacks it first
    const out = bleed.apply(ring(200), { ...p, amount: 100, pooling: 100 }, ctx())
    expect(counterArea(out)).toBeGreaterThan(0)
  })

  it('keeps even a small counter open', () => {
    const out = bleed.apply(ring(80), { ...p, amount: 100, pooling: 100 }, ctx())
    expect(counterArea(out)).toBeGreaterThan(0)
  })

  it('lets the ink swallow the counter when the dial says so', () => {
    const out = bleed.apply(ring(200), { ...p, amount: 100, pooling: 100, counters: 0 }, ctx())
    expect(out.length).toBeGreaterThan(0)
    expect(counterArea(out)).toBeLessThan(
      counterArea(bleed.apply(ring(200), { ...p, amount: 100, pooling: 100 }, ctx())),
    )
  })

  it('passes the glyph through at spread 0', () => {
    const out = bleed.apply(stem(), { ...p, amount: 0 }, ctx())
    expect(out.length).toBe(1)
  })

  it('stays within a sane point budget', () => {
    const out = bleed.apply(ring(), { ...p, amount: 120, unevenness: 100, grain: 5 }, ctx())
    expect(pointCount(out)).toBeLessThan(3000)
  })
})
