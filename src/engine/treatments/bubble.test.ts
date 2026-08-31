import { describe, it, expect } from 'vitest'
import { bubble } from './bubble'
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

/** a counter-bearing shape, like an O; `inner` is the counter's width */
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

/** area of the counters — the hole the letter has to keep */
const counterArea = (rings: Ring[]) =>
  rings.reduce((sum, r) => (signedArea(r) < 0 ? sum + Math.abs(signedArea(r)) : sum), 0)

describe('bubble', () => {
  const p = defaults(bubble)

  it('is deterministic', () => {
    const a = bubble.apply(ring(), p, ctx())
    const b = bubble.apply(ring(), p, ctx(99))
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b))
  })

  it('fattens the letter', () => {
    const before = Math.abs(signedArea(stem()[0]))
    const after = bubble.apply(stem(), p, ctx()).reduce((s, r) => s + Math.abs(signedArea(r)), 0)
    expect(after).toBeGreaterThan(before)
  })

  it('keeps the counter open at a weight that would seal it', () => {
    // weight 120% of a 160 stem is 192 units of growth onto a 200-wide hole:
    // without the guard the counter is gone
    const out = bubble.apply(ring(200), { ...p, weight: 120, squeeze: 100 }, ctx())
    expect(counterArea(out)).toBeGreaterThan(0)
  })

  it('keeps even a small counter open', () => {
    const out = bubble.apply(ring(80), { ...p, weight: 120, squeeze: 100 }, ctx())
    expect(counterArea(out)).toBeGreaterThan(0)
  })

  it('opens the counter further as the squeeze rises', () => {
    const tight = counterArea(bubble.apply(ring(200), { ...p, weight: 90, squeeze: 10 }, ctx()))
    const open = counterArea(bubble.apply(ring(200), { ...p, weight: 90, squeeze: 100 }, ctx()))
    expect(open).toBeGreaterThan(tight)
  })

  it('still lets the counter fill at squeeze 0', () => {
    // the blob is a look you can ask for; the guard is off when the dial is
    const out = bubble.apply(ring(200), { ...p, weight: 120, squeeze: 0 }, ctx())
    expect(out.length).toBeGreaterThan(0)
    expect(counterArea(out)).toBe(0)
  })

  it('promises enough growth to cover what it adds', () => {
    const params = { ...p, weight: 60 }
    const promised = bubble.growth!(params, ctx())
    const out = bubble.apply(stem(), params, ctx())
    const maxX = Math.max(...out.flat().map((pt) => pt.x))
    expect(maxX - 380).toBeLessThanOrEqual(promised)
  })

  it('stays within a sane point budget', () => {
    const out = bubble.apply(ring(), { ...p, weight: 150, rounding: 150 }, ctx())
    expect(pointCount(out)).toBeLessThan(2000)
  })
})
