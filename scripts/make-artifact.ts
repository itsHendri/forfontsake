#!/usr/bin/env tsx
// Builds the grit comparison page with the real exported fonts embedded, so
// what the page renders is the actual font file, not a picture of one.
import { readFileSync, writeFileSync } from 'node:fs'

const face = (file: string) => `data:font/woff2;base64,${readFileSync(file).toString('base64')}`

const FONTS = [
  { id: 'clean', file: 'out/clean.woff2' },
  { id: 'g45', file: 'out/g45.woff2' },
  { id: 'g65', file: 'out/g65.woff2' },
  { id: 'g85', file: 'out/g85.woff2' },
]

const ROWS = [
  {
    id: 'clean',
    label: 'Source',
    amount: '—',
    size: '56 KB',
    note: 'Pirata One, untouched. The baseline to judge against.',
  },
  {
    id: 'g45',
    label: 'Grit 45',
    amount: '45 / 60',
    size: '270 KB',
    note: 'Chunks off the edge, holes through the strokes, sizes spread wide.',
  },
  {
    id: 'g65',
    label: 'Grit 65',
    amount: '65 / 75',
    size: '282 KB',
    note: 'Bigger losses. Terminals and thin joins start to break away.',
  },
  {
    id: 'g85',
    label: 'Grit 85',
    amount: '85 / 95',
    size: '229 KB',
    note: 'Heavy. Some letters lose parts entirely — past the useful edge.',
  },
]

const fontFaces = FONTS.map(
  (f) => `@font-face{font-family:"${f.id}";src:url(${face(f.file)}) format("woff2");font-display:block}`,
).join('\n')

const rows = ROWS.map(
  (r) => `
      <article class="row" id="row-${r.id}">
        <div class="rail">
          <h2>${r.label}</h2>
          <dl>
            <div><dt>amount</dt><dd>${r.amount}</dd></div>
            <div><dt>file</dt><dd>${r.size}</dd></div>
          </dl>
          <p class="note">${r.note}</p>
        </div>
        <div class="plate">
          <p class="specimen" style="font-family:'${r.id}',serif" data-specimen>LisbonTag</p>
        </div>
      </article>`,
).join('')

const waterfall = ROWS.filter((r) => r.id !== 'clean')
  .map(
    (r) => `
        <div class="wf-col">
          <span class="wf-label">${r.label}</span>
          ${[48, 28, 17, 11]
            .map(
              (s) =>
                `<p class="wf-line" style="font-family:'${r.id}',serif;font-size:${s}px" data-specimen>LisbonTag</p>`,
            )
            .join('')}
        </div>`,
  )
  .join('')

