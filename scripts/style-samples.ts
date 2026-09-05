#!/usr/bin/env tsx
/**
 * The contact sheet.
 *
 * Every treatment at every one of its presets on one page, so a look can be
 * judged by looking at it rather than by reading a parameter list. Also the
 * budget check: each row reports its contour count, point count and the
 * milliseconds it took, and flags itself when either would make a font slow to
 * export.
 *
 *   npx tsx scripts/style-samples.ts
 *   npx tsx scripts/style-samples.ts --text=Bounce --font=anton
 *   npx tsx scripts/style-samples.ts --only=halftone,melt
 *   npx tsx scripts/style-samples.ts --label
 *
 * `--label` sets every sample in its own name — Sandblast set in Sandblast —
 * which is the only way to see whether a preset is called the right thing.
 * Stroke width still comes from the reference word, so a treatment's sizing is
 * measured against one face rather than drifting with the length of the label.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { parse } from '../src/engine/opentype'
import { shapeText } from '../src/engine/text'
import { medianStrokeWidth } from '../src/engine/measure'
import { defaults, FAMILY_LABEL } from '../src/engine/treatments/types'
import { TREATMENTS } from '../src/engine/treatments/registry'
import { ringsToPathD } from '../src/engine/svg'
import { pointCount } from '../src/engine/paths'
import { mulberry32 } from '../src/engine/prng'
import type { ParamValues, Treatment } from '../src/engine/treatments/types'

const FLAG_POINTS = 2200
const FLAG_MS = 400

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=')
    return [k, v.join('=') || 'true']
  }),
) as Record<string, string>

// counters (e, o, a), a descender, an ascender and a diagonal — the shapes
// every one of these treatments can get wrong
const text = args.text ?? 'Wedge'
const fontDir = args.font ?? 'archivoblack'
const only = args.only ? new Set(args.only.split(',')) : null
const outDir = args.out ?? 'out/samples'

const bytes = readFileSync(`public/fonts/${fontDir}/font.ttf`)
const font = parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
const labelMode = args.label === 'true'
type Shaped = ReturnType<typeof shapeText>
const shapeCache = new Map<string, Shaped>()
function shapeFor(word: string): Shaped {
  const hit = shapeCache.get(word)
  if (hit) return hit
  const made = shapeText(font, word)
  shapeCache.set(word, made)
  return made
}
const reference = shapeFor(text)
// Measured once, on the reference word: sizes are percentages of the stroke,
// so letting it drift with each label would make the presets incomparable.
const stroke = medianStrokeWidth(
  reference.glyphs.map((g) => g.rings),
  reference.unitsPerEm * 0.1,
)

interface Row {
  label: string
  svg: string
  contours: number
  points: number
  ms: number
}

function render(treatmentId: string, apply: Treatment['apply'], params: ParamValues, shaped: Shaped) {
  const started = performance.now()
  let d = ''
  let contours = 0
  let points = 0
  let penX = 0
  for (const g of shaped.glyphs) {
    const rings = apply(g.rings, params, {
      // one stream per glyph, same as the app, so a sample looks like the app
      rng: mulberry32(1337 + g.glyphIndex * 7919),
      unitsPerEm: shaped.unitsPerEm,
      strokeWidth: stroke,
      advanceWidth: 0,
      penX,
    })
    contours += rings.length
    points += pointCount(rings)
    d += ringsToPathD(rings, g.x, 0)
    penX = g.x
  }
  const ms = performance.now() - started
  void treatmentId
  return { d, contours, points, ms }
}

// each sample gets its own box, because in label mode every one is a
// different word and a shared viewBox would crop the long ones

/**
 * The specimen itself. `currentColor` rather than a literal, so one sheet reads
 * correctly on both a light and a dark ground — the ink is whatever the page
 * says the ink is.
 */
function svgFor(d: string, shaped: Shaped): string {
  const pad = shaped.unitsPerEm * 0.12
  const sheetW = shaped.width + pad * 2
  const top = shaped.ascender + pad
  const bottom = shaped.descender - pad * 2 // melt runs below the baseline
  const sheetH = top - bottom
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.round(sheetW)} ${Math.round(sheetH)}" ` +
    `preserveAspectRatio="xMidYMid meet" role="img">` +
    `<g transform="translate(${Math.round(pad)}, ${Math.round(top)}) scale(1,-1)">` +
    `<path d="${d}" fill="currentColor" fill-rule="evenodd"/></g></svg>`
  )
}

