import { describe, it, expect } from 'vitest'
import { BANDS, DEFAULT_DEPTH, bandFor, drivable, modulate, type Bindings } from './modulate'
import { defaults, getTreatment } from '../engine/treatments/registry'
import type { Step } from './urlState'

const grit = getTreatment('grit')
const step = (id = 'grit'): Step => ({ id, params: defaults(getTreatment(id)) })

/** a drive vector with one band pushed and the rest silent */
function only(band: (typeof BANDS)[number], amount = 1): number[] {
  return BANDS.map((b) => (b === band ? amount : 0))
}

describe('what the sound moves', () => {
  it('drives the first four drivable dials in declared order by default', () => {
    const dials = drivable(step())
    expect(dials.length).toBeGreaterThanOrEqual(4)
    BANDS.forEach((band, i) => {
      const out = modulate([step()], only(band))[0].params
      const spec = dials[i]
      // the dial on that band moved, and only it
      expect(out[spec.key], `${spec.key} should follow ${band}`).toBeGreaterThan(step().params[spec.key])
      dials.forEach((other, j) => {
        if (j !== i) expect(out[other.key], `${other.key} should be still`).toBe(step().params[other.key])
      })
    })
  })

  it('leaves a dial alone once it is bound to nothing', () => {
    const spec = drivable(step())[0]
    const bindings: Bindings = { ['0:' + spec.key]: null }
    const out = modulate([step()], only('bass'), bindings)[0].params
    expect(out[spec.key]).toBe(step().params[spec.key])
  })

  it('moves a dial onto whichever band it is reassigned to', () => {
    const spec = drivable(step())[0]
    // the first dial defaults to bass; put it on the highs instead
    const bindings: Bindings = { ['0:' + spec.key]: 'high' }
    const onBass = modulate([step()], only('bass'), bindings)[0].params
    const onHigh = modulate([step()], only('high'), bindings)[0].params
    expect(onBass[spec.key]).toBe(step().params[spec.key])
    expect(onHigh[spec.key]).toBeGreaterThan(step().params[spec.key])
  })

  it('binds each layer of a stack separately', () => {
    const chain = [step('grit'), step('bubble')]
    const first = drivable(chain[0])[0]
    const second = drivable(chain[1])[0]
    // silence the first layer's leading dial, leave the second's alone
    const out = modulate(chain, only('bass'), { ['0:' + first.key]: null })
    expect(out[0].params[first.key]).toBe(chain[0].params[first.key])
    expect(out[1].params[second.key]).toBeGreaterThan(chain[1].params[second.key])
  })

  it('holds every dial at its set point when the depth is nothing', () => {
    const out = modulate([step()], [1, 1, 1, 1], {}, 0)[0].params
    expect(out).toEqual(step().params)
  })

  it('keeps a driven dial inside its own range', () => {
    for (const depth of [DEFAULT_DEPTH, 1]) {
      for (const drive of [[1, 1, 1, 1], [-1, -1, -1, -1]]) {
        const out = modulate([step()], drive, {}, depth)[0].params
        for (const spec of grit.params) {
          expect(out[spec.key], `${spec.key} at depth ${depth}`).toBeGreaterThanOrEqual(spec.min)
          expect(out[spec.key]).toBeLessThanOrEqual(spec.max)
        }
      }
    }
  })

  it('never offers a steady dial to the sound', () => {
    // a mode switch driven by audio alternates rather than animates
    const pixel = getTreatment('pixel')
    const steady = pixel.params.filter((s) => s.steady)
    expect(steady.length).toBeGreaterThan(0)
    const offered = drivable(step('pixel')).map((s) => s.key)
    for (const s of steady) expect(offered).not.toContain(s.key)
    const out = modulate([step('pixel')], [1, 1, 1, 1])[0].params
    for (const s of steady) expect(out[s.key]).toBe(defaults(pixel)[s.key])
  })

  it('never touches the treatment a step names', () => {
    const chain = [step('grit'), step('bubble')]
    expect(modulate(chain, [1, 1, 1, 1]).map((s) => s.id)).toEqual(['grit', 'bubble'])
  })

  it('reads a dial past the fourth as bound to nothing', () => {
    const dials = drivable(step())
    if (dials.length <= BANDS.length) return
    expect(bandFor({}, 0, dials[BANDS.length].key, BANDS.length)).toBeNull()
  })
})