const html = `<title>Grit Specimen</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600&family=Roboto+Mono:wght@400;500&display=swap">
<style>
${fontFaces}

:root{
  --ink:#15171b;
  --paper:#e7e4db;
  --plate:#efece4;
  --rule:#cbc7bc;
  --muted:#6c6a61;
  --mark:#be3a22;
  --focus:#15171b;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --ink:#e3e0d6;
    --paper:#131410;
    --plate:#1a1b16;
    --rule:#33342c;
    --muted:#8b8a7e;
    --mark:#e0603f;
    --focus:#e3e0d6;
  }
}
:root[data-theme="dark"]{
  --ink:#e3e0d6;
  --paper:#131410;
  --plate:#1a1b16;
  --rule:#33342c;
  --muted:#8b8a7e;
  --mark:#e0603f;
  --focus:#e3e0d6;
}

*{box-sizing:border-box}
body{
  margin:0;
  background:var(--paper);
  color:var(--ink);
  font-family:"Archivo",system-ui,sans-serif;
  font-size:15px;
  line-height:1.6;
  -webkit-font-smoothing:antialiased;
}
.wrap{max-width:1080px;margin:0 auto;padding:0 28px 96px}

header{padding:56px 0 28px;border-bottom:1px solid var(--rule)}
.eyebrow{
  font-family:"Roboto Mono",monospace;
  font-size:11px;letter-spacing:.16em;text-transform:uppercase;
  color:var(--mark);margin:0 0 14px;
}
h1{
  font-family:"Archivo",sans-serif;font-weight:600;font-size:30px;line-height:1.2;
  margin:0 0 12px;text-wrap:balance;letter-spacing:-.01em;
}
.lede{margin:0;max-width:62ch;color:var(--muted)}
.lede strong{color:var(--ink);font-weight:500}

.controls{
  position:sticky;top:0;z-index:5;
  display:flex;flex-wrap:wrap;gap:14px;align-items:center;
  padding:14px 0;margin-bottom:8px;
  background:var(--paper);border-bottom:1px solid var(--rule);
}
label.field{display:flex;align-items:center;gap:10px}
label.field span{
  font-family:"Roboto Mono",monospace;font-size:11px;
  letter-spacing:.14em;text-transform:uppercase;color:var(--muted);
}
input[type=text]{
  font:inherit;font-size:15px;color:var(--ink);
  background:var(--plate);border:1px solid var(--rule);border-radius:2px;
  padding:8px 12px;min-width:240px;
}
input[type=text]:focus-visible{outline:2px solid var(--focus);outline-offset:1px}
.hint{font-family:"Roboto Mono",monospace;font-size:11px;color:var(--muted)}

.row{
  display:grid;grid-template-columns:200px minmax(0,1fr);gap:28px;
  padding:30px 0;border-bottom:1px solid var(--rule);align-items:start;
}
.rail h2{
  font-size:13px;font-weight:600;margin:0 0 10px;
  letter-spacing:.1em;text-transform:uppercase;
}
.rail dl{margin:0 0 12px;font-family:"Roboto Mono",monospace;font-size:12px}
.rail dl>div{display:flex;justify-content:space-between;gap:12px;padding:3px 0;border-bottom:1px dotted var(--rule)}
.rail dt{color:var(--muted)}
.rail dd{margin:0;font-variant-numeric:tabular-nums}
.note{margin:0;font-size:13px;line-height:1.5;color:var(--muted)}

.plate{
  background:var(--plate);border:1px solid var(--rule);border-radius:2px;
  padding:22px 26px;overflow-x:auto;
}
.specimen{
  margin:0;color:var(--ink);line-height:1.05;
  font-size:clamp(44px,8.5vw,96px);
  word-break:break-word;
}

.wf{padding:34px 0 0}
.wf-head{
  font-family:"Roboto Mono",monospace;font-size:11px;letter-spacing:.16em;
  text-transform:uppercase;color:var(--mark);margin:0 0 6px;
}
.wf-intro{margin:0 0 20px;color:var(--muted);max-width:62ch}
.wf-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:18px}
.wf-col{
  background:var(--plate);border:1px solid var(--rule);border-radius:2px;
  padding:18px 20px;overflow-x:auto;
}
.wf-label{
  display:block;font-family:"Roboto Mono",monospace;font-size:11px;
  letter-spacing:.12em;text-transform:uppercase;color:var(--muted);
  margin-bottom:12px;
}
.wf-line{margin:0 0 10px;line-height:1.15;color:var(--ink)}
.wf-line:last-child{margin-bottom:0}

.ask{
  margin-top:44px;padding:24px 26px;
  border:1px solid var(--rule);border-left:3px solid var(--mark);border-radius:0;
  background:var(--plate);
}
.ask h2{font-size:14px;font-weight:600;margin:0 0 10px;letter-spacing:.08em;text-transform:uppercase}
.ask ol{margin:0;padding-left:20px;max-width:62ch}
.ask li{margin-bottom:8px}
.ask li:last-child{margin-bottom:0}

@media (max-width:760px){
  .row{grid-template-columns:1fr;gap:14px}
  .wrap{padding:0 18px 64px}
}
</style>

<div class="wrap">
  <header>
    <p class="eyebrow">For Font's Sake · treatment proof</p>
    <h1>Grit, eaten harder</h1>
    <p class="lede">Rebuilt so the erosion actually cuts. Bites now sit <strong>on</strong> the outline
    instead of just inside it, so they take chunks out of the silhouette rather than scoring a groove
    along it, and holes go right through the strokes. Piece sizes are drawn across a wide range, so a
    few big losses sit among smaller ones. Every line is a <strong>real font file</strong> — type in
    the box and all four re-render.</p>
  </header>

  <div class="controls">
    <label class="field">
      <span>Specimen text</span>
      <input type="text" id="text" value="LisbonTag" autocomplete="off" spellcheck="false">
    </label>
    <span class="hint">Latin letters, digits and basic punctuation are embedded.</span>
  </div>

  ${rows}

  <section class="wf">
    <p class="wf-head">The legibility question</p>
    <p class="wf-intro">Erosion this heavy has a floor: below a certain size the losses merge with the
    counters and the word stops resolving. Worth knowing where that floor is before committing to a
    setting — a brand font that only works above 40px is a real constraint, not a dealbreaker.</p>
    <div class="wf-grid">${waterfall}</div>
  </section>

  <section class="ask">
    <h2>What I need your eye on</h2>
    <ol>
      <li>Is the erosion reading as organic now, or do the pieces still look too uniform?</li>
      <li>Which of the three would you reach for — and is there a setting past 85 you'd want available even if it breaks letters?</li>
      <li>Two separate controls sit under this: how much is eaten, and how big each loss is. Does splitting them that way match how you'd want to steer it?</li>
    </ol>
  </section>
</div>

<script>
  const input = document.getElementById('text');
  const targets = document.querySelectorAll('[data-specimen]');
  const sync = () => {
    const value = input.value.length ? input.value : 'LisbonTag';
    targets.forEach((el) => { el.textContent = value; });
  };
  input.addEventListener('input', sync);
</script>
`

writeFileSync('out/grit-specimen.html', html)
console.log(`wrote out/grit-specimen.html — ${(html.length / 1024).toFixed(0)} KB`)