mkdirSync(outDir, { recursive: true })

const sections: string[] = []
let flagged = 0

let shown = 0
let totalRows = 0
for (const treatment of TREATMENTS) {
  if (only && !only.has(treatment.id)) continue
  shown++
  const base = defaults(treatment)
  const rows: Row[] = []

  // the default first: it is the handshake, and the one setting most people
  // will ever see
  const settings = [
    { label: 'default', values: base },
    ...(treatment.presets ?? []).map((p) => ({ label: p.name, values: p.values })),
  ]
  for (const setting of settings) {
    const params: ParamValues = { ...base, ...setting.values }
    // in label mode the specimen is the preset's own name, and the treatment's
    // name stands in for the unnamed default
    const word = labelMode ? (setting.label === 'default' ? treatment.name : setting.label) : text
    const shaped = shapeFor(word)
    const { d, contours, points, ms } = render(treatment.id, treatment.apply, params, shaped)
    rows.push({ label: setting.label, svg: svgFor(d, shaped), contours, points, ms })
    totalRows++
  }

  // one standalone file per treatment, for opening large
  writeFileSync(`${outDir}/${treatment.id}.svg`, rows.map((r) => r.svg).join('\n'))

  const specimens = rows
    .map((r) => {
      const hot = r.points > FLAG_POINTS || r.ms > FLAG_MS
      if (hot) flagged++
      return (
        `<figure class="spec${hot ? ' is-hot' : ''}">` +
        `<div class="ink">${r.svg}</div>` +
        `<figcaption><span class="spec-name">${r.label}</span>` +
        `<span class="spec-cost">${r.contours} contours` +
        `<i>·</i>${r.points} pts<i>·</i>${r.ms.toFixed(0)}ms` +
        `${hot ? '<b class="over">over budget</b>' : ''}</span></figcaption></figure>`
      )
    })
    .join('')

  const dials = treatment.params
    .filter((p) => p.primary)
    .map((p) => p.label)
    .join(', ')

  sections.push(
    `<section class="cand" id="${treatment.id}" data-id="${treatment.id}">
      <div class="cand-head">
        <div class="cand-id">
          <p class="eyebrow">${FAMILY_LABEL[treatment.family]}</p>
          <h2>${treatment.name}</h2>
          <p class="blurb">${treatment.blurb}</p>
        </div>
        <div class="cand-meta">
          <p class="dials"><span class="k">Dials</span> ${dials}</p>
          <div class="verdict" role="group" aria-label="Verdict for ${treatment.name}">
            <button type="button" data-v="keep">Keep</button>
            <button type="button" data-v="maybe">Maybe</button>
            <button type="button" data-v="cut">Cut</button>
          </div>
        </div>
      </div>
      <div class="specs">${specimens}</div>
      <details class="how"><summary>How it works</summary><p>${treatment.story}</p></details>
    </section>`,
  )
}

