import { describe, it, expect } from 'vitest'
import { TREATMENTS, treatmentsByFamily } from './registry'
import {
  defaults,
  initialParams,
  landingPreset,
  presetMatches,
  specimenFor,
  FAMILY_LABEL,
  STACK_WIDE_KEYS,
} from './types'
import { mulberry32 } from '../prng'
import { boundsOf, inkArea, normalise, pointCount } from '../paths'
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
    expect(inkArea(out)).toBeGreaterThan(0)
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

  it('groups all of its dials, or none of them', () => {
    // Half-grouped leaves orphans under whichever heading happens to precede
    // them, which reads as a mis-filed dial rather than an ungrouped one
    const dials = t.params.filter((s) => !STACK_WIDE_KEYS.has(s.key))
    const named = dials.filter((s) => s.group)
    if (named.length === 0) return
    expect(named.length, `${t.id} groups only some of its dials`).toBe(dials.length)
  })

  it('keeps each run of dials together in the list', () => {
    // The panel takes its order from this list, so a group split across it
    // would render as two headings of the same name — or, worse, silently
    // reorder the dials the sound reads
    const seen = new Set<string>()
    let last: string | undefined
    for (const spec of t.params) {
      if (!spec.group) continue
      if (spec.group === last) continue
      expect(seen.has(spec.group), `${t.id} · ${spec.group} is split`).toBe(false)
      seen.add(spec.group)
      last = spec.group
    }
  })

  it('never puts a heading over a single dial', () => {
    // A run of one is the tell that the grouping was invented to be tidy
    // rather than found; that treatment should stay flat instead
    const counts = new Map<string, number>()
    for (const s of t.params) {
      if (!s.group) continue
      counts.set(s.group, (counts.get(s.group) ?? 0) + 1)
    }
    for (const [group, n] of counts) expect(n, `${t.id} · ${group}`).toBeGreaterThan(1)
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

describe('what the sound rides', () => {
  /*
   * `modulate` takes the first four primary, non-steady dials in the order
   * they are declared. Grouping the panel meant rearranging those lists, and
   * the sheet's motion would have changed without a word — so the four are
   * written down here for the treatments whose lists moved. Changing this
   * table is fine; changing it by accident is what this stops.
   */
  it.each([
    ['halftone', ['spacing', 'scatter', 'spray', 'fade']],
    ['pixel', ['cell', 'noise', 'spread', 'fade']],
    ['extrude', ['depth', 'angle', 'taper', 'screen']],
    ['onion', ['lines', 'weight']],
  ])('%s', (id, expected) => {
    const t = TREATMENTS.find((x) => x.id === id)!
    const driven = t.params
      .filter((s) => s.primary && !s.steady)
      .slice(0, 4)
      .map((s) => s.key)
    expect(driven).toEqual(expected)
  })
})

/**
 * The word the workbench writes for itself when nobody has typed their own.
 *
 * It has to be told apart from a reader's own text without a flag — App asks
 * "is this one of ours?" against the set of these — so two treatments sharing
 * a word would mean switching between them leaves the page unchanged, and an
 * override that merely restates the default form is a line nobody needs.
 */
describe('specimens', () => {
  it('are distinct, so switching style visibly changes the word', () => {
    const words = TREATMENTS.map(specimenFor)
    expect(new Set(words).size).toBe(words.length)
  })

  it('are only overridden where the plain form would not do', () => {
    for (const t of TREATMENTS) {
      if (t.specimen) expect(t.specimen).not.toBe(`${t.name} letters`)
    }
  })
})

/**
 * Preset names are how a look gets talked about — in the shelf, in a note to
 * somebody, in the docs — and none of those places carry the treatment beside
 * the name. Two treatments both shipping "Blotted" meant a sentence about
 * Blotted was ambiguous, and the two did not even look alike.
 */
describe('preset names', () => {
  it('are used once across the whole tool', () => {
    const owners = new Map<string, string[]>()
    for (const t of TREATMENTS) {
      for (const p of t.presets ?? []) {
        const key = p.name.toLowerCase()
        owners.set(key, [...(owners.get(key) ?? []), t.name])
      }
    }
    const clashes = [...owners.entries()]
      .filter(([, who]) => who.length > 1)
      .map(([name, who]) => `${name}: ${who.join(', ')}`)
    expect(clashes).toEqual([])
  })
})

/**
 * Which preset a treatment opens on, written down.
 *
 * `landingPreset` falls through to `presets[0]` when `defaultPreset` is not
 * set, so the landing is positional for most treatments — and reordering a
 * preset list into a ladder silently moved Onion's landing onto the outline it
 * had absorbed, with every test still green. Ordering a list is a presentation
 * decision; which preset a treatment opens on is not, and the two should not
 * be able to change each other by accident.
 */
describe('landings', () => {
  it.each([
    ['grit', 'Sandblast'],
    ['bubble', 'Marker'],
    ['bleed', 'Damp'],
    ['growth', 'Swell'],
    ['fur', 'Fuzz'],
    ['halftone', 'Classic 45°'],
    ['hatch', 'Cross-hatched'],
    ['scanline', 'Level lines'],
    ['pixel', 'Bitmap'],
    ['extrude', 'Block'],
    ['onion', 'Three rings'],
    ['mosaic', 'Calçada'],
    ['shatter', 'Knocked askew'],
  ])('%s opens on %s', (id, expected) => {
    const t = TREATMENTS.find((x) => x.id === id)!
    expect(landingPreset(t)?.name).toBe(expected)
  })

  it('covers every treatment, so a new one cannot slip in unpinned', () => {
    expect(TREATMENTS.length).toBe(13)
  })
})

