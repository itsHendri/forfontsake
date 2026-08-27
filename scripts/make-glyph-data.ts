#!/usr/bin/env tsx
// Extracts flattened outlines for a character set so the live page can run the
// engine without shipping a font parser.
import { readFileSync, writeFileSync } from 'node:fs'
import { FontFlux } from 'font-flux-js'
import { flattenContour } from '../src/engine/fontio'

const CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,!?&'-"

const bytes = readFileSync('public/fonts/pirata-one/PirataOne-Regular.ttf')
const font = FontFlux.open(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))

const glyphs: Record<string, { adv: number; rings: number[][] }> = {}

for (const ch of CHARSET) {
  const cp = ch.codePointAt(0)!
  if (!font.hasGlyph(cp)) {
    console.warn(`missing glyph for ${JSON.stringify(ch)}`)
    continue
  }
  const g = font.getGlyph(cp)
  const rings = (g.contours ?? []).map((c) => flattenContour(c))
  glyphs[ch] = {
    adv: g.advanceWidth,
    // flat [x,y,x,y,...] per ring, rounded — a third the size of point objects
    rings: rings.map((r) => r.flatMap((p) => [Math.round(p.x), Math.round(p.y)])),
  }
}

const data = {
  unitsPerEm: font.info.unitsPerEm,
  ascender: font.info.ascender ?? 800,
  descender: font.info.descender ?? -200,
  glyphs,
}

writeFileSync('out/glyph-data.json', JSON.stringify(data))
console.log(
  `wrote out/glyph-data.json — ${Object.keys(glyphs).length} glyphs, ` +
    `${(JSON.stringify(data).length / 1024).toFixed(0)} KB`,
)
