#!/usr/bin/env tsx
// Renders one word at several settings onto a single sheet, for eyeballing the
// look against the reference.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { parse } from '../src/engine/opentype'
import { shapeText } from '../src/engine/text'
import { mosaicGlyph, DEFAULT_PARAMS, type MosaicParams } from '../src/engine/mosaic'
import { tilesToPathD } from '../src/engine/svg'

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

const rows: { label: string; params: Partial<MosaicParams> }[] = [
  { label: 'square — aspect 1.0', params: { aspect: 1 } },
  { label: 'stubby — aspect 0.8', params: { aspect: 0.8 } },
  { label: 'square + irregular — aspect 1.0, irregularity 0.85', params: { aspect: 1, irregularity: 0.85, groutJitter: 0.6 } },
  { label: 'square, finer grout — aspect 1.0, grout 8', params: { aspect: 1, grout: 8 } },
]

const shaped = shapeText(font, text)
const rowH = shaped.ascender - shaped.descender
const labelH = 190
const pad = 90
const sheetW = shaped.width + pad * 2
const sheetH = pad + rows.length * (rowH + labelH) + pad

let body = ''
let y = pad
for (const row of rows) {
  const params: MosaicParams = { ...DEFAULT_PARAMS, ...row.params }
  let d = ''
  let tiles = 0
  for (const g of shaped.glyphs) {
    const r = mosaicGlyph(g.rings, { ...params, seed: params.seed + g.glyphIndex * 7919 })
    tiles += r.tiles.length
    d += tilesToPathD(r.tiles, g.x, 0)
  }
  body +=
    `<text x="${pad}" y="${y + 60}" font-family="monospace" font-size="52" fill="#8a8477">` +
    `${row.label} · ${tiles} tiles</text>` +
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
