import { describe, it, expect } from 'vitest'
import {
  SHEET_W,
  SHEET_H,
  buildPoster,
  buildPosterLayers,
  settingsLine,
  chainName,
  LAYOUTS,
  POSTER_PALETTES,
} from './poster'
import { defaults, getTreatment } from '../engine/treatments/registry'
import type { FontData } from './glyphData'

/** a two-glyph face, enough to exercise every path without a real font */
const font: FontData = {
  label: 'Test Face',
  note: '',
  reserved: [],
  src: '/x.ttf',
  sourceGlyphs: 2,
  unitsPerEm: 1000,
  strokeWidth: 120,
  ascender: 800,
  descender: -200,
  glyphs: {
    A: { adv: 600, rings: [[100, 0, 500, 0, 500, 700, 100, 700]] },
    B: { adv: 600, rings: [[120, 0, 480, 0, 480, 700, 120, 700]] },
    a: { adv: 560, rings: [[110, 0, 450, 0, 450, 520, 110, 520]] },
  },
}

const req = (layout?: string) => ({
  font,
  fontId: 'test',
  chain: [{ id: 'grit', params: defaults(getTreatment('grit')) }],
  seed: 1337,
  word: 'AB',
  palette: POSTER_PALETTES[0],
  number: 7,
  layout,
})

/** the browser's parser is not here, so check the shape the hard way */
function wellFormed(svg: string) {
  expect(svg.startsWith('<svg')).toBe(true)
  expect(svg.endsWith('</svg>')).toBe(true)
  // every tag opened is closed — a truncated path would break every consumer
  const opens = (svg.match(/<g[ >]/g) ?? []).length
  const closes = (svg.match(/<\/g>/g) ?? []).length
  expect(opens).toBe(closes)
  expect(svg).not.toContain('undefined')
  expect(svg).not.toContain('NaN')
}

