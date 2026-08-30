#!/usr/bin/env tsx
/**
 * Renders the site's share image, which is a real specimen sheet rather than a
 * mockup of one — the same `buildPoster` the download button calls.
 *
 * `index.html` has pointed at /share.png since before there was one. Run this
 * after changing the poster, and commit the result: it is a build input for the
 * page, not something the page can make for itself.
 *
 * The sheet is portrait and the card is landscape, so the sheet is drawn onto
 * the card rather than squashed into it — a 1200×630 crop of a poster reads as
 * a broken image, where a poster lying on a ground reads as a poster.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'
import { buildPoster, POSTER_PALETTES } from '../src/lib/poster'
import { defaults, getTreatment } from '../src/engine/treatments/registry'
import type { Library } from '../src/lib/glyphData'

const CARD_W = 1200
const CARD_H = 630

const library = JSON.parse(readFileSync('public/glyph-data.json', 'utf8')) as Library
const fontId = library.pirataone ? 'pirataone' : Object.keys(library)[0]
const treatmentId = 'growth'
const palette = POSTER_PALETTES[1]

const sheet = buildPoster({
  font: library[fontId],
  fontId,
  chain: [
    {
      id: treatmentId,
      params: {
        ...defaults(getTreatment(treatmentId)),
        ...(getTreatment(treatmentId).presets?.[1].values ?? {}),
      },
    },
  ],
  seed: 1337,
  word: 'Swell',
  palette,
  number: 1,
})

// strip the outer <svg> wrapper so the sheet can be placed as a group
const inner = sheet.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')
const sheetScale = (CARD_H * 0.86) / 1600
const sheetW = 1200 * sheetScale
const card =
  `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" ` +
  `viewBox="0 0 ${CARD_W} ${CARD_H}">` +
  `<rect width="${CARD_W}" height="${CARD_H}" fill="${palette.ink}"/>` +
  `<g transform="translate(${CARD_W - sheetW - 80}, ${(CARD_H - CARD_H * 0.86) / 2}) ` +
  `scale(${sheetScale})">${inner}</g>` +
  `<text x="80" y="300" font-family="'Roboto Mono', ui-monospace, monospace" font-size="54" ` +
  `fill="${palette.paper}">For Font's Sake</text>` +
  `<text x="80" y="352" font-family="'Roboto Mono', ui-monospace, monospace" font-size="24" ` +
  `fill="${palette.mark}" letter-spacing="2">A BROWSER TYPE FOUNDRY</text>` +
  `<text x="80" y="404" font-family="'Roboto Mono', ui-monospace, monospace" font-size="21" ` +
  `fill="${palette.paper}" opacity="0.7">Treat a font. Download a real one.</text>` +
  `</svg>`

const png = new Resvg(card, { fitTo: { mode: 'width', value: CARD_W } }).render().asPng()
writeFileSync('public/share.png', png)
writeFileSync('out/share-sheet.svg', sheet)
console.log(`wrote public/share.png — ${(png.length / 1024).toFixed(0)} KB, ${CARD_W}×${CARD_H}`)
