# FOR FONT'S SAKE

A browser type foundry. Pick a font, apply a treatment, tweak it live — down to a single
letter — and export a real, installable, correctly-licensed font. Then set it on a
specimen sheet, drive the dials with sound, and take the sheet away as an image or a clip.

Everything runs client-side. No account, no server, nothing leaves your machine — a font you
bring is read in the page and never sent anywhere.

**Live at [forfontsake.xyz](https://forfontsake.xyz)** — see [docs/DEPLOY.md](docs/DEPLOY.md)
for how it is deployed.

New here, or picking this up after a break? Start with **[docs/STATE.md](docs/STATE.md)**.

## Why

Every tool in this category ships a broken download. One fulfils exports by email; another's
export hands back the unmodified source file; a third's has been reported dead since March
2025. So the first promise here is dull and load-bearing: **the download works**, and the
build proves it rather than asserting it.

The closest prior art is [NaN's Glyph Filters](https://github.com/NaN-xyz/Glyph-Filters) /
[generativefonts.xyz](https://www.generativefonts.xyz/) — 28 named procedural treatments,
essentially this idea, but as Python scripts for Glyphs.app 2.6.6, which is abandonware
requiring a $300 macOS app. This is the browser version with a live preview and a download
button.

## Vocabulary

| Term | What it means |
| --- | --- |
| **Engine** | `src/engine/` — pure geometry. Takes glyph outlines and parameters, returns outlines. No DOM, no font parsing in the hot path. |
| **Treatment** | One named effect (Grit, Bubble, Bleed…). A pure function from outlines to outlines, plus a parameter spec and named presets. |
| **Stack** | Up to three treatments in a row, each working on what the last one left. `applyChain` is the one place that runs them. |
| **Workbench** | The live page where you turn dials. A React app in `src/`. |
| **Source font** | The font a treatment is applied to. Seven ship with the tool, all OFL, and you can bring your own. |
| **Cut** | One randomised version of a letter. Several cuts per letter stop a word looking stamped. |
| **Export** | Building the real font in the browser. Same engine as `build:font`, run in a worker. |
| **Plate** | The specimen block at the top of the workbench: the type, the two choices that define it, and the door to the sheet. |
| **Override** | One glyph's exceptions to the stack — sparse dial deltas over the global chain, set by selecting letters in the glyph grid. Never a different stack. |
| **Sheet** | The specimen sheet: Instagram-portrait SVG, word draggable and resizable, downloadable as PNG/SVG — or recorded as video while sound drives the dials. |

## Treatments

Each is a pure function, applied consistently across the character set, driven by a seeded
PRNG so any result is reproducible from its parameters.

Seventeen of them, grouped in the picker by what they do to a letter.

| Treatment | What it does |
| --- | --- |
| *Wear* | |
| **Grit** | Erosion — chunks bitten out of the edge, holes eaten through the strokes. |
| *Ink* | |
| **Bubble** | Fattened and rounded, the way a marker nib turns a corner. |
| **Bleed** | Wet ink spreading unevenly, pooling where strokes meet. |
| **Soak** | Corners melted away, counters squeezed to slits but never sealed. |
| **Melt** | Sagging off the baseline, drips tapering out from where the ink pooled. |
| **Organic** | Differential growth — wet ink at a few steps, brain coral at many. |
| *Screens* | |
| **Halftone** | A printer's screen: the letter rebuilt out of dots on a rotated grid. |
| **Stipple** | Dotwork — evenly scattered, never aligned, hazing out past the edge. |
| **Hatch** | Engraved: ruled lines through the letter, crossed if you want the tone. |
| **Scanline** | Stripes across the letter, some slipping sideways as the scanner loses sync. |
| **Pixel** | Dropped onto a coarse grid, with a dithered fringe where it half-covers. |
| *Press* | |
| **Ghost** | Out of register — the fringe two impressions leave where only one landed. |
| *Structure* | |
| **Outline** | Hollow, hairline, or an inline stripe within the strokes. |
| **Onion** | Line inside line inside line, until the letter runs out of room. |
| **Extrude** | An outlined face over a solid block shadow, swept behind the letter. |
| **Mosaic** | Each stroke cut across its width into tiles, with grout between. |
| **Shatter** | Sliced apart and knocked out of true, each piece drifting on its own. |

The screens are all built on one idea: a filled letter has no darkness for a screen to read,
so the tone comes from the geometry instead — how deep into the stroke a mark sits, measured
by successive insets. No raster anywhere.

Every dial a treatment has is on the page, and each ships named presets (Photocopy, Sandblast,
Rust, Marker, Balloon, Wet ink…) shown as pictures of themselves. There is no unnamed state:
picking a treatment lands you on one of its presets — `defaultPreset` names which, otherwise
the first — so one is always selected and Reset has somewhere to go back to. A dial marked
`primary` is what the specimen sheet's sound rides; one marked `steady` is front-of-house but
the sound skips it, because mode switches alternate rather than animate and a word that
strobes reads as a fault.

`npx tsx scripts/style-samples.ts` puts every treatment at every preset on one contact sheet,
with the contour, point and millisecond cost of each. Add `--label` to set each sample in
its own name — Sandblast set in Sandblast — which is the only way to see whether a preset
is called the right thing; `--font=anton` and `--only=halftone,melt` narrow it.

## Running it

```bash
npm install
npm run dev
```

That is the whole of it. The baked glyph data the app reads is not in the repo — it is cut
from the shipped faces — so `npm run dev` regenerates it first by way of `predev`. It takes
a second or two and only actually does work when the fonts or the extractor have changed.

The Python environment is optional, and only for verifying exported fonts and cutting the
metrics-only subsets the specimen field's caret sits on:

```bash
python3 -m venv .venv && ./.venv/bin/pip install opentype-sanitizer fonttools uharfbuzz
```

Without it the data step still runs and says `(no preview font)` for each face. The app
itself needs none of it at runtime.

| Command | What it does |
| --- | --- |
| `npm run dev` | The workbench, with hot reload. The normal way to work on it. |
| `npm run build:workbench` | Builds the self-contained page into `out/workbench.html`, for publishing. Also recuts the preview font subsets. |
| `npm run build:font -- --treatment=grit --alts=3` | Headless font build. See flags below. |
| `npm run verify:font -- out/Font.ttf Pirata` | Gates a font on seven checks, or eight with `VERIFY_AGAINST` set. |
| `npm run typecheck` | App and test configs. Never use bare `tsc --noEmit`. |
| `npm run test` | Engine unit tests. |

### Font build flags

```
--src=public/fonts/anton/font.ttf   source font
--treatment=grit                    which treatment (or a stack: grit+bubble)
--p.amount=60 --p.scale=40          any parameter, by key
--alts=3                            cuts per letter
--family="My Font"                  derivative name
--seed=1337                         reproducibility
--only=A                            treat one character, for fast iteration
```

### Verification

`verify:font` is the project's CI. Seven checks:

1. **File size**
2. **ots-sanitize** — the sanitiser browsers actually run on `@font-face`
3. **fontTools round-trip** — better diagnostics when OTS just says "invalid"
4. **CoreText** — what Font Book and Safari use, via `scripts/ctcheck.swift`
5. **Alternates substitute** — shapes with HarfBuzz and checks repeats differ
6. **Ligatures form** — shapes `baffle` with and without `liga`
7. **Naming and Reserved Font Names**, plus metric parity with `VERIFY_AGAINST=<source>`

Checks 5 and 6 exist because a GSUB table can be structurally valid and still substitute
nothing.

Metric parity is not glyph count. `--alts=N` adds real glyphs — three cuts of Pirata One
is 1144 glyphs against the source's 386 — so check 7 compares unitsPerEm, cmap coverage,
and the advance width of every glyph the two fonts share, and reports the alternates as
the additions they are:

```
ok  metrics match source — upm 1000, 386 source glyphs matched, 758 alternates added, 382 codepoints mapped
```

It still fails on width drift, because a treatment that reflows the text it is applied to
has failed however good it looks. Treatments that declare `growth()` — every one that can
push past the original silhouette — widen the advance to match, and do so by one
constant across *every* glyph — spaces and untreated glyphs included, so the plate's
uniform letter-spacing compensation matches the exported font exactly. A single uniform
widening is reported rather than failed, and widths that moved by *differing* amounts are
the failure:

```
FAIL advance widths drifted unevenly — 379 glyphs across 2 different shifts (+42×378, +49×1)
```

Glyphs are paired by name, falling back to codepoint for fonts whose `post` table keeps no
names. Alternates are held to their own base glyph's width, since a drifted one would make
the rotation jitter.

One honest caveat: a font carrying per-glyph overrides can *legitimately* grow different
glyphs by different amounts, which the uneven-drift rule will flag under `VERIFY_AGAINST`.
That is the check working as designed on an input it predates — see Known debt.

## Architecture

```
src/engine/
  treatments/     one file per treatment, plus the registry
  paths.ts        Clipper2 helpers: scaling, offsetting, rounding, simplifying
  measure.ts      median stroke width of a font
  noise.ts        seeded coherent noise
  blob.ts         irregular blob shared by grit and bleed
  flatten.ts      glyph contours to polygons
  fontio.ts       open a font, treat every glyph, write a new one
  extract.ts      one font → outlines + licence; the build script and the page share it
  gsub.ts         our own GSUB writer
  sfnt.ts         add and remove tables from a finished binary
src/audio/
  AudioEngine.ts  one AudioContext + analyser → {bass, mid, high, level, beat, onset}
  sources.ts      the mic (browser DSP off), and the synthesized bubble loop — no asset
  EnvelopeFollower / OnsetDetector / bands — the analysis stack, from FLUX (MIT)
src/lib/
  glyphData.ts    outlines shipped as data, so no font parser reaches the browser
  importFont.ts   a font off a file input: read, register for metrics, keep the bytes
  render.ts       one line of type, and the whole glyph set, as SVG paths
  urlState.ts     the whole workbench state, encoded into the address bar
  savedStyles.ts  the shelf, kept across reloads — states, never rendered outlines
  poster.ts       the specimen sheet, as standalone SVG; also makes share.png
  videoRecorder.ts the pulsing sheet to MP4/WebM — canvas frames + the audio tap
  exportFont.ts   drives the worker, and hands the finished font over
src/components/
  Plate.tsx       the specimen — and the field you type it into
  Panel.tsx       the stack, presets and dials — global, or scoped to selected glyphs
  GlyphGrid.tsx   every glyph on shared baselines; also the selection surface for overrides
  Waterfall.tsx   the same line at seven sizes
  Dial.tsx        one parameter, with its default marked on the track
  Shelf.tsx       saved styles
  Poster.tsx      the sheet overlay — layouts, word placement, sound, recording, download
src/workers/      buildFont.worker.ts — the export, and reading an uploaded font
public/fonts/preview/   metrics-only subsets — never seen, see below
scripts/          build, verify and comparison tooling
```

**You type into the specimen itself.** The big line is not a preview of a field
somewhere else. A transparent input lies over the treated outlines, so the caret,
selection, click-to-position and every keyboard behaviour are the browser's own. That
only works because the field lays its text out on the source font's *raw* advance widths —
which is what `public/fonts/preview/*.woff2` are for. They are a few KB each, cut to the
preview charset by `make-glyph-data`, and never rendered. Every layout feature is switched
off on that field too: kerning moves pairs by real amounts, and a font you bring has kerning
where those subsets do not. Measured across all eight faces, shipped and uploaded: 0.01px.

**Sizes are shares of the stroke, not the em.** A parameter of 100 means one stem width.
The bundled fonts range from 11% to 20% of the em in weight, so an em-relative setting means
something different on every face and no preset can travel.

**The download is built in the page.** Pressing Download runs the same
`buildTreatedFont` the CLI runs, in a Web Worker, over the real source bytes — so the file
you get is the file `build:font` would have made. The worker keeps the font writer off the
main thread and out of the initial parse; the published single-file page carries the source
fonts inline, because a download button that cannot download is the exact failure this
project exists to avoid.

**The engine never calls `Math.random`.** Everything takes an injected PRNG, so a font is
reproducible from `{chain, seed}` — which is also what the URL encodes, and what a saved
style stores.

**One `applyChain`, used by everything.** The preview, the specimen sheet and the font writer
run over different inputs but must agree exactly on what a stack produces, so they share one
function. The random stream is shared across the steps rather than renewed per step: a second
step given a fresh PRNG draws different geometry, and the specimen and the download would
quietly stop matching.

**Overrides are dial deltas, never a different stack.** Select glyphs in the grid and the
dials write per-glyph exceptions — sparse values over the global chain, merged in exactly one
place (`resolveChain`, beside `applyChain`, for the same reason). A global slider still flows
through every dial a glyph has not overridden. The seed stays global; the per-glyph reroll is
a nudge on top of it, and the whole map rides a seventh URL field that old links simply never
had.

**The sheet is a performance.** Sound — the mic, or a bubble loop synthesized in the page —
drives each treatment's primary dials around their set points, through deliberately slow
followers whose pace is the Speed dial. The seed never moves, so any captured frame is
exactly reproducible from the values it was drawn with. Downloads take the current frame;
Record clip takes up to fifteen seconds of it, sound included, as MP4 where the browser can
write one.

## Licence

GPL-3.0-only. The font engine builds on
[font-flux-js](https://github.com/mattlag/Font-Flux-JS), which is GPL-3.0; since this app
ships its code to every visitor, the app carries the same licence. That was a deliberate
choice — this is meant to be a free, open tool.

Fonts you generate are yours, subject to the licence of whatever font you started from. The
export path enforces OFL Reserved Font Name rules rather than leaving you to discover them.

## Known debt

- **Big faces are not fast to export.** Pacifico takes ~26s in the page for a 2.7 MB file.
  What remains is proportional work; the next real gain is splitting glyphs across several
  workers.
- **The specimen sheet has two layouts.** A third is a function in `poster.ts` and an entry
  in `LAYOUTS`.
- **Metric parity and per-glyph overrides disagree.** `VERIFY_AGAINST`'s uneven-drift rule
  predates overrides, which can legitimately grow different glyphs differently. The check
  needs to learn to read the override map before it can gate such a font.

`docs/STATE.md` carries the current list; this one goes stale first.

See `docs/DECISIONS.md` for the reasoning behind the choices above, and the traps that cost
real time.
