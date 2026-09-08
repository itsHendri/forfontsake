import { describe, it, expect } from 'vitest'
import { fur } from './fur'
import { defaults } from './types'
import { mulberry32 } from '../prng'
import { boundsOf, normalise } from '../paths'
import type { Ring } from '../flatten'
import type { TreatmentContext } from './types'

/**
 * Fur stands or falls on knowing which way is out, and it is never told: the
 * direction comes from the winding the union leaves behind. Get that wrong and
 * the hairs on a stem grow inward through the letter, and the ones in a counter
 * fill it in — so those are the two cases worth pinning.
 */

const ctx = (seed = 1337): TreatmentContext => ({
  rng: mulberry32(seed),
  unitsPerEm: 1000,
  strokeWidth: 160,
  advanceWidth: 600,
  penX: 0,
})

/** a square with a square hole: an outer edge and a counter, both to grow off */
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

const inHole = (rings: Ring[]) =>
  rings.flat().filter((p) => p.x > 305 && p.x < 495 && p.y > 305 && p.y < 495).length

describe('fur', () => {
  const p = defaults(fur)

  it('is deterministic for the same seed', () => {
    expect(JSON.stringify(fur.apply(ring(), p, ctx()))).toEqual(
      JSON.stringify(fur.apply(ring(), p, ctx())),
    )
  })

  it('grows hair off every side of the letter', () => {
    const before = boundsOf(normalise(ring()))
    const after = boundsOf(normalise(fur.apply(ring(), p, ctx())))
    expect(after.minX).toBeLessThan(before.minX)
    expect(after.minY).toBeLessThan(before.minY)
    expect(after.maxX).toBeGreaterThan(before.maxX)
    expect(after.maxY).toBeGreaterThan(before.maxY)
  })

  it('grows hair into a counter rather than out of it', () => {
    // the same outward rule has to send these the other way, or an `o` fills in
    expect(inHole(ring())).toBe(0)
    expect(inHole(fur.apply(ring(), p, ctx()))).toBeGreaterThan(0)
  })

  it('leaves the counter open — the hairs line it, they do not fill it', () => {
    const out = fur.apply(ring(), { ...p, length: 40 }, ctx())
    // a hole 200 wide, hairs 64 long: the middle has to survive
    const holes = normalise(out).filter((r) => {
      let a = 0
      for (let i = 0; i < r.length; i++) {
        const q = r[i]
        const s = r[(i + 1) % r.length]
        a += q.x * s.y - s.x * q.y
      }
      return a < 0
    })
    expect(holes.length).toBeGreaterThan(0)
  })

  it('makes every hair the same length once wander is off', () => {
    const out = fur.apply(ring(), { ...p, wander: 0, lean: 0, length: 50 }, ctx())
    const after = boundsOf(normalise(out))
    // 50% of a 160 stem, straight out, on every side
    expect((after.maxX - 700 * 100) / 100).toBeCloseTo(80, -1)
    expect((100 * 100 - after.minX) / 100).toBeCloseTo(80, -1)
  })

  it('thins the coat rather than refusing when the roots would not fit', () => {
    const out = fur.apply(ring(), { ...p, density: 6, length: 30 }, ctx())
    expect(out.length).toBeGreaterThan(0)
    expect(out.reduce((n, r) => n + r.length, 0)).toBeLessThan(2500)
  })
})
