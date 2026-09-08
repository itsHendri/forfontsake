import { describe, it, expect } from 'vitest'
import { migrateStep, isRetired } from './retired'
import { TREATMENTS } from './registry'
import { defaults } from './types'

/**
 * A shared link is a promise the tool made, and merging a treatment away is the
 * one change that can break it silently — the link still parses, it just names
 * something that is no longer there. These check that every retired id lands on
 * a treatment the registry can actually run, carrying dials that treatment has.
 */

const byId = new Map(TREATMENTS.map((t) => [t.id, t]))

describe('retired treatments', () => {
  it.each([
    ['soak', 'bubble'],
    ['outline', 'onion'],
    ['stipple', 'halftone'],
    ['ghost', 'extrude'],
  ])('%s opens on %s', (from, to) => {
    expect(isRetired(from)).toBe(true)
    const step = migrateStep({ id: from, params: {} })!
    expect(step.id).toBe(to)
    const host = byId.get(to)
    expect(host, `${to} is not in the registry`).toBeDefined()
    // every dial the migration writes has to exist on the host, or it rides
    // along as dead weight and the preset chips stop matching
    const keys = new Set(host!.params.map((s) => s.key))
    for (const key of Object.keys(step.params)) expect(keys, `${to} · ${key}`).toContain(key)
    // and every dial the host needs has to arrive, or it falls to a default
    // that has nothing to do with what the link asked for
    for (const key of keys) expect(Object.keys(step.params), `${to} · ${key}`).toContain(key)
  })

  it('gives Ghost a direction, because it read 0 as no direction at all', () => {
    // Extrude reads 0 as "throw it to the right", which is not what a wandering
    // fringe meant; anything the author actually chose carries over
    expect(migrateStep({ id: 'ghost', params: { drift: 14, angle: 0 } })!.params.angle).toBe(315)
    expect(migrateStep({ id: 'ghost', params: { drift: 14, angle: 135 } })!.params.angle).toBe(135)
    // and the fringe stays solid: the grey rebuild is a dial the link never set
    expect(migrateStep({ id: 'ghost', params: { drift: 26, mode: 1 } })!.params.screen).toBe(0)
    expect(migrateStep({ id: 'ghost', params: { drift: 26, mode: 1 } })!.params.layer).toBe(1)
  })

  it('drops a treatment that was cut, because nothing draws what it drew', () => {
    expect(isRetired('melt')).toBe(true)
    expect(migrateStep({ id: 'melt', params: { sag: 60 } })).toBeNull()
  })

  it('leaves a live treatment alone', () => {
    const step = { id: 'grit', params: { amount: 55 } }
    expect(migrateStep(step)).toBe(step)
    expect(isRetired('grit')).toBe(false)
  })

  it('carries Soak’s melt across at the scale Bubble reads it', () => {
    // Soak melted by a third of the stem; Bubble rounds by the share itself
    const step = migrateStep({ id: 'soak', params: { swell: 45, melt: 110, counters: 45 } })!
    expect(step.params.weight).toBe(45)
    expect(step.params.rounding).toBe(39)
    expect(step.params.squeeze).toBe(45)
  })

  it('swaps the ends of Outline’s style, which counted the other way', () => {
    // outline 0 sat outside the letter, 2 inside; onion counts inward from 0
    expect(migrateStep({ id: 'outline', params: { mode: 0 } })!.params.style).toBe(2)
    expect(migrateStep({ id: 'outline', params: { mode: 1 } })!.params.style).toBe(1)
    expect(migrateStep({ id: 'outline', params: { mode: 2 } })!.params.style).toBe(0)
  })

  it('opens Stipple scattered, which is the whole of what it was', () => {
    const step = migrateStep({ id: 'stipple', params: { density: 42, size: 100, spray: 0, solid: 0 } })!
    expect(step.params.scatter).toBe(100)
    expect(step.params.spacing).toBe(42)
  })

  it('turns Onion’s retired Outward into the Style it became', () => {
    expect(migrateStep({ id: 'onion', params: { outward: 100, lines: 4 } })!.params).toEqual({ lines: 4, style: 2 })
    expect(migrateStep({ id: 'onion', params: { outward: 0, lines: 3 } })!.params).toEqual({ lines: 3, style: 0 })
    // a step already written in the new shape is left exactly as it is
    const fresh = { id: 'onion', params: defaults(byId.get('onion')!) }
    expect(migrateStep(fresh)!.params).toEqual(fresh.params)
  })
})
