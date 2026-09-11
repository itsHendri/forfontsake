import { describe, it, expect } from 'vitest'
import {
  SHEET_W,
  SHEET_H,
  buildPoster,
  buildPosterLayers,
  dissolveFor,
  GROUNDS,
  getGround,
  liveBox,
  PART_NAMES,
  sheetGeometry,
  sheetParts,
  snapAngle,
  snapLines,
  settingsLine,
  chainName,
  LAYOUTS,
  FORMATS,
  getFormat,
  POSTER_PALETTES,
} from './poster'
import { defaults, getTreatment } from '../engine/treatments/registry'
import { bindingsFor, getMode, modulate } from './modulate'
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

describe('formats', () => {
  it('cuts the sheet to every format it offers', () => {
    for (const f of FORMATS) {
      const svg = buildPoster({ ...req('word'), format: f.id })
      expect(svg, f.id).toContain(`viewBox="0 0 ${f.w} ${f.h}"`)
      expect(svg, f.id).toContain(`width="${f.w}" height="${f.h}"`)
    }
  })

  it('keeps the default sheet exactly as it was when no format is asked for', () => {
    expect(buildPoster(req('word'))).toBe(buildPoster({ ...req('word'), format: 'post' }))
  })

  it('falls back rather than throwing on an unknown format', () => {
    expect(getFormat('nope')).toBe(FORMATS[0])
    expect(buildPoster({ ...req('word'), format: 'nope' })).toBe(buildPoster(req('word')))
  })

  it('keeps the word inside the sheet at every format', () => {
    for (const f of FORMATS) {
      const { wordBox } = buildPosterLayers({ ...req('word'), format: f.id })
      expect(wordBox, f.id).not.toBeNull()
      expect(wordBox!.x, f.id).toBeGreaterThanOrEqual(-1)
      expect(wordBox!.y, f.id).toBeGreaterThanOrEqual(-1)
      expect(wordBox!.x + wordBox!.w, f.id).toBeLessThanOrEqual(f.w + 1)
      expect(wordBox!.y + wordBox!.h, f.id).toBeLessThanOrEqual(f.h + 1)
    }
  })

  it('keeps the layers and the composed sheet agreeing at every format', () => {
    // the pair that drifts: two ways of drawing one sheet, now times three sizes
    for (const f of FORMATS) {
      for (const layout of LAYOUTS) {
        const r = { ...req(layout.id), format: f.id }
        const { ground, word } = buildPosterLayers(r)
        const composed = buildPoster(r)
        const marks = composed.match(/<(path|text|rect|line)[^>]*>/g) ?? []
        expect(marks.length, `${f.id}/${layout.id}`).toBeGreaterThan(4)
        for (const mark of marks) {
          expect(
            ground.includes(mark) || (word !== null && word.includes(mark)),
            `${f.id}/${layout.id} · ${mark.slice(0, 50)}`,
          ).toBe(true)
        }
      }
    }
  })

  it('sets the character grid to the sheet it is on', () => {
    // a story is 570px taller than a post, so the grid must not be identical
    const post = buildPoster({ ...req('chars'), format: 'post' })
    const story = buildPoster({ ...req('chars'), format: 'story' })
    expect(story).not.toBe(post)
  })
})

describe('a sheet the sound can move', () => {
  // The character set used to be barred from video on the grounds that it
  // could not move. It moves; it is only slower. This pins the part that
  // matters — that a modulated chain actually reaches the geometry of *both*
  // layouts — so the ban cannot come back by accident.
  const chain = [{ id: 'grit', params: defaults(getTreatment('grit')) }]
  const bindings = bindingsFor(getMode('breathe'), chain)

  for (const layout of ['word', 'chars']) {
    it(`redraws the ${layout} sheet when the dials are driven`, () => {
      const still = buildPosterLayers({ ...req(layout), chain })
      const driven = buildPosterLayers({
        ...req(layout),
        chain: modulate(chain, [0, 1, 0, 0], bindings, 0.5),
      })
      const ink = (l: ReturnType<typeof buildPosterLayers>) => (l.word ?? l.ground)
      expect(ink(driven)).not.toBe(ink(still))
    })
  }

  it('leaves the sheet alone when nothing is driving it', () => {
    const quiet = modulate(chain, [0, 0, 0, 0], bindings, 0.5)
    expect(buildPosterLayers({ ...req('chars'), chain: quiet }).ground).toBe(
      buildPosterLayers({ ...req('chars'), chain }).ground,
    )
  })
})

