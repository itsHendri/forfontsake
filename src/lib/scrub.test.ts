import { describe, it, expect } from 'vitest'
import { unitsPerPixel } from './scrub'

const plain = { shiftKey: false, altKey: false }

describe('scrubbing a label', () => {
  it('fits a wide range in about the width of the rail', () => {
    const r = { min: 0, max: 240, step: 1 }
    expect(unitsPerPixel(r, plain)).toBe(1)
  })

  it('never takes more than six pixels per step on a short range', () => {
    const r = { min: 0, max: 1, step: 0.05 }
    expect(r.step / unitsPerPixel(r, plain)).toBeCloseTo(6)
  })

  it('goes ten times finer with Shift and four times coarser with Alt', () => {
    const r = { min: 0, max: 100, step: 1 }
    const base = unitsPerPixel(r, plain)
    expect(unitsPerPixel(r, { shiftKey: true, altKey: false })).toBeCloseTo(base / 10)
    expect(unitsPerPixel(r, { shiftKey: false, altKey: true })).toBeCloseTo(base * 4)
  })

  it('moves an unbounded field one step per pixel', () => {
    expect(unitsPerPixel({ min: -Infinity, max: Infinity, step: 1 }, plain)).toBe(1)
  })
})
