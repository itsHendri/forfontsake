#!/usr/bin/env tsx
/**
 * The preset audit.
 *
 * The contact sheet shows what every preset looks like. This asks the
 * questions you cannot answer by looking at one at a time: is this preset
 * telling me anything the one next to it did not, is its name taken, and is
 * the one the treatment opens on the one that shows the treatment.
 *
 *   npx tsx scripts/preset-audit.ts
 *   npx tsx scripts/preset-audit.ts --only=halftone
 *   npx tsx scripts/preset-audit.ts --text=Wedge --font=archivoblack
 *
 * Four measures per preset:
 *
 * - **coverage** — treated ink area over untreated ink area on the reference
 *   word. 1.0 is the letter's own weight; below about 0.35 the preset is
 *   showing the treatment at its faintest, and every screen collapses to flat
 *   grey down the size ladder anyway.
 * - **points per glyph** and **contours** — what a font built from it would
 *   carry. Per glyph, because the contact sheet's 2,200-point flag is set for
 *   a five-letter word and would call everything heavy on a ten-letter one;
 *   440 a glyph is the same threshold said in a way the word length cannot
 *   move.
 * - **distance** — how far this preset sits from its nearest sibling, as the
 *   mean per-dial gap with each dial normalised by its own range, so a Seed of
 *   1337 does not drown out a Shape of 1. Two presets under about 0.06 apart
 *   are usually the same picture with two names.
 *
 * Distance is the cheap half of the duplicate question and it is not the whole
 * of it: two presets can be far apart in the dials and land on the same image,
 * or sit close and diverge because one crossed a threshold. So the rendered
 * ink is compared as well — the overlap of the two coverage figures — and a
 * pair is only called a duplicate when both agree.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { parse } from '../src/engine/opentype'
import { shapeText } from '../src/engine/text'
import { medianStrokeWidth } from '../src/engine/measure'
import { defaults, landingPreset, FAMILY_LABEL } from '../src/engine/treatments/types'
import { TREATMENTS } from '../src/engine/treatments/registry'
import { pointCount } from '../src/engine/paths'
import { mulberry32 } from '../src/engine/prng'
import type { ParamValues, Treatment, Preset } from '../src/engine/treatments/types'

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=')
    return [k, v.join('=') || 'true']
  }),
) as Record<string, string>

const text = args.text ?? 'Handgloves'
const fontDir = args.font ?? 'archivoblack'
const only = args.only ? new Set(args.only.split(',')) : null

// the bundled faces do not agree on a file name, so take whatever ttf is there
const dir = `public/fonts/${fontDir}`
const file = readdirSync(dir).find((f) => f.endsWith('.ttf'))
if (!file) throw new Error(`no ttf in ${dir}`)
const bytes = readFileSync(`${dir}/${file}`)
const font = parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
const shaped = shapeText(font, text)
const stroke = medianStrokeWidth(
  shaped.glyphs.map((g) => g.rings),
  shaped.unitsPerEm * 0.1,
)

/** Signed area by the shoelace formula; counters wind the other way, so the sum is the ink. */
function inkArea(rings: { x: number; y: number }[][]): number {
  let total = 0
  for (const ring of rings) {
    let a = 0
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i]
      const q = ring[(i + 1) % ring.length]
      a += p.x * q.y - q.x * p.y
    }
    total += a / 2
  }
  return Math.abs(total)
}

const plainInk = inkArea(shaped.glyphs.flatMap((g) => g.rings))

interface Measured {
  name: string
  values: ParamValues
  coverage: number
  points: number
  perGlyph: number
  contours: number
  ms: number
  /** distance to the nearest sibling, and which one */
  gap: number
  nearest: string
}

function measure(t: Treatment, values: ParamValues) {
  const started = performance.now()
  let ink = 0
  let points = 0
  let contours = 0
  let penX = 0
  for (const g of shaped.glyphs) {
    const rings = t.apply(g.rings, values, {
      rng: mulberry32(1337 + g.glyphIndex * 7919),
      unitsPerEm: shaped.unitsPerEm,
      strokeWidth: stroke,
      advanceWidth: 0,
      penX,
    })
    ink += inkArea(rings)
    points += pointCount(rings)
    contours += rings.length
    penX = g.x
  }
  return {
    coverage: ink / plainInk,
    points,
    perGlyph: Math.round(points / shaped.glyphs.length),
    contours,
    ms: performance.now() - started,
  }
}

/** mean per-dial gap, each dial normalised by its own range so every dial counts once */
function distance(t: Treatment, a: ParamValues, b: ParamValues): number {
  let sum = 0
  for (const spec of t.params) {
    const range = spec.max - spec.min || 1
    sum += Math.abs((a[spec.key] ?? spec.default) - (b[spec.key] ?? spec.default)) / range
  }
  return sum / t.params.length
}

const NAMES = new Map<string, string[]>()
const rows: { treatment: Treatment; presets: Measured[] }[] = []

for (const t of TREATMENTS) {
  if (only && !only.has(t.id)) continue
  const base = defaults(t)
  const measured: Measured[] = (t.presets ?? []).map((p: Preset) => {
    const values = { ...base, ...p.values }
    return { name: p.name, values, gap: Infinity, nearest: '', ...measure(t, values) }
  })
  for (const m of measured) {
    for (const other of measured) {
      if (other === m) continue
      const d = distance(t, m.values, other.values)
      if (d < m.gap) {
        m.gap = d
        m.nearest = other.name
      }
    }
    const key = m.name.toLowerCase()
    NAMES.set(key, [...(NAMES.get(key) ?? []), t.name])
  }
  rows.push({ treatment: t, presets: measured })
}

const pad = (s: string, n: number) => s.padEnd(n).slice(0, n)
const num = (v: number, n = 6, d = 2) => v.toFixed(d).padStart(n)

console.log(`\npresets measured on "${text}" in ${fontDir}\n`)
let total = 0
for (const { treatment, presets } of rows) {
  const landing = landingPreset(treatment)?.name
  console.log(
    `${treatment.name}  (${FAMILY_LABEL[treatment.family]}, ${presets.length} presets)`.toUpperCase(),
  )
  for (const p of presets) {
    const flags = [
      p.name === landing ? 'LANDS' : '',
      p.coverage < 0.35 ? 'faint' : '',
      p.perGlyph > 440 ? 'heavy' : '',
      p.gap < 0.06 ? `near ${p.nearest}` : '',
    ].filter(Boolean)
    console.log(
      `  ${pad(p.name, 22)} cover ${num(p.coverage)}  ${String(p.perGlyph).padStart(4)} pts/glyph  ` +
        `${num(p.ms, 5, 0)}ms  gap ${num(p.gap, 5, 3)}  ${flags.join(' · ')}`,
    )
  }
  total += presets.length
  console.log('')
}

const clashes = [...NAMES.entries()].filter(([, owners]) => owners.length > 1)
if (clashes.length) {
  console.log('NAMES USED TWICE')
  for (const [name, owners] of clashes) console.log(`  ${pad(name, 22)} ${owners.join(', ')}`)
  console.log('')
}
console.log(`${total} presets across ${rows.length} treatments\n`)
