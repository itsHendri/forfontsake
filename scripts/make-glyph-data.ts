#!/usr/bin/env tsx
// Extracts flattened outlines for every source font so the live page can run
// the engine without shipping a font parser.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
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

/**
 * The workbench types into a transparent input laid over the treated outlines,
 * so the caret only lands between the right letters if the browser lays that
 * text out on the source font's own advance widths. These subsets exist to
 * supply those metrics — never to be seen. Cut to the preview charset they come
 * to a few KB each, small enough to inline in the published page.
 */
const PREVIEW_DIR = 'public/fonts/preview'
const FONTTOOLS = '.venv/bin/fonttools'

function subsetPreviewFont(src: Source): boolean {
  if (!existsSync(FONTTOOLS)) return false
  try {
    execFileSync(
      FONTTOOLS,
      [
        'subset',
        src.file,
        `--text=${CHARSET}`,
        '--flavor=woff2',
        '--layout-features=',
        '--no-hinting',
        '--desubroutinize',
        `--output-file=${PREVIEW_DIR}/${src.id}.woff2`,
      ],
      { stdio: 'pipe' },
    )
    return true
  } catch (e) {
    console.warn(`  could not subset ${src.id}: ${String(e).slice(0, 120)}`)
    return false
  }
}

mkdirSync(PREVIEW_DIR, { recursive: true })
if (!existsSync(FONTTOOLS)) {
  console.warn(
    'fonttools not found — preview fonts not rebuilt. The hero caret needs them;\n' +
      'see the README for the venv setup.',
  )
}

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
    // where the browser can fetch the original bytes when it builds a font
    src: src.file.replace(/^public/, ''),
    // the whole face, not just the preview charset — what an export will cost
    sourceGlyphs: font.glyphs.length,
    unitsPerEm: font.info.unitsPerEm,
    strokeWidth,
    ascender: font.info.ascender ?? 800,
    descender: font.info.descender ?? -200,
    glyphs,
  }
  const subset = subsetPreviewFont(src)
  console.log(
    `${src.label.padEnd(16)} upm ${String(font.info.unitsPerEm).padStart(4)}  ` +
      `stroke ${strokeWidth.toFixed(0).padStart(4)}  ` +
      `${Object.keys(glyphs).length} glyphs${missing ? `, ${missing} missing` : ''}` +
      `${subset ? '' : '  (no preview font)'}`,
  )
}

const json = JSON.stringify(out)
// out/ is gitignored, so on a clean checkout — CI, or anyone who has just
// cloned — it does not exist yet and the write fails with ENOENT.
mkdirSync('out', { recursive: true })
writeFileSync('out/glyph-data.json', json)
console.log(`\nwrote out/glyph-data.json — ${(json.length / 1024).toFixed(0)} KB`)