describe('when a sheet dissolves and when it cuts', () => {
  const post = { layout: 'word', format: 'post' }

  it('dissolves a rebuild of the same picture — that is the morph', () => {
    expect(dissolveFor(post, post)).toBe(1)
  })

  it('cuts to a new layout, because the reader is waiting to see it', () => {
    expect(dissolveFor(post, { layout: 'chars', format: 'post' })).toBe(0)
  })

  it('cuts to a new size for the same reason', () => {
    expect(dissolveFor(post, { layout: 'word', format: 'story' })).toBe(0)
  })

  it('fades the first sheet in, having nothing to cut from', () => {
    expect(dissolveFor(null, post)).toBe(1)
  })
})

describe('what the sheet is printed on', () => {
  const palette = POSTER_PALETTES[0]

  it('draws every ground from the palette, so recolouring carries the texture', () => {
    for (const g of GROUNDS) {
      const svg = g.draw(1080, 1350, palette)
      expect(svg, g.id).toContain(palette.paper)
      expect(svg, g.id).toContain('width="1080"')
    }
  })

  it('gives each ground its own picture', () => {
    const drawn = GROUNDS.map((g) => g.draw(1080, 1350, palette))
    expect(new Set(drawn).size).toBe(GROUNDS.length)
  })

  it('offers flat, screen, grid and tooth — wash is gone', () => {
    // it was a vertical gradient, which is the one thing on the list that is
    // not something paper does
    expect(GROUNDS.map((g) => g.id)).toEqual(['flat', 'screen', 'grid', 'tooth'])
  })

  it('draws every texture in the sheet\'s own ink, tooth included', () => {
    // Tooth used to ignore the palette entirely: it was a grey veil over the
    // paper, so it was the one ground that did not recolour with the sheet.
    const ink = palette.caption ?? palette.ink
    for (const g of GROUNDS.filter((g) => g.id !== 'flat')) {
      expect(g.draw(1080, 1350, palette), g.id).toContain(ink)
    }
  })

  it('keeps the tooth coarse enough to be seen at the size a sheet is shown', () => {
    // At 0.85 the noise had a period of 1.2 sheet units, which is under a
    // device pixel once a 1080 sheet is drawn at the 850-odd it is shown at —
    // so it averaged out to flat paper very slightly darker. A period of three
    // units or more survives that downscale and reads as grain.
    const svg = GROUNDS.find((g) => g.id === 'tooth')!.draw(1080, 1350, palette)
    const freq = Number(/baseFrequency="([\d.]+)"/.exec(svg)?.[1])
    expect(freq).toBeGreaterThan(0)
    expect(1 / freq).toBeGreaterThanOrEqual(3)
  })

  it('speckles the tooth rather than veiling the sheet with it', () => {
    // The old one put a blanket opacity over a rect: feTurbulence writes a
    // random alpha averaging about a half, saturate does not touch alpha, so
    // every pixel got the same faint wash. Banding the alpha is what makes
    // most of the sheet stay paper and the rest take ink.
    const svg = GROUNDS.find((g) => g.id === 'tooth')!.draw(1080, 1350, palette)
    expect(svg).toContain('feFuncA')
    expect(svg).not.toMatch(/opacity="[\d.]+"/)
  })

  it('screens at a pitch that reads as a screen rather than as spots', () => {
    const svg = GROUNDS.find((g) => g.id === 'screen')!.draw(1080, 1350, palette)
    const tile = Number(/pattern id="ffs-screen" width="([\d.]+)"/.exec(svg)?.[1])
    // a 1080 sheet is shown about 850 wide, so a tile over 12 units is a
    // visible dot rather than a tone
    expect(tile).toBeLessThanOrEqual(12)
  })

  it('falls through to flat on an unknown id', () => {
    expect(getGround('nope')).toBe(GROUNDS[0])
    expect(getGround()).toBe(GROUNDS[0])
  })

  it('prints the sheet on the ground it was asked for', () => {
    const base = { ...req('word'), palette }
    const flat = buildPoster({ ...base, ground: 'flat' })
    const screen = buildPoster({ ...base, ground: 'screen' })
    expect(flat).not.toEqual(screen)
    expect(screen).toContain('ffs-screen')
  })

  /*
   * A picture is a louder decision than a texture, so it wins — and the paper
   * still goes down under it, because a transparent PNG and a picture that
   * does not cover the sheet both leave gaps, and a gap should be the sheet's
   * own colour rather than whatever the canvas was.
   */
  it('lets an uploaded picture beat the texture, over the paper', () => {
    const svg = buildPoster({ ...req('word'), palette, ground: 'screen', backdrop: 'data:image/jpeg;base64,AAAA' })
    expect(svg).toContain('data:image/jpeg;base64,AAAA')
    expect(svg).toContain('preserveAspectRatio="xMidYMid slice"')
    expect(svg).not.toContain('ffs-screen')
    expect(svg.indexOf(palette.paper)).toBeLessThan(svg.indexOf('data:image'))
  })

  it('puts the same ground under the layered sheet as under the composed one', () => {
    expect(buildPosterLayers({ ...req('word'), palette, ground: 'grid' }).ground).toContain('ffs-grid')
  })
})

