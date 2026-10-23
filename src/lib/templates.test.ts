import { describe, it, expect } from 'vitest'
import { buildPoster, buildPosterLayers, FORMATS, LAYOUTS, POSTER_PALETTES } from './poster'
import { TEMPLATES, dialAt, linesFor, getTemplate } from './templates'
import { COPY_BANK, copyFor, copySets } from './copyBank'
import { PREVIEW_CHARSET } from '../engine/extract'
import { defaults, getTreatment } from '../engine/treatments/registry'
import type { FontData } from './glyphData'

/** a face with every letter the bank uses, each a plain box, so every template has something to set */
const font: FontData = {
  label: 'Test Face',
  note: '',
  reserved: [],
  src: '/x.ttf',
  sourceGlyphs: PREVIEW_CHARSET.length,
  unitsPerEm: 1000,
  strokeWidth: 120,
  ascender: 800,
  descender: -200,
  glyphs: Object.fromEntries(
    [...PREVIEW_CHARSET].map((ch) => [ch, { adv: ch === ' ' ? 250 : 560, rings: ch === ' ' ? [] : [[100, 0, 460, 0, 460, 700, 100, 700]] }]),
  ),
}

const req = (layout: string, extra = {}) => ({
  font,
  fontId: 'test-templates',
  chain: [{ id: 'pixel', params: defaults(getTreatment('pixel')) }],
  seed: 7,
  word: 'Hello',
  palette: POSTER_PALETTES[0],
  layout,
  ...extra,
})

function wellFormed(svg: string) {
  expect(svg.startsWith('<svg')).toBe(true)
  expect(svg.endsWith('</svg>')).toBe(true)
  expect((svg.match(/<g[ >]/g) ?? []).length).toBe((svg.match(/<\/g>/g) ?? []).length)
  expect(svg).not.toContain('undefined')
  expect(svg).not.toContain('NaN')
  expect(svg).not.toContain('Infinity')
}

