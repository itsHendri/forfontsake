import { describe, it, expect } from 'vitest'
import { outline } from './outline'
import { defaults } from './types'
import { mulberry32 } from '../prng'
import { isInside, normalise, SCALE } from '../paths'
import type { Ring } from '../flatten'
import type { TreatmentContext } from './types'

const ctx = (): TreatmentContext => ({
  rng: mulberry32(1337),
  unitsPerEm: 1000,
  // the median stem of the contrast fixture below
  strokeWidth: 160,
  advanceWidth: 600,
  penX: 0,
})

/**
 * A high-contrast pair: one stem at the median width and one hairline far
 * below it. The hairline is the case that broke — the band's inner offset is
 * wider than the stroke, so it collapses.
 */
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

describe('outline', () => {
  const p = defaults(outline)

  it('is deterministic', () => {
    const a = outline.apply(contrast(), p, ctx())
    const b = outline.apply(contrast(), p, ctx())
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b))
  })

  it.each([0, 1, 2])('produces a band in mode %i', (mode) => {
    const out = outline.apply(contrast(), { ...p, mode }, ctx())
    expect(out.length).toBeGreaterThan(0)
    expect(areaOf(out)).toBeGreaterThan(0)
  })

  it('keeps the hairline stroke on the page in inline mode', () => {
    // 36 units wide against a 160 median: the inline band cannot fit, and the
    // stroke must stay solid rather than vanish
    const out = outline.apply(contrast(), { ...p, mode: 2, weight: 22 }, ctx())
    expect(covers(out, 438, 400)).toBe(true)
  })

  it('still draws the band on the stroke that can carry one', () => {
    const out = outline.apply(contrast(), { ...p, mode: 2, weight: 22 }, ctx())
    // the wide stem keeps its stripe: its centre is hollow
    expect(covers(out, 180, 400)).toBe(false)
    // while its edges are inked
    expect(covers(out, 105, 400)).toBe(true)
  })

  it('survives a glyph made only of strokes too thin to band', () => {
    const out = outline.apply(hairline(), { ...p, mode: 2, weight: 40 }, ctx())
    expect(out.length).toBeGreaterThan(0)
    expect(areaOf(out)).toBeGreaterThan(0)
  })

  it('hollows the letter in outline mode', () => {
    const out = outline.apply(contrast(), { ...p, mode: 0, weight: 22 }, ctx())
    expect(covers(out, 180, 400)).toBe(false)
  })

  it('promises enough growth to cover the outward band', () => {
    const params = { ...p, mode: 0, weight: 40, inset: 20 }
    const promised = outline.growth!(params, ctx())
    const out = outline.apply(contrast(), params, ctx())
    const maxX = Math.max(...out.flat().map((pt) => pt.x))
    expect(maxX - 456).toBeLessThanOrEqual(promised)
  })
})