describe('the outlines behind the sheet', () => {
  it('gives the same sheet whether or not the geometry was already made', () => {
    // the cache is keyed on what the outlines depend on, so a second build
    // with everything else changed must still be the sheet, byte for byte
    const first = buildPoster({ ...req('word'), palette: POSTER_PALETTES[0] })
    const again = buildPoster({ ...req('word'), palette: POSTER_PALETTES[0] })
    expect(again).toBe(first)
  })

  it('keeps a colour out of the key, so recolouring cannot re-treat the word', () => {
    const a = sheetGeometry({ ...req('word'), palette: POSTER_PALETTES[0] })
    const b = sheetGeometry({ ...req('word'), palette: POSTER_PALETTES[1] })
    expect(b).toBe(a)
  })

  it('treats the word again when the seed rolls', () => {
    const a = sheetGeometry({ ...req('word'), seed: 1 })
    const b = sheetGeometry({ ...req('word'), seed: 2 })
    expect(b).not.toBe(a)
    expect(b.word.d).not.toBe(a.word.d)
  })

  it('treats the word again when the word changes', () => {
    const a = sheetGeometry({ ...req('word'), word: 'Alpha' })
    const b = sheetGeometry({ ...req('word'), word: 'Beta' })
    expect(b.word.d).not.toBe(a.word.d)
  })

  it('draws the character set only when something asks for it', () => {
    // the word layout must not pay for sixty-nine glyphs it does not show
    const geo = sheetGeometry({ ...req('word'), seed: 4242 })
    expect(geo.word.d.length).toBeGreaterThan(0)
    expect(geo.chars.length).toBeGreaterThan(0)
  })
})

describe('the box mid-gesture', () => {
  const box = { x: 100, y: 200, w: 400, h: 120 }

  it('is the built box when nothing has moved since', () => {
    expect(liveBox(box, 1)).toEqual(box)
  })

  it('grows about its own centre, so the handles stay on the letters', () => {
    const grown = liveBox(box, 2)
    expect(grown.w).toBe(800)
    expect(grown.h).toBe(240)
    expect(grown.x + grown.w / 2).toBe(box.x + box.w / 2)
    expect(grown.y + grown.h / 2).toBe(box.y + box.h / 2)
  })

  it('shrinks about it too', () => {
    const small = liveBox(box, 0.5)
    expect(small.w).toBe(200)
    expect(small.x + small.w / 2).toBe(box.x + box.w / 2)
  })

  it('agrees with what the sheet draws once the size is baked in', () => {
    // the same 1.5× shown as a uniform and then built into the geometry has to
    // put the frame in the same place, or letting go moves the handles
    const built = buildPosterLayers({ ...req('word'), wordTransform: { dx: 0, dy: 0, scale: 1.5 } })
    const plain = buildPosterLayers({ ...req('word'), wordTransform: { dx: 0, dy: 0, scale: 1 } })
    const shown = liveBox(plain.wordBox!, 1.5)
    expect(shown.w).toBeCloseTo(built.wordBox!.w, 6)
    expect(shown.h).toBeCloseTo(built.wordBox!.h, 6)
    expect(shown.x).toBeCloseTo(built.wordBox!.x, 6)
    expect(shown.y).toBeCloseTo(built.wordBox!.y, 6)
  })
})

describe('turning the word', () => {
  it('leaves the sheet alone at no rotation', () => {
    const flat = buildPoster({ ...req('word'), wordTransform: { dx: 0, dy: 0, scale: 1 } })
    const zero = buildPoster({ ...req('word'), wordTransform: { dx: 0, dy: 0, scale: 1, rotate: 0 } })
    expect(zero).toEqual(flat)
  })

  it('turns about the word’s own centre, so it cannot walk off the sheet', () => {
    const spun = buildPoster({ ...req('word'), wordTransform: { dx: 0, dy: 0, scale: 1, rotate: 30 } })
    expect(spun).toContain('rotate(30)')
    // scale and rotate share one origin — the translate pair around them
    expect(spun).toMatch(/translate\([\d.-]+, ?[\d.-]+\) rotate\(30\) scale\(1\)/)
  })

  /*
   * The reported box stays the word's own rectangle, unrotated. The room turns
   * the pointer back through the angle before testing it; growing the box to
   * the bounds of a spun one would claim the empty corners a turned word
   * leaves behind, and clicking beside the letters would grab them.
   */
  it('reports the same box however far the word is turned', () => {
    const still = buildPosterLayers({ ...req('word'), wordTransform: { dx: 0, dy: 0, scale: 1 } }).wordBox!
    const spun = buildPosterLayers({ ...req('word'), wordTransform: { dx: 0, dy: 0, scale: 1, rotate: 45 } }).wordBox!
    expect(spun).toEqual(still)
  })
})

