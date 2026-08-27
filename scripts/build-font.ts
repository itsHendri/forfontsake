#!/usr/bin/env tsx
// Headless font build: source font -> treatment chain -> derivative .ttf.
// Keeps the export path testable outside the browser.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { buildTreatedFont, type TreatmentStep } from '../src/engine/fontio'
import { getTreatment, defaults } from '../src/engine/treatments/registry'

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=')
    return [k, v.join('=') || 'true']
  }),
) as Record<string, string>

const srcPath = resolve(args.src ?? 'public/fonts/pirata-one/PirataOne-Regular.ttf')
const outPath = resolve(args.out ?? 'out/Treated-Regular.ttf')
const only = args.only ?? null
const family = args.family ?? 'Grit One'
const seed = Number(args.seed ?? 1337)

// --treatment=grit --p.amount=60 --p.scale=40
const treatment = getTreatment(args.treatment ?? 'grit')
const params = { ...defaults(treatment) }
for (const [k, v] of Object.entries(args)) {
  if (!k.startsWith('p.')) continue
  const key = k.slice(2)
  if (!(key in params)) {
    console.warn(`warning: ${treatment.id} has no parameter "${key}" — ignored`)
    continue
  }
  params[key] = Number(v)
}

const chain: TreatmentStep[] = [{ id: treatment.id, params }]

const bytes = readFileSync(srcPath)
const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)

console.log(`source:    ${srcPath}`)
console.log(`treatment: ${treatment.name} ${JSON.stringify(params)}`)

const t0 = Date.now()
const result = buildTreatedFont({
  source,
  chain,
  seed,
  only,
  names: {
    familyName: family,
    styleName: 'Regular',
    designer: 'Hendri van Niekerk',
    copyright:
      'Copyright (c) 2012, Rodrigo Fuenzalida, Nicolas Massi, with Reserved Font Name "Pirata". ' +
      'Derivative copyright (c) 2026 Hendri van Niekerk.',
    description: "Generated with FOR FONT'S SAKE (forfontsake.xyz).",
    license: 'This Font Software is licensed under the SIL Open Font License, Version 1.1.',
    licenseURL: 'https://openfontlicense.org',
    version: 'Version 1.000',
  },
})

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, result.bytes)
console.log(
  `built:     ${outPath}\n` +
    `           ${result.glyphCount} glyphs, ${result.treatedCount} treated, ` +
    `${(result.bytes.length / 1024).toFixed(1)} KB in ${((Date.now() - t0) / 1000).toFixed(1)}s\n` +
    `points:    ${result.totalPoints} total, max ${result.maxPoints} on "${result.maxPointsGlyph}"`,
)