const head = `<title>Ways to Ruin a Letter</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,800&family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;1,6..72,300&family=Roboto+Mono:wght@400;500&display=swap">
<style>
/* Palette: proofing-press greys with a single ink-red, spent only on the
   over-budget flag and the live verdict — the two things that must be seen. */
:root {
  color-scheme: light dark;
  --paper:   #f1f2ef;
  --sheet:   #fbfbfa;
  --ink:     #15171a;
  --muted:   #6d726e;
  --faint:   #8f938f;
  --rule:    #dcdedb;
  --rule-2:  #c9ccc8;
  --red:     #b4341a;
  --keep:    #2f6b4f;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --paper:  #101211;
    --sheet:  #191c1b;
    --ink:    #e9ebe7;
    --muted:  #969b96;
    --faint:  #6e736e;
    --rule:   #262a28;
    --rule-2: #363b38;
    --red:    #ff6d4d;
    --keep:   #62b98d;
  }
}
:root[data-theme="dark"] {
  --paper:  #101211;
  --sheet:  #191c1b;
  --ink:    #e9ebe7;
  --muted:  #969b96;
  --faint:  #6e736e;
  --rule:   #262a28;
  --rule-2: #363b38;
  --red:    #ff6d4d;
  --keep:   #62b98d;
}

* { box-sizing: border-box; }
body {
  margin: 0;
  padding: clamp(20px, 4vw, 56px) clamp(16px, 4vw, 48px) 96px;
  background: var(--paper);
  color: var(--ink);
  font-family: Newsreader, Georgia, 'Times New Roman', serif;
  font-size: 17px;
  line-height: 1.55;
  font-weight: 300;
  -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 1180px; margin: 0 auto; display: flex; flex-direction: column; gap: 46px; }

h1, h2, .eyebrow, .verdict button, .k, .tally {
  font-family: 'Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif;
}
.spec-cost, .dials, code { font-family: 'Roboto Mono', ui-monospace, monospace; }

/* ---- masthead ---- */
.mast { display: flex; flex-direction: column; gap: 18px; }
.rule-top { height: 3px; background: var(--ink); }
h1 {
  margin: 0;
  font-size: clamp(38px, 7.5vw, 74px);
  font-weight: 800;
  line-height: 0.95;
  letter-spacing: -0.025em;
  text-wrap: balance;
}
.standfirst { margin: 0; max-width: 62ch; font-size: clamp(17px, 2vw, 20px); color: var(--muted); }
.standfirst b { font-weight: 400; color: var(--ink); }
.facts {
  display: flex; flex-wrap: wrap; gap: 6px 26px;
  padding-top: 14px; border-top: 1px solid var(--rule);
  font-family: 'Roboto Mono', ui-monospace, monospace;
  font-size: 12px; color: var(--faint);
  font-variant-numeric: tabular-nums;
}
.facts span { white-space: nowrap; }
.facts b { color: var(--ink); font-weight: 500; }

.tally {
  position: sticky; top: 0; z-index: 5;
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  margin: 0 calc(clamp(16px, 4vw, 48px) * -1);
  padding: 11px clamp(16px, 4vw, 48px);
  background: color-mix(in srgb, var(--paper) 88%, transparent);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--rule);
  font-size: 13px; font-weight: 600; letter-spacing: 0.01em;
}
.tally .n { font-variant-numeric: tabular-nums; }
.tally .kept { color: var(--keep); }
.tally .hint { font-weight: 400; color: var(--faint); }

/* ---- a candidate ---- */
.cand {
  content-visibility: auto;
  contain-intrinsic-size: auto 620px;
  display: flex; flex-direction: column; gap: 20px;
  padding-top: 26px;
  border-top: 1px solid var(--rule-2);
}
.cand-head {
  display: grid; grid-template-columns: minmax(0, 1fr) auto;
  gap: 20px 40px; align-items: start;
}
.cand-id { display: flex; flex-direction: column; gap: 5px; }
.eyebrow {
  margin: 0; font-size: 11px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.16em; color: var(--faint);
}
h2 { margin: 0; font-size: clamp(26px, 3.6vw, 38px); font-weight: 600; letter-spacing: -0.02em; line-height: 1; }
.blurb { margin: 2px 0 0; max-width: 56ch; color: var(--muted); }
.cand-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 12px; }
.dials { margin: 0; font-size: 11.5px; color: var(--faint); text-align: right; max-width: 34ch; }
.dials .k { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.14em; margin-bottom: 2px; }

.verdict { display: flex; border: 1px solid var(--rule-2); border-radius: 2px; overflow: hidden; }
.verdict button {
  appearance: none; border: 0; border-right: 1px solid var(--rule-2);
  background: var(--sheet); color: var(--muted);
  padding: 7px 15px; font-size: 12px; font-weight: 600; letter-spacing: 0.02em;
  cursor: pointer; transition: background 0.12s, color 0.12s;
}
.verdict button:last-child { border-right: 0; }
.verdict button:hover { background: var(--rule); color: var(--ink); }
.verdict button:focus-visible { outline: 2px solid var(--ink); outline-offset: -2px; }
.verdict button[aria-pressed="true"] { background: var(--ink); color: var(--paper); }
.cand[data-verdict="keep"] .verdict button[aria-pressed="true"] { background: var(--keep); color: #fff; }
.cand[data-verdict="cut"] { opacity: 0.42; }
.cand[data-verdict="cut"] .verdict { opacity: 1; }

/* ---- specimens ---- */
.specs { display: grid; grid-template-columns: repeat(auto-fit, minmax(290px, 1fr)); gap: 12px; }
.spec {
  margin: 0; display: flex; flex-direction: column;
  background: var(--sheet); border: 1px solid var(--rule); border-radius: 2px; overflow: hidden;
}
.ink { color: var(--ink); padding: 6px 4px; }
.ink svg { display: block; width: 100%; height: auto; }
figcaption {
  display: flex; flex-direction: column; gap: 3px;
  padding: 9px 12px 11px; border-top: 1px solid var(--rule);
}
.spec-name {
  font-family: 'Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif;
  font-size: 13px; font-weight: 600; letter-spacing: 0.01em;
}
.spec-cost { font-size: 10.5px; color: var(--faint); font-variant-numeric: tabular-nums; }
.spec-cost i { font-style: normal; padding: 0 6px; opacity: 0.5; }
.spec-cost .over { display: block; margin-top: 3px; color: var(--red); font-weight: 500; }
.spec.is-hot { border-color: color-mix(in srgb, var(--red) 45%, var(--rule)); }

.how { font-size: 15px; }
.how summary {
  cursor: pointer; color: var(--muted);
  font-family: 'Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif;
  font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.12em;
}
.how summary:focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; }
.how p { margin: 10px 0 0; max-width: 72ch; color: var(--muted); font-style: italic; }

@media (max-width: 720px) {
  .cand-head { grid-template-columns: 1fr; }
  .cand-meta { align-items: flex-start; }
  .dials { text-align: left; }
}
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>`

