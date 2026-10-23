import { describe, it, expect } from 'vitest'
import { addable, finishOf, finishesOn, layerRows, sheetSummary, type LayerState } from './composeLayers'
import { finishState, pictureState, type FinishState } from './finish'
import { getFormat, getLayout } from './poster'

const IDENTITY = { dx: 0, dy: 0, scale: 1, rotate: 0 }

function state(over: Partial<LayerState> = {}): LayerState {
  return {
    layout: getLayout('word'),
    word: 'Halftone',
    format: getFormat('post'),
    finishes: finishState(),
    wordT: IDENTITY,
    ground: 'flat',
    backdrop: null,
    picture: pictureState(),
    motionOn: false,
    ...over,
  }
}

/** a stack with these finishes on */
function withOn(...ids: string[]): FinishState {
  const s = finishState()
  for (const id of ids) s[id] = { ...s[id], on: true }
  return s
}

describe("Compose's layer list", () => {
  it('reads sheet, finishes, word, background — and nothing nested with no finish on', () => {
    const rows = layerRows(state())
    expect(rows.map((r) => r.sel)).toEqual(['sheet', 'finishes', 'word', 'background'])
    expect(rows[0].sub).toBe('Post 4:5')
    expect(rows[1].sub).toBe('none')
    expect(rows[2]).toMatchObject({ name: 'Halftone', sub: 'centred' })
    expect(rows[3].sub).toBe('flat')
  })

  it('nests a row for each finish that is on, in the order they are applied', () => {
    const rows = layerRows(state({ finishes: withOn('grain', 'scanline') }))
    expect(rows.map((r) => r.sel)).toEqual(['sheet', 'finishes', 'finish:scanline', 'finish:grain', 'word', 'background'])
    expect(rows[1].sub).toBe('Scanner · Grain')
    expect(rows.filter((r) => r.nested).map((r) => r.name)).toEqual(['Scanner', 'Grain'])
  })

  it('says where the word is, that it moves, or that the sheet sets it', () => {
    expect(layerRows(state({ wordT: { ...IDENTITY, dx: 40, scale: 1.2 } }))[2].sub).toBe('placed · 1.20×')
    expect(layerRows(state({ motionOn: true }))[2].sub).toBe('~ moves')
    const chars = layerRows(state({ layout: getLayout('chars') }))[2]
    expect(chars).toMatchObject({ name: getLayout('chars').name, sub: 'set to the sheet' })
  })

  it('names the picture and what is done to it', () => {
    const picture = pictureState()
    picture.halftone = { ...picture.halftone, on: true }
    expect(layerRows(state({ backdrop: 'data:', picture }))[3].sub).toBe('picture · halftone')
    expect(layerRows(state({ backdrop: 'data:' }))[3].sub).toBe('picture')
  })
})

describe('adding and selecting finishes', () => {
  it('offers the finishes that are off, and only those', () => {
    expect(addable(finishState()).map((f) => f.id)).toEqual(['scanline', 'riso', 'grain'])
    expect(addable(withOn('riso')).map((f) => f.id)).toEqual(['scanline', 'grain'])
    expect(finishesOn(withOn('riso')).map((f) => f.id)).toEqual(['riso'])
  })

  it('reads a finish back out of a selection', () => {
    expect(finishOf('finish:riso')?.name).toBe('Riso')
    expect(finishOf('finish:nope')).toBeUndefined()
    expect(finishOf('word')).toBeUndefined()
  })
})

describe('the sheet in one line', () => {
  it('says the layout, the format and the motion', () => {
    expect(sheetSummary({ layout: getLayout('word'), format: getFormat('post'), motion: null })).toBe('Word · Post 4:5 · Still')
    expect(sheetSummary({ layout: getLayout('word'), format: getFormat('story'), motion: 'Pulse' })).toBe(
      'Word · Story 9:16 · Pulse',
    )
  })
})
