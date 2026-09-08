import { describe, it, expect } from 'vitest'
import { onion } from './onion'
import { defaults } from './types'
import { mulberry32 } from '../prng'
import { isInside, normalise, SCALE } from '../paths'
import type { Ring } from '../flatten'
import type { TreatmentContext } from './types'

/**
 * Onion carries what Outline used to, so it inherits Outline's tests. The
 * hairline cases are the ones that broke before and the reason the band is
 * built with a strict offset: a stroke too thin to hold a line has to stay on
 * the page solid rather than vanish.
 */

const ctx = (): TreatmentContext => ({
  rng: mulberry32(1337),
  unitsPerEm: 1000,
  // the median stem of the contrast fixture below
  strokeWidth: 160,
  advanceWidth: 600,
  penX: 0,
})

/** one stem at the median width and one hairline far below it */
const contrast = (): Ring[] => [
  [
    { x: 100, y: 60 },
    { x: 260, y: 60 },
    { x: 260, y: 740 },
    { x: 100, y: 740 },
  ],
  [
    { x: 420, y: 60 },
    { x: 456, y: 60 },
    { x: 456, y: 740 },
    { x: 420, y: 740 },
  ],
]

const hairline = (): Ring[] => [contrast()[1]]

const covers = (rings: Ring[], x: number, y: number) =>
  isInside(normalise(rings), x * SCALE, y * SCALE)

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

describe('onion', () => {
  const p = defaults(onion)
  const one = { ...p, lines: 1, weight: 22 }

  it('is deterministic', () => {
    const a = onion.apply(contrast(), p, ctx())
    const b = onion.apply(contrast(), p, ctx())
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b))
  })

  it.each([0, 1, 2])('produces a band in style %i', (style) => {
    const out = onion.apply(contrast(), { ...one, style }, ctx())
    expect(out.length).toBeGreaterThan(0)
    expect(areaOf(out)).toBeGreaterThan(0)
  })

  it('keeps the hairline stroke on the page in the inside style', () => {
    // 36 units wide against a 160 median: the band cannot fit, and the stroke
    // must stay solid rather than vanish
    const out = onion.apply(contrast(), { ...one, style: 0 }, ctx())
    expect(covers(out, 438, 400)).toBe(true)
  })

  it('still draws the band on the stroke that can carry one', () => {
    const out = onion.apply(contrast(), { ...one, style: 0 }, ctx())
    // the wide stem keeps its stripe: its centre is hollow
    expect(covers(out, 180, 400)).toBe(false)
    // while its edges are inked
    expect(covers(out, 105, 400)).toBe(true)
  })

  it('survives a glyph made only of strokes too thin to band', () => {
    const out = onion.apply(hairline(), { ...one, style: 0, weight: 40 }, ctx())
    expect(out.length).toBeGreaterThan(0)
    expect(areaOf(out)).toBeGreaterThan(0)
  })

  it('hollows the letter in the outside style', () => {
    const out = onion.apply(contrast(), { ...one, style: 2 }, ctx())
    expect(covers(out, 180, 400)).toBe(false)
  })

  it('promises enough growth to cover the outward rings', () => {
    const params = { ...p, style: 2, lines: 3, weight: 40, position: 20 }
    const promised = onion.growth!(params, ctx())
    const out = onion.apply(contrast(), params, ctx())
    const maxX = Math.max(...out.flat().map((pt) => pt.x))
    expect(maxX - 456).toBeLessThanOrEqual(promised)
  })

  it('stops when the letter runs out of room rather than drawing nothing', () => {
    // eight rings will not fit inside a 160-unit stem; the run stops early and
    // still returns the rings that did fit
    const out = onion.apply(contrast(), { ...p, style: 0, lines: 8, weight: 20, gap: 20 }, ctx())
    expect(out.length).toBeGreaterThan(0)
    expect(areaOf(out)).toBeGreaterThan(0)
  })

  describe('beaded', () => {
    it('breaks the ring into separate pieces', () => {
      const band = onion.apply(contrast(), { ...one, style: 1, weight: 40 }, ctx())
      const beads = onion.apply(contrast(), { ...one, style: 1, weight: 40, beaded: 60 }, ctx())
      // a drawn ring is one contour per stroke; discs pulled apart are many
      expect(beads.length).toBeGreaterThan(band.length)
      expect(areaOf(beads)).toBeGreaterThan(0)
    })

    it('keeps the discs the width of the line they replace', () => {
      const out = onion.apply(contrast(), { ...one, style: 1, weight: 40, beaded: 60 }, ctx())
      const maxX = Math.max(...out.flat().map((pt) => pt.x))
      // half a bead past the outer edge, and no further
      const half = (40 * 160) / 100 / 2
      expect(maxX - 456).toBeLessThanOrEqual(half + 4)
    })

    it('stays within the point budget when every ring is beaded', () => {
      const out = onion.apply(contrast(), { ...p, style: 0, lines: 8, weight: 10, gap: 4, beaded: 100 }, ctx())
      expect(out.reduce((n, r) => n + r.length, 0)).toBeLessThan(2500)
    })
  })
})
