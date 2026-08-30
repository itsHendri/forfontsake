#!/usr/bin/env tsx
// Extracts flattened outlines for every source font so the live page can run
// the engine without shipping a font parser.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { extractFont, PREVIEW_CHARSET } from '../src/engine/extract'

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
        `--text=${PREVIEW_CHARSET}`,
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
  let data
  try {
    // the same extraction the page runs on an uploaded font — see engine/extract
    data = extractFont(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  } catch (e) {
    console.warn(`skipping ${src.id} — ${String(e).slice(0, 80)}`)
    continue
  }

  out[src.id] = {
    label: src.label,
    note: src.note,
    reserved: src.reserved,
    // where the browser can fetch the original bytes when it builds a font
    src: src.file.replace(/^public/, ''),
    sourceGlyphs: data.sourceGlyphs,
    unitsPerEm: data.unitsPerEm,
    strokeWidth: data.strokeWidth,
    ascender: data.ascender,
    descender: data.descender,
    glyphs: data.glyphs,
  }
  const subset = subsetPreviewFont(src)
  console.log(
    `${src.label.padEnd(16)} upm ${String(data.unitsPerEm).padStart(4)}  ` +
      `stroke ${data.strokeWidth.toFixed(0).padStart(4)}  ` +
      `${Object.keys(data.glyphs).length} glyphs${data.missing ? `, ${data.missing} missing` : ''}` +
      `${subset ? '' : '  (no preview font)'}`,
  )
}

const json = JSON.stringify(out)
// out/ is gitignored, so on a clean checkout — CI, or anyone who has just
// cloned — it does not exist yet and the write fails with ENOENT.
mkdirSync('out', { recursive: true })
writeFileSync('out/glyph-data.json', json)
console.log(`\nwrote out/glyph-data.json — ${(json.length / 1024).toFixed(0)} KB`)
