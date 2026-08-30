import { describe, it, expect } from 'vitest'
import { encodeState, decodeState, type WorkbenchState } from './urlState'

const base: WorkbenchState = {
  fontId: 'pirataone',
  seed: 1337,
  alternates: 3,
  text: 'Grittier letters',
  chain: [{ id: 'grit', params: { amount: 55, scale: 58 } }],
}

describe('urlState', () => {
  it('round-trips a single treatment', () => {
    const back = decodeState('#' + encodeState(base))
    expect(back).toEqual(base)
  })

  it('round-trips a stack', () => {
    const stacked: WorkbenchState = {
      ...base,
      chain: [
        { id: 'grit', params: { amount: 55, scale: 58 } },
        { id: 'bleed', params: { amount: 40, grain: 22 } },
        { id: 'outline', params: { mode: 2, weight: 30 } },
      ],
    }
    const back = decodeState('#' + encodeState(stacked))
    expect(back).toEqual(stacked)
    expect(back!.chain.map((s) => s.id)).toEqual(['grit', 'bleed', 'outline'])
  })

  it('still opens a link written before stacking existed', () => {
    // The exact shape the old encoder produced: one treatment in field 1, one
    // parameter group in field 4, no `+` anywhere. These links are in the wild
    // and in people's shelves, so this is the test that must not break.
    const old = '#pirataone|grit|1337|3|amount:55,scale:58|Grittier%20letters'
    const back = decodeState(old)
    expect(back).not.toBeNull()
    expect(back!.chain).toHaveLength(1)
    expect(back!.chain[0].id).toBe('grit')
    expect(back!.chain[0].params).toEqual({ amount: 55, scale: 58 })
    expect(back!.text).toBe('Grittier letters')
    expect(back!.seed).toBe(1337)
  })

  it('keeps the field count at six, so the old parser shape holds', () => {
    const stacked = { ...base, chain: [...base.chain, { id: 'bleed', params: { amount: 40 } }] }
    expect(encodeState(stacked).split('|')).toHaveLength(6)
  })

  it('survives a stack whose parameter groups are missing', () => {
    // hand-written or truncated: two treatments, one group
    const back = decodeState('#pirataone|grit+bleed|1|1|amount:55|Hi')
    expect(back!.chain).toHaveLength(2)
    expect(back!.chain[1].params).toEqual({})
  })

  it('refuses junk rather than throwing', () => {
    expect(decodeState('')).toBeNull()
    expect(decodeState('#too|few|fields')).toBeNull()
    expect(decodeState('#pirataone|grit|nope|3|amount:55|Hi')).toBeNull()
    expect(decodeState('#pirataone||1|1|amount:55|Hi')).toBeNull()
  })

  it('encodes text that would otherwise break the field separators', () => {
    const tricky = { ...base, text: 'a|b+c%d' }
    expect(decodeState('#' + encodeState(tricky))!.text).toBe('a|b+c%d')
  })
})
