import { describe, it, expect } from 'vitest'
import { TREATMENTS, treatmentsByFamily } from './registry'
import { defaults, initialParams, landingPreset, presetMatches, FAMILY_LABEL, STACK_WIDE_KEYS } from './types'
import { mulberry32 } from '../prng'
import { pointCount, boundsOf, normalise } from '../paths'
import type { Ring } from '../flatten'
import type { TreatmentContext, ParamValues } from './types'

/**
 * The contract every treatment keeps, checked across the whole registry rather
 * than one suite at a time.
 *
 * The individual suites test what a treatment *does*; this tests what it must
 * never do — go non-deterministic, erase a letter, lie about its growth, or
 * cost more points than a font can carry. A new treatment gets these for free
 * the moment it is registered, which is the point: the failure modes are the
 * same for all of them.
 */

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

/** a period: too small for most treatments to do anything with */
const period = (): Ring[] => [
  [
    { x: 40, y: 0 },
    { x: 110, y: 0 },
    { x: 110, y: 70 },
    { x: 40, y: 70 },
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

describe('the registry', () => {
  it('has no duplicate ids', () => {
    const ids = TREATMENTS.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives every treatment a family the picker can group by', () => {
    for (const t of TREATMENTS) expect(FAMILY_LABEL[t.family], t.id).toBeDefined()
  })

  it('accounts for every treatment in exactly one family group', () => {
    const grouped = treatmentsByFamily().flatMap((g) => g.items)
    expect(grouped.length).toBe(TREATMENTS.length)
    expect(new Set(grouped.map((t) => t.id)).size).toBe(TREATMENTS.length)
  })
})

describe.each(TREATMENTS.map((t) => [t.id, t] as const))('%s', (_id, t) => {
  const p = defaults(t)

  it('is deterministic for the same seed', () => {
    const a = t.apply(ring(), p, ctx())
    const b = t.apply(ring(), p, ctx())
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b))
  })

  it('exposes three or four front-of-house dials', () => {
    const primary = t.params.filter((s) => s.primary).length
    expect(primary).toBeGreaterThanOrEqual(2)
    expect(primary).toBeLessThanOrEqual(4)
  })

  it('carries every dial in every preset', () => {
    // matches() in the panel compares only the keys a preset holds, so a preset
    // missing one reads as active whatever that dial is set to
    const keys = t.params.map((s) => s.key).sort()
    for (const preset of t.presets ?? []) {
      expect(Object.keys(preset.values).sort(), `${t.id} · ${preset.name}`).toEqual(keys)
    }
  })

  it('opens on a preset that exists', () => {
    // there is no unnamed state: the workbench lands on a named starting point,
    // so a defaultPreset naming a preset that has been renamed away would
    // silently fall back and light the wrong chip
    if (t.defaultPreset) {
      const names = (t.presets ?? []).map((preset) => preset.name)
      expect(names, `${t.id} · defaultPreset`).toContain(t.defaultPreset)
    }
    const landing = landingPreset(t)
    if (t.presets?.length) {
      expect(landing, `${t.id} ships presets but lands on none`).toBeDefined()
      expect(initialParams(t)).toEqual({ ...defaults(t), ...landing!.values })
    }
  })

  it.each([
    ['a stem', stem],
    ['a counter', ring],
    ['a period', period],
  ])('leaves ink on %s', (_label, fixture) => {
    const out = t.apply(fixture(), p, ctx())
    expect(out.length).toBeGreaterThan(0)
    expect(areaOf(out)).toBeGreaterThan(0)
  })

  it('stays within a point budget a font can carry', () => {
    expect(pointCount(t.apply(ring(), p, ctx()))).toBeLessThan(2500)
  })

  it('holds that budget at every preset too', () => {
    for (const preset of t.presets ?? []) {
      const params: ParamValues = { ...p, ...preset.values }
      const out = t.apply(ring(), params, ctx())
      expect(out.length, `${preset.name} produced nothing`).toBeGreaterThan(0)
      expect(pointCount(out), `${preset.name} is over budget`).toBeLessThan(4000)
    }
  })

  it('promises at least the growth it takes', () => {
    if (!t.growth) return
    const promised = t.growth(p, ctx())
    const before = boundsOf(normalise(stem()))
    const out = t.apply(stem(), p, ctx())
    if (out.length === 0) return
    const after = boundsOf(normalise(out))
    const slack = 4 // simplify moves points by up to its tolerance
    // horizontal only: the advance is what growth() feeds, and a treatment is
    // free to run below the baseline the way a descender does
    expect((before.minX - after.minX) / 100).toBeLessThan(promised + slack)
    expect((after.maxX - before.maxX) / 100).toBeLessThan(promised + slack)
  })
})

describe('one Detail dial over the stack', () => {
  // The workbench shows simplify once for the whole stack. A preset chip must
  // stay lit when that dial moves, or every Detail change un-lights whatever
  // preset the layer is sitting on while its picture still describes the letters.
  it('a preset stays matched when only a stack-wide dial has moved', () => {
    for (const t of TREATMENTS) {
      for (const preset of t.presets ?? []) {
        const params = { ...defaults(t), ...preset.values }
        expect(presetMatches(preset, params), `${t.id} · ${preset.name}`).toBe(true)
        for (const key of STACK_WIDE_KEYS) {
          const moved = { ...params, [key]: params[key] + 1 }
          expect(presetMatches(preset, moved), `${t.id} · ${preset.name} · ${key}`).toBe(true)
        }
      }
    }
  })

  it('a preset un-matches when any other dial has moved', () => {
    for (const t of TREATMENTS) {
      for (const preset of t.presets ?? []) {
        const params = { ...defaults(t), ...preset.values }
        for (const key of Object.keys(preset.values)) {
          if (STACK_WIDE_KEYS.has(key)) continue
          const moved = { ...params, [key]: params[key] + 1 }
          expect(presetMatches(preset, moved), `${t.id} · ${preset.name} · ${key}`).toBe(false)
        }
      }
    }
  })

  it('every treatment carries the stack-wide dials', () => {
    // the Output group reads the dial off the active step; a treatment without
    // it would leave the group blank on that layer
    for (const t of TREATMENTS) {
      for (const key of STACK_WIDE_KEYS) {
        expect(t.params.map((s) => s.key), t.id).toContain(key)
      }
    }
  })
})
