import { describe, it, expect } from 'vitest'
import { grit } from './grit'
import { defaults } from './types'
import { mulberry32 } from '../prng'
import { pointCount } from '../paths'
import type { Ring } from '../flatten'
import type { TreatmentContext } from './types'

const ctx = (seed = 1337): TreatmentContext => ({
  rng: mulberry32(seed),
  unitsPerEm: 1000,
  // matches the stem fixture below, which is 160 units wide
  strokeWidth: 160,
  advanceWidth: 600,
  penX: 0,
})

/** a stem, the shape a treatment has to survive */
const stem = (): Ring[] => [
  [
    { x: 220, y: 60 },
    { x: 380, y: 60 },
    { x: 380, y: 740 },
    { x: 220, y: 740 },
  ],
]

/** a counter-bearing shape, like an O */
const ring = (): Ring[] => [
  [
    { x: 100, y: 100 },
    { x: 700, y: 100 },
    { x: 700, y: 700 },
    { x: 100, y: 700 },
  ],
  [
    { x: 300, y: 300 },
    { x: 300, y: 500 },
    { x: 500, y: 500 },
    { x: 500, y: 300 },
  ],
]

const areaOf = (rings: Ring[]) => {
  let total = 0
  for (const r of rings) {
    let a = 0
    for (let i = 0; i < r.length; i++) {
      const p = r[i]
      const q = r[(i + 1) % r.length]
      a += p.x * q.y - q.x * p.y
    }
    total += a / 2
  }
  return Math.abs(total)
}

describe('grit', () => {
  const p = defaults(grit)

  it('is deterministic for the same seed', () => {
    const a = grit.apply(stem(), p, ctx())
    const b = grit.apply(stem(), p, ctx())
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b))
  })

  it('differs with the seed', () => {
    const a = grit.apply(stem(), p, ctx(1))
    const b = grit.apply(stem(), p, ctx(2))
    expect(JSON.stringify(a)).not.toEqual(JSON.stringify(b))
  })

  it('passes the glyph through untouched at amount 0', () => {
    const input = stem()
    const out = grit.apply(input, { ...p, amount: 0 }, ctx())
    expect(out).toEqual(input)
  })

  it('erodes the shape without destroying it', () => {
    const before = areaOf(stem())
    const after = areaOf(grit.apply(stem(), p, ctx()))
    // some ink is lost, but the letter must still be substantially there —
    // this is the guard against grit eating stroke cores
    expect(after).toBeLessThan(before)
    expect(after).toBeGreaterThan(before * 0.7)
  })

  it('keeps eroding as the amount rises', () => {
    const light = areaOf(grit.apply(stem(), { ...p, amount: 20 }, ctx()))
    const heavy = areaOf(grit.apply(stem(), { ...p, amount: 90 }, ctx()))
    expect(heavy).toBeLessThan(light)
  })

  it('leaves counters open', () => {
    const out = grit.apply(ring(), p, ctx())
    // the hole must survive as a hole: at least one contour winds the other way
    const winding = out.map((r) => {
      let a = 0
      for (let i = 0; i < r.length; i++) {
        const q = r[i]
        const w = r[(i + 1) % r.length]
        a += q.x * w.y - w.x * q.y
      }
      return Math.sign(a)
    })
    expect(new Set(winding).size).toBeGreaterThan(1)
  })

  it('stays within a sane point budget', () => {
    const out = grit.apply(stem(), { ...p, amount: 100, speckle: 100, bite: 100 }, ctx())
    expect(pointCount(out)).toBeLessThan(2000)
  })

  it('survives a glyph too small to erode', () => {
    const period: Ring[] = [
      [
        { x: 40, y: 0 },
        { x: 110, y: 0 },
        { x: 110, y: 70 },
        { x: 40, y: 70 },
      ],
    ]
    const out = grit.apply(period, p, ctx())
    expect(out.length).toBeGreaterThan(0)
    expect(areaOf(out)).toBeGreaterThan(0)
  })
})
