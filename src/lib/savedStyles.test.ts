import { describe, it, expect, afterEach } from 'vitest'
import { isKept, loadShelf, saveShelf, SHELF_LIMIT, toggleKept } from './savedStyles'
import type { WorkbenchState } from './urlState'

const state = (seed: number): WorkbenchState => ({
  fontId: 'pirataone',
  seed,
  alternates: 3,
  text: 'Coral',
  chain: [{ id: 'growth', params: { spread: 30, steps: 8 } }],
})

/** the smallest thing that behaves like Storage, since tests run without a DOM */
function fakeStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    get size() {
      return map.size
    },
  }
}

function install(store: unknown) {
  Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true })
}

afterEach(() => {
  Reflect.deleteProperty(globalThis as object, 'localStorage')
})

describe('savedStyles', () => {
  it('round-trips a shelf', () => {
    install(fakeStorage())
    saveShelf([state(1), state(2)])
    const back = loadShelf()
    expect(back).toHaveLength(2)
    expect(back[0].seed).toBe(1)
    expect(back[1].seed).toBe(2)
    expect(back[0].chain[0].params.spread).toBe(30)
    expect(back[0].text).toBe('Coral')
  })

  it('returns nothing rather than throwing when there is no storage at all', () => {
    // a private window does not merely hand back an empty store — touching it
    // throws, and this is the path that would otherwise take the page down
    expect(() => loadShelf()).not.toThrow()
    expect(loadShelf()).toEqual([])
    expect(() => saveShelf([state(1)])).not.toThrow()
  })

  it('survives storage that throws on write', () => {
    install({
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    })
    expect(() => saveShelf([state(1)])).not.toThrow()
  })

  it('drops one corrupt entry rather than the whole shelf', () => {
    const store = fakeStorage()
    install(store)
    saveShelf([state(1), state(2)])
    const lines = JSON.parse(store.getItem('ffs:shelf:v1')!) as string[]
    store.setItem('ffs:shelf:v1', JSON.stringify([lines[0], 'not|a|valid', 42, lines[1]]))

    const back = loadShelf()
    expect(back).toHaveLength(2)
    expect(back.map((s) => s.seed)).toEqual([1, 2])
  })

  it('ignores junk in the slot', () => {
    const store = fakeStorage()
    install(store)
    store.setItem('ffs:shelf:v1', '{ not json')
    expect(loadShelf()).toEqual([])
    store.setItem('ffs:shelf:v1', '{"not":"an array"}')
    expect(loadShelf()).toEqual([])
  })

  it('caps what it stores, so a long session cannot fill the quota', () => {
    install(fakeStorage())
    saveShelf(Array.from({ length: SHELF_LIMIT + 8 }, (_, i) => state(i)))
    expect(loadShelf()).toHaveLength(SHELF_LIMIT)
  })
})

describe('keeping and forgetting', () => {
  const one: WorkbenchState = { fontId: 'pirataone', seed: 1, alternates: 3, text: 'One', chain: [{ id: 'halftone', params: {} }] }
  const two: WorkbenchState = { ...one, text: 'Two' }

  it('says nothing is kept on an empty shelf', () => {
    expect(isKept([], one)).toBe(false)
  })

  it('knows the font in front of you by the same encoding the URL uses', () => {
    expect(isKept([one], { ...one })).toBe(true)
    expect(isKept([one], two)).toBe(false)
  })

  it('keeps what is not kept, newest first', () => {
    expect(toggleKept([two], one)).toEqual([one, two])
  })

  it('forgets what is, which the old Save font could not do', () => {
    expect(toggleKept([one, two], one)).toEqual([two])
  })

  it('drops the oldest rather than growing past the cap', () => {
    const many = Array.from({ length: SHELF_LIMIT }, (_, i) => ({ ...one, text: `w${i}` }))
    const next = toggleKept(many, one)
    expect(next).toHaveLength(SHELF_LIMIT)
    expect(next[0]).toEqual(one)
    expect(next).not.toContainEqual(many[SHELF_LIMIT - 1])
  })
})
