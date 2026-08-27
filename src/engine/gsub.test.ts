import { describe, it, expect } from 'vitest'
import { buildRotatingGsub, buildGsub, isCarriedFeature } from './gsub'

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

describe('carried source rules', () => {
  const ligature = { kind: 'ligature' as const, feature: 'liga', components: [20, 20, 30], ligature: 40 }
  const single = { kind: 'single' as const, feature: 'case', from: 50, to: 51 }

  it('registers a feature per carried tag, in tag order', () => {
    const t = buildGsub({ carried: [ligature, single] })
    const featureList = read16(t, 6)
    expect(read16(t, featureList)).toBe(2)
    expect(readTag(t, featureList + 2)).toBe('case')
    expect(readTag(t, featureList + 8)).toBe('liga')
  })

  it('writes carried lookups before the rotation, so ligatures form first', () => {
    const t = buildGsub({ carried: [ligature], alternates: sets })
    const lookupList = read16(t, 8)
    // one ligature lookup, then two substitutions and two chains for the cycle
    expect(read16(t, lookupList)).toBe(5)
    const firstLookup = lookupList + read16(t, lookupList + 2)
    expect(read16(t, firstLookup)).toBe(4) // LookupType 4 = ligature
  })

  it('never carries a rule into calt, which the rotation owns', () => {
    const t = buildGsub({ carried: [{ ...single, feature: 'calt' }, ligature] })
    const featureList = read16(t, 6)
    expect(read16(t, featureList)).toBe(1)
    expect(readTag(t, featureList + 2)).toBe('liga')
  })

  it('ignores features it cannot reproduce faithfully', () => {
    expect(isCarriedFeature('liga')).toBe(true)
    expect(isCarriedFeature('locl')).toBe(false)
    expect(isCarriedFeature('aalt')).toBe(false)
  })

  it('refuses to write an empty table', () => {
    expect(() => buildGsub({})).toThrow(/nothing to write/)
  })
})
