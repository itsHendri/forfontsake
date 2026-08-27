#!/usr/bin/env node
// Verify an exported font: OpenType Sanitiser (what browsers run) + a fontTools
// round-trip (better diagnostics when OTS only says "invalid"), plus the
// Reserved Font Name byte scan the OFL requires of a renamed derivative.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
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
    step('metrics match source', () => {
      const PY = join(root, '.venv/bin/python3')
      const srcReport = JSON.parse(
        execFileSync(PY, [join(root, 'scripts/name_check.py'), src], { stdio: ['ignore', 'pipe', 'pipe'] }).toString(),
      )
      const diffs = []
      if (srcReport.unitsPerEm !== report.unitsPerEm)
        diffs.push(`unitsPerEm ${report.unitsPerEm} != ${srcReport.unitsPerEm}`)
      if (srcReport.glyphCount !== report.glyphCount)
        diffs.push(`glyphCount ${report.glyphCount} != ${srcReport.glyphCount}`)
      if (srcReport.cmapCount !== report.cmapCount) diffs.push(`cmap ${report.cmapCount} != ${srcReport.cmapCount}`)
      if (diffs.length) throw new Error(diffs.join('; '))
      return `upm ${report.unitsPerEm}, ${report.glyphCount} glyphs, ${report.cmapCount} mapped`
    })
  }
}

process.exit(failed ? 1 : 0)