const body = `<div class="wrap">
  <header class="mast">
    <div class="rule-top"></div>
    <h1>Ways to ruin a letter</h1>
    <p class="standfirst">Every treatment in the workbench, at its default and each of its
    presets. All of it is <b>pure outline geometry</b> — nothing here is a picture of a
    font, it is a font. Mark anything that wants another look.</p>
    <div class="facts">
      <span>Set in <b>${fontDir}</b></span>
      <span>Measured stem <b>${stroke.toFixed(0)}</b> units</span>
      <span><b>${shown}</b> treatments</span>
      <span><b>${totalRows}</b> settings</span>
      <span><b>${flagged}</b> over budget</span>
    </div>
  </header>

  <div class="tally">
    <span class="n"><span class="kept" id="tally-keep">0 keep</span> · <span id="tally-maybe">0 maybe</span> · <span id="tally-cut">0 cut</span></span>
    <span class="hint">Your marks stay in this browser.</span>
  </div>

${sections.join('\n')}
</div>
<script>
(function () {
  var KEY = 'ffs-candidates-verdict'
  var saved = {}
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {} } catch (e) { saved = {} }

  var cands = [].slice.call(document.querySelectorAll('.cand'))

  function paint() {
    var count = { keep: 0, maybe: 0, cut: 0 }
    cands.forEach(function (c) {
      var v = saved[c.dataset.id] || ''
      if (v) c.setAttribute('data-verdict', v); else c.removeAttribute('data-verdict')
      if (count[v] !== undefined) count[v]++
      ;[].slice.call(c.querySelectorAll('.verdict button')).forEach(function (b) {
        b.setAttribute('aria-pressed', String(b.dataset.v === v))
      })
    })
    document.getElementById('tally-keep').textContent = count.keep + ' keep'
    document.getElementById('tally-maybe').textContent = count.maybe + ' maybe'
    document.getElementById('tally-cut').textContent = count.cut + ' cut'
  }

  cands.forEach(function (c) {
    c.addEventListener('click', function (e) {
      var b = e.target.closest('.verdict button')
      if (!b) return
      // clicking the live verdict clears it, so a mark is never a trap
      saved[c.dataset.id] = saved[c.dataset.id] === b.dataset.v ? '' : b.dataset.v
      try { localStorage.setItem(KEY, JSON.stringify(saved)) } catch (err) {}
      paint()
    })
  })

  paint()
})()
</script>`

const page = head + '\n' + body
writeFileSync(`${outDir}/contact-sheet.html`, page)
console.log(
  `wrote ${outDir}/contact-sheet.html — ${(page.length / 1024).toFixed(0)} KB, ${flagged} flagged`,
)
