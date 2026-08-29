import { describe, it, expect } from 'vitest'
import { growth } from './growth'
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

const perimeterOf = (rings: Ring[]) => {
  let total = 0
  for (const r of rings)
    for (let i = 0; i < r.length; i++) {
      const a = r[i]
      const b = r[(i + 1) % r.length]
      total += Math.hypot(b.x - a.x, b.y - a.y)
    }
  return total
}

const boundsOf = (rings: Ring[]) => {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const r of rings)
    for (const p of r) {
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y
      if (p.y > maxY) maxY = p.y
    }
  return { minX, minY, maxX, maxY }
}

describe('growth', () => {
  const p = defaults(growth)

  it('is deterministic for the same seed', () => {
    const a = growth.apply(stem(), p, ctx())
    const b = growth.apply(stem(), p, ctx())
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b))
  })

  it('differs with the seed', () => {
    const a = growth.apply(stem(), p, ctx(1))
    const b = growth.apply(stem(), p, ctx(2))
    expect(JSON.stringify(a)).not.toEqual(JSON.stringify(b))
  })

  it('passes the glyph through untouched at spread 0', () => {
    const input = stem()
    expect(growth.apply(input, { ...p, spread: 0 }, ctx())).toEqual(input)
  })

  it('passes the glyph through untouched at 0 steps', () => {
    const input = stem()
    expect(growth.apply(input, { ...p, steps: 0 }, ctx())).toEqual(input)
  })

  it('moves the outline without dissolving the letter', () => {
    const before = areaOf(stem())
    const after = areaOf(growth.apply(stem(), p, ctx()))
    expect(after).toBeGreaterThan(before * 0.75)
    expect(after).toBeLessThan(before * 2)
  })

  it('never travels further than growth() promises', () => {
    // the advance widths are widened by exactly this much, so an outline that
    // outran it would set solid in the exported font
    const promised = growth.growth!({ ...p, spread: 90, steps: 60 }, ctx())
    const before = boundsOf(stem())
    const after = boundsOf(growth.apply(stem(), { ...p, spread: 90, steps: 60 }, ctx()))
    const slack = 2 // simplify moves points by up to its tolerance
    expect(before.minX - after.minX).toBeLessThan(promised + slack)
    expect(after.maxX - before.maxX).toBeLessThan(promised + slack)
    expect(before.minY - after.minY).toBeLessThan(promised + slack)
    expect(after.maxY - before.maxY).toBeLessThan(promised + slack)
  })

  it('buckles further as the steps rise', () => {
    // Perimeter, not point count: the folding is the curve getting longer
    // inside the same leash, and the union at the end resolves the crossings
    // back down to about the point count it started with.
    const few = perimeterOf(growth.apply(ring(), { ...p, steps: 2, simplify: 0 }, ctx()))
    const many = perimeterOf(growth.apply(ring(), { ...p, steps: 40, simplify: 0 }, ctx()))
    expect(many).toBeGreaterThan(few * 1.1)
  })

  it('grows the edge well past the outline it started from', () => {
    // The guard against the treatment quietly doing nothing. Insertion is what
    // lets the curve lengthen at all; without it this sits at about 1.05 however
    // many steps it runs, which is the trembling that an earlier cut of this
    // treatment shipped as growth.
    const before = perimeterOf(ring())
    const after = perimeterOf(growth.apply(ring(), { ...p, steps: 30, simplify: 0 }, ctx()))
    expect(after).toBeGreaterThan(before * 1.15)
  })

  it('leaves counters open', () => {
    const out = growth.apply(ring(), p, ctx())
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
    const out = growth.apply(stem(), { ...p, spread: 120, steps: 60, detail: 4 }, ctx())
    expect(pointCount(out)).toBeLessThan(2000)
  })

  it('survives a glyph too small to grow', () => {
    const period: Ring[] = [
      [
        { x: 40, y: 0 },
        { x: 110, y: 0 },
        { x: 110, y: 70 },
        { x: 40, y: 70 },
      ],
    ]
    const out = growth.apply(period, p, ctx())
    expect(out.length).toBeGreaterThan(0)
    expect(areaOf(out)).toBeGreaterThan(0)
  })
})
