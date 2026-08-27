#!/usr/bin/env tsx
// Builds the live specimen page: the real engine bundled in, driven by sliders.
import { readFileSync, writeFileSync } from 'node:fs'

const bundle = readFileSync('out/live-bundle.js', 'utf8')
const glyphData = readFileSync('out/glyph-data.json', 'utf8')

const html = `<title>Treatment Workbench</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600&family=Roboto+Mono:wght@400;500&display=swap">
<style>
:root{
  --ink:#15171b; --paper:#e7e4db; --plate:#efece4; --rule:#cbc7bc;
  --muted:#6c6a61; --mark:#be3a22; --track:#d5d1c6;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --ink:#e3e0d6; --paper:#131410; --plate:#1a1b16; --rule:#33342c;
    --muted:#8b8a7e; --mark:#e0603f; --track:#2b2c25;
  }
}
:root[data-theme="dark"]{
  --ink:#e3e0d6; --paper:#131410; --plate:#1a1b16; --rule:#33342c;
  --muted:#8b8a7e; --mark:#e0603f; --track:#2b2c25;
}

*{box-sizing:border-box}
body{
  margin:0;background:var(--paper);color:var(--ink);
  font-family:"Archivo",system-ui,sans-serif;font-size:15px;line-height:1.6;
  -webkit-font-smoothing:antialiased;
}
.wrap{max-width:1180px;margin:0 auto;padding:0 26px 80px}
header{padding:48px 0 22px;border-bottom:1px solid var(--rule)}
.eyebrow{
  font-family:"Roboto Mono",monospace;font-size:11px;letter-spacing:.16em;
  text-transform:uppercase;color:var(--mark);margin:0 0 12px;
}
h1{font-weight:600;font-size:29px;line-height:1.2;margin:0 0 10px;letter-spacing:-.01em}
.lede{margin:0;max-width:64ch;color:var(--muted)}

/* Specimen leads, controls sit to its right, so everything you read runs down
   one edge instead of being interrupted by the panel. */
.layout{display:grid;grid-template-columns:minmax(0,1fr) 290px;gap:34px;padding-top:26px;align-items:start}
.layout .panel{order:2}
.layout main{order:1}

.panel{position:sticky;top:22px;display:flex;flex-direction:column;gap:18px}
.panel h2{
  font-family:"Roboto Mono",monospace;font-size:11px;letter-spacing:.16em;
  text-transform:uppercase;color:var(--muted);margin:0;font-weight:500;
}
.ctl{display:flex;flex-direction:column;gap:5px}
#dials,#more{display:flex;flex-direction:column;gap:18px}
.ctl-head{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
.ctl-head label{font-size:14px;font-weight:500}
.ctl-head output{
  font-family:"Roboto Mono",monospace;font-size:12px;color:var(--mark);
  font-variant-numeric:tabular-nums;
}
.ctl-note{margin:0;font-size:12px;line-height:1.4;color:var(--muted)}

input[type=range]{
  -webkit-appearance:none;appearance:none;width:100%;height:18px;
  background:transparent;cursor:pointer;margin:0;
}
input[type=range]::-webkit-slider-runnable-track{height:2px;background:var(--track)}
input[type=range]::-moz-range-track{height:2px;background:var(--track)}
input[type=range]::-webkit-slider-thumb{
  -webkit-appearance:none;appearance:none;width:14px;height:14px;border-radius:50%;
  background:var(--ink);margin-top:-6px;border:none;
}
input[type=range]::-moz-range-thumb{
  width:14px;height:14px;border-radius:50%;background:var(--ink);border:none;
}
input[type=range]:focus-visible{outline:2px solid var(--mark);outline-offset:4px}

details{border-top:1px solid var(--rule);padding-top:14px}
details summary{
  cursor:pointer;font-family:"Roboto Mono",monospace;font-size:11px;
  letter-spacing:.14em;text-transform:uppercase;color:var(--muted);list-style:none;
}
details summary::-webkit-details-marker{display:none}
details summary::before{content:"+ ";color:var(--mark)}
details[open] summary::before{content:"– "}
details .ctl{margin-top:14px}

.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
button{
  font:inherit;font-size:13px;color:var(--ink);background:var(--plate);
  border:1px solid var(--rule);border-radius:2px;padding:7px 13px;cursor:pointer;
}
button:hover{border-color:var(--ink)}
button:focus-visible{outline:2px solid var(--mark);outline-offset:2px}
input[type=text]{
  font:inherit;font-size:15px;color:var(--ink);background:var(--plate);
  border:1px solid var(--rule);border-radius:2px;padding:8px 12px;width:100%;
}
input[type=text]:focus-visible{outline:2px solid var(--mark);outline-offset:1px}
select{
  font:inherit;font-size:15px;color:var(--ink);background:var(--plate);
  border:1px solid var(--rule);border-radius:2px;padding:8px 12px;width:100%;
}
select:focus-visible{outline:2px solid var(--mark);outline-offset:1px}

.stage{
  background:var(--plate);border:1px solid var(--rule);border-radius:2px;
  padding:26px;min-height:230px;display:flex;align-items:center;
}
.stage svg{width:100%;height:auto;display:block}
.stage path{fill:var(--ink)}

.meta{
  display:flex;gap:20px;flex-wrap:wrap;margin-top:12px;
  font-family:"Roboto Mono",monospace;font-size:11px;color:var(--muted);
}
.meta b{color:var(--ink);font-weight:500;font-variant-numeric:tabular-nums}

.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{
  font:inherit;font-size:12px;padding:5px 11px;cursor:pointer;
  color:var(--ink);background:var(--plate);
  border:1px solid var(--rule);border-radius:2px;
}
.chip:hover{border-color:var(--ink)}
.chip.is-on{background:var(--ink);color:var(--paper);border-color:var(--ink)}

.shelf{margin-top:26px}
.shelf-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}
.shelf-head h2{
  font-family:"Roboto Mono",monospace;font-size:11px;letter-spacing:.16em;
  text-transform:uppercase;color:var(--mark);margin:0;font-weight:500;
}
.shelf-strip{display:flex;gap:10px;overflow-x:auto;padding-bottom:6px}
.kept{
  flex:0 0 auto;background:var(--plate);border:1px solid var(--rule);border-radius:2px;
  padding:8px;cursor:pointer;position:relative;
}
.kept:hover{border-color:var(--ink)}
.kept svg{display:block;height:44px;width:auto}
.kept path{fill:var(--ink)}
.kept span{
  display:block;font-family:"Roboto Mono",monospace;font-size:9px;
  color:var(--muted);margin-top:5px;white-space:nowrap;
}

.sizes{margin-top:26px}
.sizes h2{
  font-family:"Roboto Mono",monospace;font-size:11px;letter-spacing:.16em;
  text-transform:uppercase;color:var(--mark);margin:0 0 12px;font-weight:500;
}
.size-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px}
.size-cell{
  background:var(--plate);border:1px solid var(--rule);border-radius:2px;padding:14px 16px;
}
.size-cell span{
  display:block;font-family:"Roboto Mono",monospace;font-size:10px;
  letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:9px;
}
.size-cell svg{max-width:100%;height:auto;display:block}
.size-cell path{fill:var(--ink)}

.foot{
  margin-top:36px;padding:20px 24px;background:var(--plate);
  border:1px solid var(--rule);border-left:3px solid var(--mark);
}
.foot h2{font-size:13px;font-weight:600;margin:0 0 8px;letter-spacing:.08em;text-transform:uppercase}
.foot p{margin:0 0 8px;max-width:64ch;color:var(--muted)}
.foot p:last-child{margin-bottom:0}

@media (max-width:820px){
  .layout{grid-template-columns:1fr}
  .panel{position:static;order:-1}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style>

<div class="wrap">
  <header>
    <p class="eyebrow">For Font's Sake · workbench</p>
    <h1>Treatments, with the dials in your hands</h1>
    <p class="lede">This runs the actual treatment engine — every slider recomputes real glyph
    geometry in the page, the same code that builds the exported font. Pick a font and a treatment,
    then a few dials up front with the rest behind "more".</p>
  </header>

  <div class="layout">
    <form class="panel" id="panel" onsubmit="return false">
      <div class="ctl">
        <div class="ctl-head"><label for="text">Text</label></div>
        <input type="text" id="text" value="Grittier letters" autocomplete="off" spellcheck="false">
      </div>
      <div class="ctl">
        <div class="ctl-head"><label for="font">Font</label></div>
        <select id="font"></select>
      </div>
      <div class="ctl">
        <div class="ctl-head"><label for="treatment">Treatment</label></div>
        <select id="treatment"></select>
        <p class="ctl-note" id="blurb"></p>
      </div>
      <div class="row">
        <button type="button" id="reroll">Randomise</button>
        <button type="button" id="reset">Reset</button>
      </div>
      <div class="ctl" id="alts-ctl">
        <div class="ctl-head">
          <label for="alts">Cuts per letter</label>
          <output id="o-alts">3</output>
        </div>
        <input type="range" id="alts" min="1" max="5" step="1" value="3">
        <p class="ctl-note" id="alts-note">how many versions of each letter cycle as you type</p>
      </div>
      <div class="ctl" id="seed-ctl">
        <div class="ctl-head">
          <label for="seed">Random seed</label>
          <output id="o-seed">1337</output>
        </div>
        <input type="range" id="seed" min="1" max="9999" step="1" value="1337">
        <p class="ctl-note">Randomise just moves this. Same seed, same letters.</p>
      </div>
      <h2>Presets</h2>
      <div class="chips" id="presets"></div>
      <h2>Dials</h2>
      <div id="dials"></div>
      <details id="more-wrap">
        <summary>More</summary>
        <div id="more"></div>
      </details>
    </form>

    <main>
      <div class="stage"><svg id="stage" role="img" aria-label="Live specimen"></svg></div>
      <div class="meta">
        <span id="m-seed-wrap">seed <b id="m-seed">1337</b></span>
        <span id="m-alts-wrap">cuts <b id="m-alts">3</b></span>
        <span>contours <b id="m-contours">—</b></span>
        <span>redraw <b id="m-ms">—</b></span>
      </div>

      <section class="shelf" id="shelf-wrap" hidden>
        <div class="shelf-head">
          <h2>Kept</h2>
          <button type="button" id="keep">Keep this one</button>
        </div>
        <div class="shelf-strip" id="shelf"></div>
      </section>

      <section class="sizes">
        <h2>Same font, smaller</h2>
        <div class="size-grid" id="sizes"></div>
      </section>

      <section class="foot">
        <h2>Where this still falls short</h2>
        <p>The address bar carries the whole state, so a setting you like is a link you can send or
        bookmark. <em>Keep this one</em> parks a result in the strip above; clicking it puts every
        control back where it was.</p>
        <p><strong>Bleed</strong> is the wet-ink one: it grows the letter unevenly and swells where
        strokes meet, rather than fattening it evenly the way Bubble does.</p>
        <p>Only Grit uses randomness, so the seed and cuts controls hide themselves for the others —
        Bubble, Outline and Extrude give the same result every time from the same dials.</p>
        <p>Treatments still run one at a time. Stacking them is possible in the engine but not wired
        to the interface, and it isn't obviously worth it yet.</p>
        <p>The exported font carries these now. Each cut ships as its own glyph and a hand-written
        <code>calt</code> feature rotates between them, so a doubled letter comes out as two
        different cuts in Figma or anywhere else — not only on this page.</p>
      </section>
    </main>
  </div>
</div>

<script>${bundle}</script>
<script>
(function () {
  var DATA = ${glyphData};
  FFS.init(DATA);

  var current = 'grit';
  var currentFont = 'pirataone';
  var params = FFS.defaultParams(current);
  var seed = 1337;
  var alternates = 3;

  var fontPick = document.getElementById('font');
  fontPick.innerHTML = FFS.listFonts().map(function (f) {
    return '<option value="' + f.id + '">' + f.label + ' — ' + f.note + '</option>';
  }).join('');
  fontPick.value = currentFont;
  fontPick.addEventListener('change', function () {
    currentFont = fontPick.value;
    schedule();
  });

  var pick = document.getElementById('treatment');
  var treatments = FFS.listTreatments();
  pick.innerHTML = treatments.map(function (t) {
    return '<option value="' + t.id + '">' + t.name + '</option>';
  }).join('');

  var this_is_deterministic = 'This treatment has no randomness — the same dials always give the same letters';

  function applyPreset(values) {
    Object.keys(values).forEach(function (k) { params[k] = values[k]; });
    syncControls();
    markPreset();
    schedule();
  }

  function syncControls() {
    Object.keys(params).forEach(function (k) {
      var input = document.getElementById('c-' + k);
      var out = document.getElementById('o-' + k);
      if (input) input.value = params[k];
      if (out) out.textContent = params[k];
    });
  }

  // highlight a preset only while the dials still match it exactly
  function markPreset() {
    var chips = document.querySelectorAll('#presets .chip');
    var presets = FFS.listPresets(current);
    for (var i = 0; i < chips.length; i++) {
      var v = presets[i] ? presets[i].values : null;
      var same = v && Object.keys(v).every(function (k) { return params[k] === v[k]; });
      chips[i].classList.toggle('is-on', !!same);
    }
  }

  function buildPresets() {
    var presets = FFS.listPresets(current);
    var host = document.getElementById('presets');
    host.innerHTML = presets.map(function (p, i) {
      return '<button type="button" class="chip" data-preset="' + i + '">' + p.name + '</button>';
    }).join('');
    host.parentElement.querySelector('h2').style.display = presets.length ? '' : 'none';
    host.style.display = presets.length ? '' : 'none';
  }

  function buildControls() {
    var specs = FFS.listParams(current);
    var html = function (p) {
      return '<div class="ctl" data-key="' + p.key + '">' +
        '<div class="ctl-head"><label for="c-' + p.key + '">' + p.label + '</label>' +
        '<output id="o-' + p.key + '">' + params[p.key] + '</output></div>' +
        '<input type="range" id="c-' + p.key + '" min="' + p.min + '" max="' + p.max +
        '" step="' + p.step + '" value="' + params[p.key] + '">' +
        (p.note ? '<p class="ctl-note">' + p.note + '</p>' : '') +
        '</div>';
    };
    var primary = specs.filter(function (p) { return p.primary; });
    var rest = specs.filter(function (p) { return !p.primary; });
    document.getElementById('dials').innerHTML = primary.map(html).join('');
    document.getElementById('more').innerHTML = rest.map(html).join('');
    document.getElementById('more-wrap').style.display = rest.length ? '' : 'none';
    var t = treatments.filter(function (x) { return x.id === current; })[0];
    document.getElementById('blurb').textContent = t ? t.blurb : '';
    // randomness only means something for treatments that consume it
    var random = !FFS.isDeterministic(current);
    document.getElementById('alts-ctl').style.display = random ? '' : 'none';
    document.getElementById('seed-ctl').style.display = random ? '' : 'none';
    document.getElementById('reroll').disabled = !random;
    document.getElementById('m-seed-wrap').style.display = random ? '' : 'none';
    document.getElementById('m-alts-wrap').style.display = random ? '' : 'none';
    buildPresets();
    markPreset();
    document.getElementById('reroll').title = random
      ? 'Move the seed to a new random value'
      : this_is_deterministic;
  }

  pick.addEventListener('change', function () {
    current = pick.value;
    params = FFS.defaultParams(current);
    buildControls();
    schedule();
  });
  var SIZES = [{label:'48 px', px:48},{label:'28 px', px:28},{label:'17 px', px:17},{label:'11 px', px:11}];

  var stage = document.getElementById('stage');
  var sizesEl = document.getElementById('sizes');
  var textEl = document.getElementById('text');
  var pending = null;

  sizesEl.innerHTML = SIZES.map(function (s) {
    return '<div class="size-cell"><span>' + s.label + '</span>' +
      '<svg data-px="' + s.px + '" role="img" aria-label="Specimen at ' + s.label + '"></svg></div>';
  }).join('');

  function draw() {
    pending = null;
    var text = textEl.value.length ? textEl.value : 'Grittier letters';
    var r = FFS.render(currentFont, current, text, params, seed, alternates);
    var pad = 40;
    var vb = [-pad, -r.ascender - pad, r.width + pad * 2, r.ascender - r.descender + pad * 2].join(' ');
    // font space is y-up; flip once here so every view can share the path
    var inner = '<g transform="scale(1,-1)"><path d="' + r.d + '"/></g>';
    stage.setAttribute('viewBox', vb);
    stage.innerHTML = inner;

    document.getElementById('m-contours').textContent = r.contours;
    document.getElementById('m-ms').textContent = Math.round(r.ms) + ' ms';
    document.getElementById('m-seed').textContent = seed;
    document.getElementById('m-alts').textContent = alternates;
    writeUrl();

    // the same geometry shown small — no recompute, so this is free
    var cells = sizesEl.querySelectorAll('svg');
    for (var i = 0; i < cells.length; i++) {
      var px = Number(cells[i].getAttribute('data-px'));
      var scale = px / (r.ascender - r.descender);
      cells[i].setAttribute('viewBox', vb);
      cells[i].setAttribute('width', Math.round(r.width * scale));
      cells[i].setAttribute('height', Math.round(px));
      cells[i].innerHTML = inner;
    }
  }

  function schedule() {
    // A timer rather than requestAnimationFrame: rAF is suspended entirely in
    // background or hidden tabs, which leaves the controls dead until the tab
    // is focused. A timer still coalesces bursts of input without that failure.
    if (pending === null) pending = setTimeout(draw, 0);
  }

  document.getElementById('panel').addEventListener('input', function (e) {
    var el = e.target;
    if (el.id === 'text') { schedule(); return; }
    if (el.id === 'seed') {
      setSeed(Number(el.value));
      schedule();
      return;
    }
    if (el.id === 'alts') {
      alternates = Number(el.value);
      document.getElementById('o-alts').textContent = el.value;
      schedule();
      return;
    }
    var ctl = el.closest('.ctl');
    if (!ctl) return;
    var key = ctl.getAttribute('data-key');
    if (!key) return;
    params[key] = Number(el.value);
    var out = document.getElementById('o-' + key);
    if (out) out.textContent = el.value;
    schedule();
  });

  function setSeed(v) {
    seed = v;
    var input = document.getElementById('seed');
    var out = document.getElementById('o-seed');
    if (input) input.value = v;
    if (out) out.textContent = v;
  }

  document.getElementById('presets').addEventListener('click', function (e) {
    var chip = e.target.closest('.chip');
    if (!chip) return;
    var preset = FFS.listPresets(current)[Number(chip.dataset.preset)];
    if (preset) applyPreset(preset.values);
  });

  // ---- keeping results ---------------------------------------------------
  var kept = [];
  function stateNow() {
    return {
      font: currentFont, treatment: current, seed: seed,
      alts: alternates, text: textEl.value, params: JSON.parse(JSON.stringify(params)),
    };
  }
  function keepCurrent() {
    var last = document.querySelector('#stage').innerHTML;
    var vb = document.getElementById('stage').getAttribute('viewBox');
    kept.unshift({ state: stateNow(), svg: last, vb: vb });
    if (kept.length > 12) kept.pop();
    renderShelf();
  }
  function renderShelf() {
    var wrap = document.getElementById('shelf-wrap');
    wrap.hidden = kept.length === 0;
    document.getElementById('shelf').innerHTML = kept.map(function (k, i) {
      var t = FFS.listTreatments().filter(function (x) { return x.id === k.state.treatment; })[0];
      return '<div class="kept" data-kept="' + i + '" title="Restore this">' +
        '<svg viewBox="' + k.vb + '" height="44">' + k.svg + '</svg>' +
        '<span>' + (t ? t.name : k.state.treatment) + ' · ' + k.state.seed + '</span></div>';
    }).join('');
  }
  document.getElementById('keep').addEventListener('click', keepCurrent);
  document.getElementById('shelf').addEventListener('click', function (e) {
    var cell = e.target.closest('.kept');
    if (!cell) return;
    restore(kept[Number(cell.dataset.kept)].state);
  });

  function restore(st) {
    currentFont = st.font;
    current = st.treatment;
    params = JSON.parse(JSON.stringify(st.params));
    alternates = st.alts;
    fontPick.value = currentFont;
    pick.value = current;
    textEl.value = st.text;
    document.getElementById('alts').value = alternates;
    document.getElementById('o-alts').textContent = alternates;
    buildControls();
    setSeed(st.seed);
    schedule();
  }

  // ---- shareable state ---------------------------------------------------
  function writeUrl() {
    var st = stateNow();
    var packed = [st.font, st.treatment, st.seed, st.alts,
      Object.keys(st.params).map(function (k) { return k + ':' + st.params[k]; }).join(','),
      encodeURIComponent(st.text)].join('|');
    try { history.replaceState(null, '', '#' + packed); } catch (err) { /* not fatal */ }
  }

  function readUrl() {
    var raw = location.hash.replace(/^#/, '');
    if (!raw) return false;
    var bits = raw.split('|');
    if (bits.length < 6) return false;
    try {
      var st = {
        font: bits[0], treatment: bits[1], seed: Number(bits[2]), alts: Number(bits[3]),
        text: decodeURIComponent(bits[5]), params: {},
      };
      FFS.listParams(st.treatment); // throws on an unknown treatment
      bits[4].split(',').forEach(function (pair) {
        var kv = pair.split(':');
        st.params[kv[0]] = Number(kv[1]);
      });
      restore(st);
      return true;
    } catch (err) {
      return false;
    }
  }

  document.getElementById('reroll').addEventListener('click', function () {
    setSeed(Math.floor(Math.random() * 9999) + 1);
    schedule();
  });


  document.getElementById('reset').addEventListener('click', function () {
    params = FFS.defaultParams(current);
    buildControls();
    setSeed(1337);
    schedule();
  });

  buildControls();
  if (!readUrl()) draw();
})();
</script>
`

writeFileSync('out/grit-workbench.html', html)
console.log(`wrote out/grit-workbench.html — ${(html.length / 1024).toFixed(0)} KB`)
