import { describe, it, expect } from 'vitest'
import { shown, typed } from './units'
import type { ParamSpec } from '../engine/treatments/registry'

const spec = (unit?: ParamSpec['unit']): ParamSpec => ({ key: 'k', label: 'K', min: 0, max: 1, step: 0.05, default: 0, unit })

describe('a dial in its own unit', () => {
  it('shows a share as a percentage and a multiplier to two places', () => {
    expect(shown(0.35, spec('%'))).toBe('35%')
    expect(shown(1.5, spec('×'))).toBe('1.50×')
    expect(shown(0.35, spec())).toBe('0.35')
  })

  it('reads back what was typed, with or without the unit', () => {
    expect(typed('35', spec('%'))).toBeCloseTo(0.35)
    expect(typed('35%', spec('%'))).toBeCloseTo(0.35)
    expect(typed('1.5×', spec('×'))).toBe(1.5)
    expect(typed('0,4', spec())).toBe(0.4)
    expect(typed('', spec())).toBeNull()
    expect(typed('lots', spec())).toBeNull()
  })
})
