import { describe, it, expect } from 'vitest'
import { buildRotatingGsub } from './gsub'

const read16 = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1]
const readTag = (b: Uint8Array, at: number) =>
  String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3])

const sets = [
  { base: 10, variants: [100, 200] },
  { base: 11, variants: [101, 201] },
]

describe('buildRotatingGsub', () => {
  it('writes a version 1.0 header with the three list offsets', () => {
    const t = buildRotatingGsub(sets)
    expect(read16(t, 0)).toBe(1)
    expect(read16(t, 2)).toBe(0)
    for (const at of [4, 6, 8]) {
      const offset = read16(t, at)
      expect(offset).toBeGreaterThan(0)
      expect(offset).toBeLessThan(t.length)
    }
  })

  it('registers a calt feature', () => {
    const t = buildRotatingGsub(sets)
    const featureList = read16(t, 6)
    expect(read16(t, featureList)).toBe(1)
    expect(readTag(t, featureList + 2)).toBe('calt')
  })

  it('covers every requested script', () => {
    const t = buildRotatingGsub(sets, ['DFLT', 'latn'])
    const scriptList = read16(t, 4)
    expect(read16(t, scriptList)).toBe(2)
    expect(readTag(t, scriptList + 2)).toBe('DFLT')
    expect(readTag(t, scriptList + 8)).toBe('latn')
  })

  it('writes one substitution and one chain per step of the rotation', () => {
    // two variants means a three-deep cycle, so two steps substitute and the
    // third wraps back to the default and needs no lookup
    const t = buildRotatingGsub(sets)
    const lookupList = read16(t, 8)
    expect(read16(t, lookupList)).toBe(4)
  })

  it('scales the lookup count with the number of variants', () => {
    const one = buildRotatingGsub([{ base: 10, variants: [100] }])
    expect(read16(one, read16(one, 8))).toBe(2)

    const three = buildRotatingGsub([{ base: 10, variants: [100, 200, 300] }])
    expect(read16(three, read16(three, 8))).toBe(6)
  })

  it('refuses sets that would fall out of step with each other', () => {
    expect(() =>
      buildRotatingGsub([
        { base: 10, variants: [100, 200] },
        { base: 11, variants: [101] },
      ]),
    ).toThrow(/same number/)
  })

  it('refuses an empty request', () => {
    expect(() => buildRotatingGsub([])).toThrow(/no alternate sets/)
    expect(() => buildRotatingGsub([{ base: 10, variants: [] }])).toThrow(/at least one/)
  })
})
