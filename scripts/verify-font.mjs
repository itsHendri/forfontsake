#!/usr/bin/env node
// Verify an exported font: OpenType Sanitiser (what browsers run) + a fontTools
// round-trip (better diagnostics when OTS only says "invalid"), plus the
// Reserved Font Name byte scan the OFL requires of a renamed derivative.
import { execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OTS = join(root, '.venv/lib/python3.14/site-packages/ots/ots-sanitize')
const TTX = join(root, '.venv/bin/ttx')

const fontPath = process.argv[2]
const reservedNames = process.argv.slice(3)

if (!fontPath) {
  console.error('usage: npm run verify:font -- <font.otf> [reservedName ...]')
  process.exit(2)
}
if (!existsSync(fontPath)) {
  console.error(`no such file: ${fontPath}`)
  process.exit(2)
}

let failed = false
const step = (name, fn) => {
  try {
    const detail = fn()
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`)
  } catch (err) {
    failed = true
    const out = [err.stdout?.toString(), err.stderr?.toString(), err.message].filter(Boolean).join('\n').trim()
    console.log(`  FAIL ${name}\n${out.replace(/^/gm, '       ')}`)
  }
}

console.log(`verify:font ${fontPath}`)

step('size', () => `${(statSync(fontPath).size / 1024).toFixed(1)} KB`)

step('ots-sanitize (browser acceptance)', () => {
  if (!existsSync(OTS)) throw new Error(`ots-sanitize missing at ${OTS} — run: python3 -m venv .venv && ./.venv/bin/pip install opentype-sanitizer fonttools`)
  const out = execFileSync(OTS, [fontPath, '/dev/null'], { stdio: ['ignore', 'pipe', 'pipe'] })
    .toString()
    .trim()
  return out || 'no warnings'
})

step('fontTools round-trip', () => {
  if (!existsSync(TTX)) throw new Error(`ttx missing at ${TTX}`)
  execFileSync(TTX, ['-q', '-o', '/dev/null', fontPath], { stdio: ['ignore', 'pipe', 'pipe'] })
  return 'parses'
})

if (process.platform === 'darwin') {
  step('CoreText (Font Book / Safari acceptance)', () => {
    const out = execFileSync('swift', [join(root, 'scripts/ctcheck.swift'), fontPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .toString()
      .trim()
      .split('\n')
      .filter((l) => l.startsWith('OK:') || l.startsWith('FAIL:'))
      .join('; ')
    if (!out.startsWith('OK:')) throw new Error(out || 'CoreText rejected the font')
    return out.replace(/^OK: /, '')
  })
}

// Only meaningful for fonts that ship alternates, so it reports rather than
// fails when there is nothing to rotate.
step('alternates actually substitute', () => {
  const PY = join(root, '.venv/bin/python3')
  const out = execFileSync(PY, [join(root, 'scripts/shape_check.py'), fontPath, 'aaaa'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  }).toString()
  const r = JSON.parse(out)
  if (!r.available) return `skipped — ${r.reason}`
  if (!r.substitutes) return 'no substitutions (font ships a single cut per letter)'
  if (!r.repeatsVary) throw new Error(`feature fires but repeats do not vary: ${r.withFeature.join(' ')}`)
  return `${r.withFeature.join(' ')} (was ${r.withoutFeature.join(' ')})`
})

step('ligatures still form', () => {
  const PY = join(root, '.venv/bin/python3')
  const out = execFileSync(PY, [join(root, 'scripts/shape_check.py'), fontPath, 'aaaa'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  }).toString()
  const r = JSON.parse(out)
  if (!r.available) return `skipped — ${r.reason}`
  if (!r.ligaturesForm) return `none in this font (${r.ligatureWord} stays ${r.withLigatures.length} glyphs)`
  return `${r.ligatureWord} → ${r.withLigatures.join(' ')}`
})

let report = null
step('naming fields + reserved font names', () => {
  const PY = join(root, '.venv/bin/python3')
  const out = execFileSync(PY, [join(root, 'scripts/name_check.py'), fontPath, ...reservedNames], {
    stdio: ['ignore', 'pipe', 'pipe'],
  }).toString()
  report = JSON.parse(out)
  const naming = report.naming
  return `${naming.family?.[0] ?? '?'} / ${naming.postScriptName?.[0] ?? '?'} · ${report.glyphCount} glyphs, ${report.cmapCount} mapped, ${report.hasCFF ? 'CFF' : 'glyf'} outlines`
})

if (report) {
  const src = process.env.VERIFY_AGAINST
  if (src && existsSync(src)) {
    // Glyph *count* is not parity: --alts=N adds real glyphs by design. What has
    // to hold is the em square, the characters the font still renders, and the
    // width of every glyph the two fonts share.
    step('metrics match source', () => {
      const PY = join(root, '.venv/bin/python3')
      const m = JSON.parse(
        execFileSync(PY, [join(root, 'scripts/metrics_check.py'), fontPath, src], {
          stdio: ['ignore', 'pipe', 'pipe'],
        }).toString(),
      )
      const some = (list, render, max = 6) =>
        list
          .slice(0, max)
          .map(render)
          .join(', ') + (list.length > max ? `, +${list.length - max} more` : '')

      const diffs = []
      if (m.unitsPerEm.source !== m.unitsPerEm.derivative)
        diffs.push(`unitsPerEm ${m.unitsPerEm.derivative} != ${m.unitsPerEm.source}`)
      if (m.lostCodepoints.length)
        diffs.push(`cmap lost ${m.lostCodepoints.length} codepoints: ${some(m.lostCodepoints, (c) => c)}`)
      if (m.retargetedCodepoints.length)
        diffs.push(
          `cmap retargeted ${m.retargetedCodepoints.length}: ` +
            some(m.retargetedCodepoints, (r) => `${r.codepoint} ${r.source}→${r.derivative}`),
        )
      if (m.missingGlyphs.length)
        diffs.push(`${m.missingGlyphs.length} source glyphs dropped: ${some(m.missingGlyphs, (g) => g)}`)
      // A treatment that declares growth() widens the advance by (params,
      // strokeWidth) — the same constant for every glyph it touches. So one
      // uniform positive shift is the pipeline working as designed, and is
      // reported; widths that moved by differing amounts are the text
      // reflowing unevenly, which is the failure this check exists for.
      const grown = m.advanceDeltas.filter((d) => d.delta !== 0)
      const uniform = grown.length === 1 && grown[0].delta > 0 ? grown[0] : null
      if (grown.length > 1)
        diffs.push(
          `advance widths drifted unevenly — ${m.advanceDiffs.length} glyphs across ` +
            `${grown.length} different shifts (${some(grown, (d) => `${d.delta > 0 ? '+' : ''}${d.delta}×${d.glyphs}`, 4)}): ` +
            some(m.advanceDiffs, (d) => `${d.glyph} ${d.source}→${d.derivative}`, 4),
        )
      else if (grown.length === 1 && !uniform)
        diffs.push(
          `advance widths shrank by ${-grown[0].delta} units on ${grown[0].glyphs} glyphs — ` +
            `treatments may grow a glyph, never narrow it`,
        )
      if (m.alternateAdvanceDiffs.length)
        diffs.push(
          `${m.alternateAdvanceDiffs.length} alternates do not match their base width: ` +
            some(m.alternateAdvanceDiffs, (d) => `${d.glyph} ${d.baseAdvance}→${d.derivative}`),
        )
      if (diffs.length) throw new Error(diffs.join('; '))

      return (
        `upm ${m.unitsPerEm.derivative}, ${m.matchedGlyphs} source glyphs matched` +
        (m.alternatesAdded > 0 ? `, ${m.alternatesAdded} alternates added` : '') +
        (uniform ? `, advances grown +${uniform.delta} on ${uniform.glyphs} (growing treatment)` : '') +
        `, ${m.cmapCount.derivative} codepoints mapped` +
        (m.addedCodepoints.length ? ` (${m.addedCodepoints.length} new)` : '') +
        (m.unaccountedGlyphs.length ? `, ${m.unaccountedGlyphs.length} extra glyphs unaccounted for` : '') +
        (m.matchedByName ? '' : ' — source has no glyph names, matched by codepoint only')
      )
    })
  }
}

process.exit(failed ? 1 : 0)