describe('the templates from the gallery round', () => {
  it('are fourteen, every one a layout', () => {
    expect(TEMPLATES).toHaveLength(14)
    const ids = LAYOUTS.filter((l) => l.kind === 'template').map((l) => l.id)
    expect(ids).toEqual(TEMPLATES.map((t) => t.id))
    expect(new Set(LAYOUTS.map((l) => l.id)).size).toBe(LAYOUTS.length)
  })

  it('draw at every format, and put type on the sheet', () => {
    for (const t of TEMPLATES)
      for (const f of FORMATS) {
        const svg = buildPoster(req(t.id, { format: f.id }))
        wellFormed(svg)
        expect(svg, `${t.id}/${f.id}`).toContain('<path d="M')
      }
  })

  it('keep the type inside the sheet', () => {
    // every placed run, by the ink it reaches rather than where its origin sits
    const placed = /<g transform="translate\(([\d.-]+), ([\d.-]+)\) scale\(([\d.-]+), [\d.-]+\)"><path d="([^"]+)"/g
    for (const t of TEMPLATES)
      for (const f of FORMATS) {
        for (const m of buildPoster(req(t.id, { format: f.id })).matchAll(placed)) {
          const [x, y, k] = [Number(m[1]), Number(m[2]), Number(m[3])]
          const nums = (m[4].match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
          const xs = nums.filter((_, i) => i % 2 === 0)
          const ys = nums.filter((_, i) => i % 2 === 1)
          const at = `${t.id}/${f.id}`
          expect(x + Math.min(...xs) * k, at).toBeGreaterThan(-1)
          expect(x + Math.max(...xs) * k, at).toBeLessThanOrEqual(f.w + 1)
          expect(y - Math.max(...ys) * k, at).toBeGreaterThan(-1)
          expect(y - Math.min(...ys) * k, at).toBeLessThanOrEqual(f.h + 1)
        }
      }
  })

  it('set the lines you give them, and the bank when they are blank', () => {
    expect(linesFor('stack', ['  ', ''])).toEqual(copyFor('stack', 0))
    expect(linesFor('stack', [' Rust ', '', 'Tin'])).toEqual(['Rust', 'Tin'])
    const own = buildPoster(req('stack', { copy: ['Rust', 'Tin'] }))
    const bank = buildPoster(req('stack'))
    expect(own).not.toBe(bank)
    // three rows from the bank, so four hairlines; two of your own, three
    expect((bank.match(/height="2"/g) ?? []).length).toBe(copyFor('stack', 0).length + 1)
    expect((own.match(/height="2"/g) ?? []).length).toBe(3)
  })

  it('leave out what the font cannot draw rather than breaking', () => {
    wellFormed(buildPoster(req('line', { copy: ['Café — naïve: “quotes”'] })))
    wellFormed(buildPoster(req('stack', { copy: ['—', '“”'] })))
  })

  it('push the headline dial for the second setting, within its range', () => {
    const chain = [{ id: 'pixel', params: defaults(getTreatment('pixel')) }]
    const spec = getTreatment('pixel').params.find((p) => p.primary)!
    expect(dialAt(chain, { to: 0 })[0].params[spec.key]).toBe(spec.min)
    expect(dialAt(chain, { to: 1 })[0].params[spec.key]).toBe(spec.max)
    expect(dialAt(chain, { by: 10 })[0].params[spec.key]).toBe(spec.max)
    // the original is not touched
    expect(chain[0].params[spec.key]).toBe(spec.default)
  })

  it('set the waterfall at five sizes between six hairlines', () => {
    const svg = buildPoster(req('waterfall', { copy: ['Rust'] }))
    expect((svg.match(/height="2"/g) ?? []).length).toBe(6)
    const scales = [...svg.matchAll(/scale\(([\d.]+), -/g)].map((m) => Number(m[1]))
    expect(scales).toHaveLength(5)
    // each smaller than the last
    for (let i = 1; i < scales.length; i++) expect(scales[i]).toBeLessThan(scales[i - 1])
  })

  it('hold your picture in a box, under the type and apart from it', () => {
    const backdrop = 'data:image/png;base64,AAAA'
    const svg = buildPoster(req('picture', { backdrop }))
    // once, in its box — not also filling the sheet
    expect(svg.match(/<image /g)).toHaveLength(1)
    expect(svg).toMatch(/<svg x="[\d.]+" y="[\d.]+" width="[\d.]+" height="[\d.]+"><image/)
    // the picture effects run on the ground, so the type rides the other layer
    const layers = buildPosterLayers(req('picture', { backdrop }))
    expect(layers.ground).toContain('<image')
    expect(layers.word).toBeTruthy()
    expect(layers.word).not.toContain('<image')
    expect(layers.word).toContain('<path d="M')
    expect(layers.wordBox).toBeNull()
  })

  it('stand a halftone in for the picture until there is one', () => {
    const svg = buildPoster(req('picture'))
    expect(svg).not.toContain('<image')
    expect(svg).toContain('<circle')
  })

  it('leave the backdrop under everything on every other layout', () => {
    const backdrop = 'data:image/png;base64,AAAA'
    expect(buildPoster(req('stack', { backdrop }))).toContain('width="1080" height="1350" preserveAspectRatio="xMidYMid slice"')
    expect(getTemplate('stack')?.picture).toBeFalsy()
  })
})

describe('the copy bank', () => {
  it('says only what the engine can draw', () => {
    for (const [id, sets] of Object.entries(COPY_BANK))
      for (const set of sets)
        for (const line of set)
          for (const ch of line) expect(PREVIEW_CHARSET.includes(ch), `${JSON.stringify(ch)} in ${id}: ${line}`).toBe(true)
  })

  it('has copy for every template that takes lines, and none for those that do not', () => {
    for (const t of TEMPLATES) expect(copySets(t.id) > 0, t.id).toBe(!!t.lines)
  })

  it('wraps round its sets when shuffled past the end', () => {
    const n = copySets('cover')
    expect(copyFor('cover', n)).toEqual(copyFor('cover', 0))
    expect(copyFor('cover', -1)).toEqual(copyFor('cover', n - 1))
    expect(copyFor('ramp', 3)).toEqual([])
  })
})
