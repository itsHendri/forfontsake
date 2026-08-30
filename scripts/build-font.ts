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
const alternates = Number(args.alts ?? 1)

// One treatment:   --treatment=grit --p.amount=60 --p.scale=40
// A stack:          --treatment=grit+bubble --p1.amount=60 --p2.weight=30
//
// Dials are addressed by position because the same key can appear in more than
// one step — `--p.simplify` would be ambiguous the moment a stack repeats a
// treatment. `--p.` without a number is step 1, which is what every existing
// invocation means.
const ids = (args.treatment ?? 'grit').split('+').filter(Boolean)
const treatments = ids.map((id) => getTreatment(id))
const paramSets = treatments.map((t) => ({ ...defaults(t) }))

for (const [k, v] of Object.entries(args)) {
  const m = /^p(\d*)\.(.+)$/.exec(k)
  if (!m) continue
  const at = m[1] ? Number(m[1]) - 1 : 0
  const key = m[2]
  if (at < 0 || at >= paramSets.length) {
    console.warn(`warning: no step ${m[1] || 1} in this stack — "${k}" ignored`)
    continue
  }
  if (!(key in paramSets[at])) {
    console.warn(`warning: ${treatments[at].id} has no parameter "${key}" — ignored`)
    continue
  }
  paramSets[at][key] = Number(v)
}

const chain: TreatmentStep[] = treatments.map((t, i) => ({ id: t.id, params: paramSets[i] }))

const bytes = readFileSync(srcPath)
const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)

console.log(`source:    ${srcPath}`)
console.log(
  `treatment: ${chain.map((c, i) => `${treatments[i].name} ${JSON.stringify(c.params)}`).join('  →  ')}`,
)

const t0 = Date.now()
const result = buildTreatedFont({
  source,
  chain,
  seed,
  alternates,
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
    `points:    ${result.totalPoints} total, max ${result.maxPoints} on "${result.maxPointsGlyph}"\n` +
    `stroke:    ${result.strokeWidth.toFixed(0)} units` +
    (result.alternates > 1
      ? `\nalts:      ${result.alternates} cuts on ${result.variedGlyphs} letters, ${result.addedGlyphs} glyphs added, calt rotation written`
      : '') +
    (result.carriedFeatures.length > 0
      ? `\nkept:      ${result.carriedFeatures.join(', ')} carried from the source`
      : '') +
    (result.droppedRules > 0 ? `\ndropped:   ${result.droppedRules} source rules we cannot reproduce` : ''),
)