describe('poster', () => {
  it('offers more than one sheet', () => {
    expect(LAYOUTS.length).toBeGreaterThan(1)
    expect(new Set(LAYOUTS.map((l) => l.id)).size).toBe(LAYOUTS.length)
  })

  for (const layout of LAYOUTS) {
    it(`builds the ${layout.name} sheet`, () => {
      const svg = buildPoster(req(layout.id))
      wellFormed(svg)
      // the sheet is made to be posted: Instagram portrait, 4:5
      expect(svg).toContain('viewBox="0 0 1080 1350"')
      // the marks every sheet carries, whichever band it sets
      expect(svg).toContain('FOR FONT&#39;S SAKE'.replace('&#39;', "'"))
      expect(svg).toContain('NO. 007')
      expect(svg).toContain('SEED 1337')
      expect(svg).toContain('FORFONTSAKE.XYZ')
      expect(svg).toContain('GRIT ON TEST FACE')
      // furniture the redesign removed stays removed
      expect(svg).not.toContain('BUILT IN THE BROWSER')
    })
  }

  it('places the word where the user has put it', () => {
    const base = buildPoster(req('word'))
    const moved = buildPoster({ ...req('word'), wordTransform: { dx: 120, dy: -80, scale: 0.5 } })
    wellFormed(moved)
    expect(moved).not.toBe(base)
    // identity transform is the same sheet, byte for byte
    expect(buildPoster({ ...req('word'), wordTransform: { dx: 0, dy: 0, scale: 1 } })).toBe(base)
    // the word group is addressable, for the overlay's drag handling
    expect(base).toContain('data-part="word"')
    // the character-set sheet ignores it
    expect(buildPoster({ ...req('chars'), wordTransform: { dx: 120, dy: -80, scale: 0.5 } })).toBe(
      buildPoster(req('chars')),
    )
  })

  it('sets something different in the band for each sheet', () => {
    const word = buildPoster(req('word'))
    const chars = buildPoster(req('chars'))
    expect(word).not.toBe(chars)
    // the character set draws every glyph it has, so it carries more groups
    const groups = (s: string) => (s.match(/<g[ >]/g) ?? []).length
    expect(groups(chars)).toBeGreaterThan(groups(word))
  })

  it('falls back to the first sheet when the layout is unknown', () => {
    expect(buildPoster(req('no-such-layout'))).toBe(buildPoster(req('word')))
    expect(buildPoster(req(undefined))).toBe(buildPoster(req('word')))
  })

  it('is deterministic for the same request', () => {
    expect(buildPoster(req('chars'))).toBe(buildPoster(req('chars')))
  })

  it('names a stack in the caption and the settings line', () => {
    const chain = [
      { id: 'grit', params: defaults(getTreatment('grit')) },
      { id: 'bleed', params: defaults(getTreatment('bleed')) },
    ]
    expect(chainName(chain)).toBe('Grit + Bleed')
    // with more than one step each dial group is named, or the numbers are
    // unreadable
    const line = settingsLine(chain)
    expect(line).toContain('Grit:')
    expect(line).toContain('Bleed:')
    // one step needs no naming
    expect(settingsLine([chain[0]])).not.toContain('Grit:')
  })

  it('escapes text that would otherwise break the markup', () => {
    const svg = buildPoster({ ...req('word'), font: { ...font, label: 'A & B <script>' } })
    expect(svg).toContain('&amp;')
    expect(svg).not.toContain('<script>')
  })

  /*
   * Two ways of drawing one sheet is the sort of pair that drifts, so the
   * composed sheet and the layered one are pinned to each other here.
   */
  it('cuts into layers that put the sheet back together', () => {
    const r = req('word')
    const { ground, word } = buildPosterLayers(r)
    expect(word).toBeTruthy()
    // every mark the composed sheet carries is in one layer or the other
    const composed = buildPoster(r)
    const marks = composed.match(/<(path|text|rect|line)[^>]*>/g) ?? []
    expect(marks.length).toBeGreaterThan(4)
    for (const mark of marks) {
      expect(ground.includes(mark) || word!.includes(mark), mark.slice(0, 60)).toBe(true)
    }
  })

  it('leaves the word layer where it is when only the offset moves', () => {
    const still = buildPosterLayers({ ...req('word'), wordTransform: { dx: 0, dy: 0, scale: 1.4 } })
    const dragged = buildPosterLayers({ ...req('word'), wordTransform: { dx: 220, dy: -60, scale: 1.4 } })
    // the offset is the shader's uniform, so it must not reach the geometry
    expect(dragged.word).toBe(still.word)
    expect(dragged.ground).toBe(still.ground)
  })

  it('bakes a resize into the word layer, because that one does rebuild', () => {
    const small = buildPosterLayers({ ...req('word'), wordTransform: { dx: 0, dy: 0, scale: 1 } })
    const large = buildPosterLayers({ ...req('word'), wordTransform: { dx: 0, dy: 0, scale: 1.8 } })
    expect(large.word).not.toBe(small.word)
  })

  it('keeps the whole character set on the ground layer', () => {
    const { ground, word } = buildPosterLayers(req('chars'))
    expect(word).toBeNull()
    expect(ground).toBe(buildPoster(req('chars')))
  })

  /*
   * The canvas has no DOM to hit-test, so this rectangle is what tells a
   * pointer whether it is on the word or on the paper. If it drifts from the
   * transform beside it, dragging starts missing.
   */
  it('boxes the word where the sheet actually draws it', () => {
    const { wordBox, word } = buildPosterLayers(req('word'))
    expect(wordBox).toBeTruthy()
    const box = wordBox!
    expect(box.w).toBeGreaterThan(0)
    expect(box.h).toBeGreaterThan(0)
    // inside the sheet, and inside the margins the sheet reserves
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.x + box.w).toBeLessThanOrEqual(SHEET_W + 1)
    expect(box.y + box.h).toBeLessThanOrEqual(SHEET_H + 1)
    // the box's left edge is where the word layer's own transform puts it
    const translate = word!.match(/translate\((-?[\d.]+), (-?[\d.]+)\) scale\(/)
    expect(translate).toBeTruthy()
    expect(box.x).toBeCloseTo(Number(translate![1]), 0)
  })

  it(`grows the box about the word's centre, as the scale does`, () => {
    const one = buildPosterLayers({ ...req('word'), wordTransform: { dx: 0, dy: 0, scale: 1 } }).wordBox!
    const two = buildPosterLayers({ ...req('word'), wordTransform: { dx: 0, dy: 0, scale: 2 } }).wordBox!
    expect(two.w).toBeCloseTo(one.w * 2, 3)
    expect(two.h).toBeCloseTo(one.h * 2, 3)
    // same centre, so growing the word does not shove it off the sheet
    expect(two.x + two.w / 2).toBeCloseTo(one.x + one.w / 2, 3)
    expect(two.y + two.h / 2).toBeCloseTo(one.y + one.h / 2, 3)
  })

  it(`leaves the drag out of the box, because that is the shader's job`, () => {
    const still = buildPosterLayers({ ...req('word'), wordTransform: { dx: 0, dy: 0, scale: 1 } }).wordBox!
    const moved = buildPosterLayers({ ...req('word'), wordTransform: { dx: 300, dy: 90, scale: 1 } }).wordBox!
    expect(moved).toEqual(still)
  })
})
