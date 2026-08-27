#!/usr/bin/env tsx
// Headless font build: source TTF -> mosaic engine -> derivative .otf on disk.
// Keeps the export path testable outside the browser (M1b: --only=A).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { parse } from '../src/engine/opentype'
import { buildMosaicFont } from '../src/engine/fontio'
import { DEFAULT_PARAMS } from '../src/engine/mosaic'

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=')
    return [k, v.join('=') || 'true']
  }),
) as Record<string, string>

const srcPath = resolve(args.src ?? 'public/fonts/pirata-one/PirataOne-Regular.ttf')
const outPath = resolve(args.out ?? 'out/CalcadaOne-Regular.otf')
const only = args.only ?? null
const family = args.family ?? 'Calcada One'

const bytes = readFileSync(srcPath)
const source = parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
console.log(`source: ${srcPath} — ${source.glyphs.length} glyphs, upm ${source.unitsPerEm}`)

const params = {
  ...DEFAULT_PARAMS,
  tileSize: Number(args.tile ?? 44),
  grout: Number(args.grout ?? 7),
  cornerRound: Number(args.corner ?? 2),
}

const t0 = Date.now()
const { font, glyphCount, tiledCount, tileTotal } = buildMosaicFont({
  source,
  params,
  only,
  names: {
    familyName: family,
    styleName: 'Regular',
    designer: 'Hendri van Niekerk',
    copyright:
      'Copyright (c) 2012, Rodrigo Fuenzalida, Nicolas Massi, with Reserved Font Name "Pirata". ' +
      'Mosaic derivative copyright (c) 2026 Hendri van Niekerk.',
    description: "Mosaic derivative generated with FOR FONT'S SAKE (forfontsake.xyz).",
    license: 'This Font Software is licensed under the SIL Open Font License, Version 1.1.',
    licenseURL: 'https://openfontlicense.org',
    version: 'Version 1.000',
  },
})

const buf = Buffer.from(font.toArrayBuffer())
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, buf)
console.log(
  `built:  ${outPath} — ${glyphCount} glyphs, ${tiledCount} tiled, ${tileTotal} tiles, ` +
    `${(buf.length / 1024).toFixed(1)} KB in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
)
