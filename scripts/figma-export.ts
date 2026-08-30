#!/usr/bin/env tsx
/**
 * Emit the workbench's treated outlines as SVG, ready to be pasted into Figma.
 *
 * The design file is meant to show the real thing, not a screenshot of it, so
 * the type in it is vector — produced by the same engine the page runs. Path
 * coordinates are rounded on the way out: at the sizes a specimen is read, sub-
 * pixel precision buys nothing and costs a third of the file.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { render, renderGlyphSet } from '../src/lib/render'
import type { Library } from '../src/lib/glyphData'
import { defaults, getTreatment } from '../src/engine/treatments/registry'

const library = JSON.parse(readFileSync('out/glyph-data.json', 'utf8')) as Library

const FONT = process.env.FONT ?? 'pirataone'
const TREATMENT = process.env.TREATMENT ?? 'grit'
const TEXT = process.env.TEXT ?? 'Grittier letters'
const SEED = Number(process.env.SEED ?? 1337)
const params = defaults(getTreatment(TREATMENT))

/** trim coordinates to whole font units — invisible at any reading size */
function round(d: string): string {
  return d.replace(/-?\d+\.\d+/g, (n) => String(Math.round(Number(n))))
}

const chain = [{ id: TREATMENT, params }]

const line = render({
  library,
  fontId: FONT,
  chain,
  text: TEXT,
  seed: SEED,
  alternates: 3,
})

const set = renderGlyphSet(library, FONT, chain, SEED)

/** font space is y-up; one flip per path leaves Figma with plain vectors */
function svg(d: string, width: number, asc: number, desc: number, px: number): string {
  const scale = px / (asc - desc)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${(width * scale).toFixed(1)}" height="${px}" ` +
    `viewBox="0 ${-asc} ${width} ${asc - desc}">` +
    `<g transform="scale(1,-1)"><path d="${round(d)}"/></g></svg>`
  )
}

const out = {
  font: library[FONT].label,
  treatment: getTreatment(TREATMENT).name,
  text: TEXT,
  seed: SEED,
  unitsPerEm: line.unitsPerEm,
  ascender: line.ascender,
  descender: line.descender,
  lineWidth: line.width,
  contours: line.contours,
  // one path for the whole line, scaled where it is placed
  line: round(line.d),
  glyphs: set.glyphs.map((g) => ({ ch: g.ch, adv: g.adv, d: round(g.d) })),
  svgLine: (px: number) => svg(line.d, line.width, line.ascender, line.descender, px),
}

mkdirSync('out/figma', { recursive: true })
const path = `out/figma/${FONT}-${TREATMENT}.json`
writeFileSync(
  path,
  JSON.stringify({ ...out, svgLine: undefined }, (k, v) => (k === 'svgLine' ? undefined : v)),
)

const raw = line.d.length + set.glyphs.reduce((a, g) => a + g.d.length, 0)
const rounded = out.line.length + out.glyphs.reduce((a, g) => a + g.d.length, 0)
console.log(`${path}`)
console.log(`  ${library[FONT].label} · ${getTreatment(TREATMENT).name} · seed ${SEED}`)
console.log(`  line: ${line.contours} contours, ${(out.line.length / 1024).toFixed(0)} KB`)
console.log(`  glyphs: ${out.glyphs.length}, ${(rounded / 1024).toFixed(0)} KB total`)
console.log(`  rounding saved ${(100 - (rounded / raw) * 100).toFixed(0)}%`)
