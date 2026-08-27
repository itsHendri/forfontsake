#!/usr/bin/env tsx
// Renders one preset across every source font, to check that a setting means
// the same thing on a hairline face and on a heavy one.
import { readFileSync, writeFileSync } from 'node:fs'
import { getTreatment, defaults } from '../src/engine/treatments/registry'
import { mulberry32 } from '../src/engine/prng'
import { ringsToPathD } from '../src/engine/svg'
import type { Ring } from '../src/engine/flatten'

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=')
    return [k, v.join('=') || 'true']
  }),
) as Record<string, string>

const text = args.text ?? 'Hamburg'
const treatment = getTreatment(args.treatment ?? 'bleed')
const presetName = args.preset ?? treatment.presets?.[1]?.name ?? ''
const preset = treatment.presets?.find((p) => p.name === presetName)
const params = { ...defaults(treatment), ...(preset?.values ?? {}) }

const data = JSON.parse(readFileSync('out/glyph-data.json', 'utf8')) as Record<string, any>
const INK = '#15171b'
const PAPER = '#e7e4db'

const toRings = (flat: number[][]): Ring[] =>
  flat.map((r) => {
    const ring: Ring = []
    for (let i = 0; i < r.length; i += 2) ring.push({ x: r[i], y: r[i + 1] })
    return ring
  })

const rows: string[] = []
let y = 60
const WIDTH = 2600

for (const [, font] of Object.entries(data)) {
  // normalise every face to the same cap height so only the treatment differs
  const target = 700
  const k = target / (font.ascender - font.descender)

  let d = ''
  let penX = 0
  for (const ch of text) {
    const g = font.glyphs[ch]
    if (!g) continue
    if (g.rings.length > 0) {
      const rings = treatment.apply(toRings(g.rings), params, {
        rng: mulberry32(1337 + (ch.codePointAt(0) ?? 0) * 7919),
        unitsPerEm: font.unitsPerEm,
        strokeWidth: font.strokeWidth,
        advanceWidth: g.adv,
        penX,
      })
      d += ringsToPathD(rings, penX, 0)
    }
    penX += g.adv
  }

  rows.push(
    `<text x="60" y="${y + 34}" font-family="monospace" font-size="30" fill="#8a8477">` +
      `${font.label} — stroke ${Math.round(font.strokeWidth)} / em ${font.unitsPerEm}</text>` +
      `<g transform="translate(60, ${y + 60 + font.ascender * k}) scale(${k}, ${-k})">` +
      `<path d="${d}" fill="${INK}" fill-rule="evenodd"/></g>`,
  )
  y += 60 + target + 50
}

const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${y}" width="${WIDTH / 3}" height="${y / 3}">` +
  `<rect width="${WIDTH}" height="${y}" fill="${PAPER}"/>` +
  `<text x="60" y="40" font-family="monospace" font-size="26" fill="#be3a22">` +
  `${treatment.name} · ${presetName} · identical settings on every font</text>` +
  rows.join('') +
  `</svg>`

const out = args.out ?? 'out/font-compare.svg'
writeFileSync(out, svg)
console.log(`wrote ${out} — ${treatment.name}/${presetName}, ${(svg.length / 1024).toFixed(0)} KB`)
