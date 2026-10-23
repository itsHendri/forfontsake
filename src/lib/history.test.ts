import { describe, it, expect } from 'vitest'
import { HISTORY_LIMIT, emptyHistory, record, redo, undo } from './history'

describe('undo and redo', () => {
  it('goes back through what was there, and forward again', () => {
    let h = emptyHistory<string>()
    h = record(h, 'a') // a → b
    h = record(h, 'b') // b → c
    const back = undo(h, 'c')!
    expect(back.to).toBe('b')
    const further = undo(back.history, 'b')!
    expect(further.to).toBe('a')
    expect(undo(further.history, 'a')).toBeNull()
    const again = redo(further.history, 'a')!
    expect(again.to).toBe('b')
    expect(redo(again.history, 'b')!.to).toBe('c')
  })

  it('forgets the future once something new is done', () => {
    let h = record(record(emptyHistory<string>(), 'a'), 'b')
    h = undo(h, 'c')!.history
    expect(h.future).toEqual(['c'])
    h = record(h, 'b')
    expect(h.future).toEqual([])
    expect(redo(h, 'd')).toBeNull()
  })

  it('keeps only so far back', () => {
    let h = emptyHistory<number>()
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) h = record(h, i)
    expect(h.past).toHaveLength(HISTORY_LIMIT)
    expect(h.past[0]).toBe(20)
  })
})