describe('what the word snaps to', () => {
  it('offers the sheet’s own centre on both axes', () => {
    for (const f of FORMATS) {
      const { x, y } = snapLines(f.id)
      expect(x, f.id).toContain(f.w / 2)
      expect(y, f.id).toContain(f.h / 2)
    }
  })

  it('offers the margin the type is set to, and the two rules', () => {
    const { x, y } = snapLines('post')
    // three each: the margin pair and the centre, the two rules and the centre
    expect(x).toHaveLength(3)
    expect(y).toHaveLength(3)
    // every line is inside the sheet, or it is a line nothing can reach
    for (const v of x) {
      expect(v).toBeGreaterThan(0)
      expect(v).toBeLessThan(FORMATS[0].w)
    }
    for (const v of y) {
      expect(v).toBeGreaterThan(0)
      expect(v).toBeLessThan(FORMATS[0].h)
    }
  })

  it('lines up with where the sheet actually draws its rules', () => {
    // the head rule and the foot rule are drawn at these y values, so a word
    // snapped to one sits on a line that is really there
    const svg = buildPoster(req('word'))
    for (const y of snapLines('post').y) {
      if (y === FORMATS[0].h / 2) continue
      expect(svg, String(y)).toContain(`y1="${y}"`)
    }
  })
})

describe('what the sheet is made of', () => {
  const parts = sheetParts(req('word'))

  it('names all six marks of the caption', () => {
    expect(parts.map((p) => p.id)).toEqual([
      'head-rule',
      'head-label',
      'number',
      'foot-rule',
      'foot-caption',
      'address',
    ])
    expect(parts.every((p) => p.layer === 'caption')).toBe(true)
    expect(Object.keys(PART_NAMES).sort()).toEqual(parts.map((p) => p.id).sort())
  })

  it('keeps every one of them on the sheet, at every format', () => {
    for (const f of FORMATS) {
      const { w, h } = getFormat(f.id)
      for (const part of sheetParts({ ...req('word'), format: f.id })) {
        expect(part.x).toBeGreaterThanOrEqual(0)
        expect(part.y).toBeGreaterThanOrEqual(0)
        expect(part.x + part.w).toBeLessThanOrEqual(w)
        expect(part.y + part.h).toBeLessThanOrEqual(h)
        expect(part.w).toBeGreaterThan(0)
        expect(part.h).toBeGreaterThan(0)
      }
    }
  })

  it('puts the head rule where the word snaps to it', () => {
    // the two have to be the same line, or clicking the rule selects nothing
    // where the word says it is landing
    const rule = parts.find((p) => p.id === 'head-rule')!
    expect(rule.y + rule.h / 2).toBeCloseTo(snapLines().y[0], 6)
  })

  it('ends the right-hand marks at the margin the sheet draws them to', () => {
    const right = SHEET_W - 76
    for (const id of ['number', 'address'] as const) {
      const part = parts.find((p) => p.id === id)!
      expect(part.x + part.w).toBeCloseTo(right, 6)
    }
  })

  it('grows the number as the sheet counts past ninety-nine', () => {
    const small = sheetParts({ ...req('word'), number: 7 }).find((p) => p.id === 'number')!
    const large = sheetParts({ ...req('word'), number: 999 }).find((p) => p.id === 'number')!
    // padded to three digits either way, so the box does not move under it
    expect(large.w).toBeCloseTo(small.w, 6)
  })
})

describe('where a turn settles', () => {
  it('leaves a turn nobody was aiming at alone', () => {
    expect(snapAngle(37)).toBe(37)
    expect(snapAngle(52)).toBe(52)
  })

  it('pulls a near miss onto the fifteen', () => {
    expect(snapAngle(43)).toBe(45)
    expect(snapAngle(31.5)).toBe(30)
  })

  it('pulls harder towards upright, sideways and upside down', () => {
    expect(snapAngle(85)).toBe(90)
    expect(snapAngle(355)).toBe(0)
    expect(snapAngle(184)).toBe(180)
  })

  it('lets go when Shift is down', () => {
    expect(snapAngle(89, true)).toBe(89)
    expect(snapAngle(43, true)).toBe(43)
  })

  it('always answers inside one turn of the circle', () => {
    for (const deg of [-10, 0, 359.6, 400, 720]) {
      const at = snapAngle(deg)
      expect(at).toBeGreaterThanOrEqual(0)
      expect(at).toBeLessThan(360)
    }
  })
})
