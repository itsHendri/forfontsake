#!/usr/bin/env tsx
// Renders one word at several settings onto a single sheet, for eyeballing the
// look against the reference.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { parse } from '../src/engine/opentype'
import { shapeText } from '../src/engine/text'
import { getTreatment, defaults, type ParamValues } from '../src/engine/treatments/registry'
import { ringsToPathD } from '../src/engine/svg'
import { mulberry32 } from '../src/engine/prng'

const INK = '#274A9C'
const PAPER = '#F2EDE2'

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=')
    return [k, v.join('=') || 'true']
  }),
) as Record<string, string>

const text = args.text ?? 'LisbonTag'
const out = args.out ?? 'out/specimen-sheet.svg'

const bytes = readFileSync('public/fonts/pirata-one/PirataOne-Regular.ttf')
const font = parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))

const treatment = getTreatment(args.treatment ?? 'grit')
const base = defaults(treatment)
const rows: { label: string; params: Partial<ParamValues> }[] = JSON.parse(
  args.rows ??
    JSON.stringify([
      { label: 'grit 40', params: { amount: 40 } },
      { label: 'grit 60', params: { amount: 60 } },
      { label: 'grit 80', params: { amount: 80 } },
      { label: 'grit 80, bigger pieces', params: { amount: 80, scale: 85, variation: 4.5 } },
    ]),
)

const shaped = shapeText(font, text)
const rowH = shaped.ascender - shaped.descender
const labelH = 190
const pad = 90
const sheetW = shaped.width + pad * 2
const sheetH = pad + rows.length * (rowH + labelH) + pad

let body = ''
let y = pad
for (const row of rows) {
  const params = { ...base, ...row.params }
  let d = ''
  let tiles = 0
  let penX = 0
  for (const g of shaped.glyphs) {
    const rings = treatment.apply(g.rings, params, {
      rng: mulberry32(1337 + g.glyphIndex * 7919),
      unitsPerEm: shaped.unitsPerEm,
      advanceWidth: 0,
      penX,
    })
    tiles += rings.length
    d += ringsToPathD(rings, g.x, 0)
    penX = g.x
  }
  body +=
    `<text x="${pad}" y="${y + 60}" font-family="monospace" font-size="52" fill="#8a8477">` +
    `${row.label} · ${tiles} contours</text>` +
    `<g transform="translate(${pad}, ${y + labelH + shaped.ascender}) scale(1,-1)">` +
    `<path d="${d}" fill="${INK}" fill-rule="evenodd"/></g>`
  y += rowH + labelH
}

const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${sheetW} ${sheetH}" width="${Math.round(sheetW / 4)}" height="${Math.round(sheetH / 4)}">` +
  `<rect width="${sheetW}" height="${sheetH}" fill="${PAPER}"/>${body}</svg>`

mkdirSync('out', { recursive: true })
writeFileSync(out, svg)
console.log(`wrote ${out} — ${(svg.length / 1024).toFixed(1)} KB`)
