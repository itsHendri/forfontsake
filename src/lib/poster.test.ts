import { describe, it, expect } from 'vitest'
import { buildPoster, settingsLine, chainName, LAYOUTS, POSTER_PALETTES } from './poster'
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
      // the marks every sheet carries, whichever band it sets
      expect(svg).toContain('FOR FONT&#39;S SAKE'.replace('&#39;', "'"))
      expect(svg).toContain('NO. 007')
      expect(svg).toContain('SEED 1337')
      expect(svg).toContain('FORFONTSAKE.XYZ')
      expect(svg).toContain('GRIT ON TEST FACE')
    })
  }

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
})
