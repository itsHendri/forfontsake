#!/usr/bin/env tsx
// Extracts flattened outlines for every source font so the live page can run
// the engine without shipping a font parser.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { FontFlux } from 'font-flux-js'
import { decomposeGlyph } from '../src/engine/fontio'
import { medianStrokeWidth, STROKE_SAMPLE_CHARS } from '../src/engine/measure'

const CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,!?&'-"

interface Source {
  id: string
  label: string
  file: string
  /** OFL Reserved Font Name, which a derivative may not carry */
  reserved: string[]
  note: string
}

const SOURCES: Source[] = [
  {
    id: 'pirataone',
    label: 'Pirata One',
    file: 'public/fonts/pirata-one/PirataOne-Regular.ttf',
    reserved: ['Pirata'],
    note: 'Blackletter',
  },
  { id: 'anton', label: 'Anton', file: 'public/fonts/anton/font.ttf', reserved: [], note: 'Heavy grotesque' },
  {
    id: 'archivoblack',
    label: 'Archivo Black',
    file: 'public/fonts/archivoblack/font.ttf',
    reserved: [],
    note: 'Solid sans',
  },
  {
    id: 'bebasneue',
    label: 'Bebas Neue',
    file: 'public/fonts/bebasneue/font.ttf',
    reserved: [],
    note: 'Condensed caps',
  },
  {
    id: 'unifrakturcook',
    label: 'UnifrakturCook',
    file: 'public/fonts/unifrakturcook/font.ttf',
    reserved: ['UnifrakturCook'],
    note: 'Heavy blackletter',
  },
  {
    id: 'abrilfatface',
    label: 'Abril Fatface',
    file: 'public/fonts/abrilfatface/font.ttf',
    reserved: [],
    note: 'High-contrast serif',
  },
  { id: 'pacifico', label: 'Pacifico', file: 'public/fonts/pacifico/font.ttf', reserved: [], note: 'Script' },
]

const out: Record<string, unknown> = {}

for (const src of SOURCES) {
  if (!existsSync(src.file)) {
    console.warn(`skipping ${src.id} — ${src.file} not found`)
    continue
  }
  const bytes = readFileSync(src.file)
  let font
  try {
    font = FontFlux.open(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  } catch (e) {
    console.warn(`skipping ${src.id} — ${String(e).slice(0, 80)}`)
    continue
  }

  const glyphs: Record<string, { adv: number; rings: number[][] }> = {}
  let missing = 0
  for (const ch of CHARSET) {
    const cp = ch.codePointAt(0)!
    if (!font.hasGlyph(cp)) {
      missing++
      continue
    }
    const g = font.getGlyph(cp)
    // follow component references, or caps-only faces lose their whole
    // lowercase and every accented character comes out blank
    const rings = decomposeGlyph(g, (i) => font.glyphs[i])
    glyphs[ch] = {
      adv: g.advanceWidth,
      // flat [x,y,x,y,…] per ring, rounded — a third the size of point objects
      rings: rings.map((r) => r.flatMap((p) => [Math.round(p.x), Math.round(p.y)])),
    }
  }

  // measured once per font and shipped with the data, so the page does not pay
  // for it on load
  const samples = [...STROKE_SAMPLE_CHARS]
    .filter((c) => glyphs[c])
    .map((c) => {
      const rings: { x: number; y: number }[][] = []
      for (const flat of glyphs[c].rings) {
        const ring: { x: number; y: number }[] = []
        for (let i = 0; i < flat.length; i += 2) ring.push({ x: flat[i], y: flat[i + 1] })
        rings.push(ring)
      }
      return rings
    })
  const strokeWidth = medianStrokeWidth(samples, font.info.unitsPerEm * 0.1)

  out[src.id] = {
    label: src.label,
    note: src.note,
    reserved: src.reserved,
    unitsPerEm: font.info.unitsPerEm,
    strokeWidth,
    ascender: font.info.ascender ?? 800,
    descender: font.info.descender ?? -200,
    glyphs,
  }
  console.log(
    `${src.label.padEnd(16)} upm ${String(font.info.unitsPerEm).padStart(4)}  ` +
      `stroke ${strokeWidth.toFixed(0).padStart(4)}  ` +
      `${Object.keys(glyphs).length} glyphs${missing ? `, ${missing} missing` : ''}`,
  )
}

const json = JSON.stringify(out)
writeFileSync('out/glyph-data.json', json)
console.log(`\nwrote out/glyph-data.json — ${(json.length / 1024).toFixed(0)} KB`)
