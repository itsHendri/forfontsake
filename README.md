# FOR FONT'S SAKE

A browser type foundry. Pick a font, apply a treatment, tweak it live, and export a real,
installable, correctly-licensed font.

Everything runs client-side. No upload, no account, nothing leaves your machine.

**forfontsake.xyz** (domain owned, not yet deployed — see [docs/DEPLOY.md](docs/DEPLOY.md))

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
| **Workbench** | The live page where you turn dials. A React app in `src/`. |
| **Source font** | The font a treatment is applied to. Seven ship with the tool; all OFL. |
| **Cut** | One randomised version of a letter. Several cuts per letter stop a word looking stamped. |
| **Export** | Building the real font in the browser. Same engine as `build:font`, run in a worker. |
| **Plate** | The specimen block at the top of the workbench: the type, and the two choices that define it. |

## Treatments

Each is a pure function, applied consistently across the character set, driven by a seeded
PRNG so any result is reproducible from its parameters.

| Treatment | What it does |
| --- | --- |
| **Grit** | Erosion — chunks bitten out of the edge, holes eaten through the strokes. |
| **Bubble** | Fattened and rounded, the way a marker nib turns a corner. |
| **Bleed** | Wet ink spreading unevenly, pooling where strokes meet. |
| **Outline** | Hollow, hairline, or an inline stripe within the strokes. |
| **Extrude** | A block shadow swept behind the letter. |
| **Mosaic** | Each stroke cut across its width into tiles, with grout between. |

Treatments expose 3–4 primary dials with the rest behind a disclosure, and ship named presets
(Photocopy, Sandblast, Rust, Marker, Balloon, Wet ink…).

## Running it

```bash
npm install
python3 -m venv .venv && ./.venv/bin/pip install opentype-sanitizer fonttools uharfbuzz
```

The Python environment is for verification, and for cutting the metrics-only font
subsets the workbench's specimen field needs. The app itself needs none of it at runtime.

| Command | What it does |
| --- | --- |
| `npm run dev` | The workbench, with hot reload. The normal way to work on it. |
| `npm run build:workbench` | Builds the self-contained page into `out/workbench.html`, for publishing. Also recuts the preview font subsets. |
| `npm run build:font -- --treatment=grit --alts=3` | Headless font build. See flags below. |
| `npm run verify:font -- out/Font.ttf Pirata` | Gates a font on seven checks. |
| `npm run typecheck` | App and test configs. Never use bare `tsc --noEmit`. |
| `npm run test` | Engine unit tests. |

### Font build flags

```
--src=public/fonts/anton/font.ttf   source font
--treatment=grit                    which treatment
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
has failed however good it looks. Treatments that declare `growth()` (bleed, bubble,
extrude, outline) widen the advance to match the fatter outline, and do so by one constant
across every glyph they touch — so a single uniform widening is reported rather than
failed, and widths that moved by *differing* amounts are the failure:

```
FAIL advance widths drifted unevenly — 379 glyphs across 2 different shifts (+42×378, +49×1)
```

Glyphs are paired by name, falling back to codepoint for fonts whose `post` table keeps no
names. Alternates are held to their own base glyph's width, since a drifted one would make
the rotation jitter.

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
  gsub.ts         our own GSUB writer
  sfnt.ts         add and remove tables from a finished binary
src/lib/
  glyphData.ts    outlines shipped as data, so no font parser reaches the browser
  render.ts       one line of type, and the whole glyph set, as SVG paths
  urlState.ts     the whole workbench state, encoded into the address bar
src/components/
  Plate.tsx       the specimen — and the field you type it into
  Panel.tsx       presets and dials, in one order for every treatment
  GlyphGrid.tsx   every glyph in the face, on shared baselines
  Waterfall.tsx   the same line at seven sizes
  Dial.tsx        one parameter, with its default marked on the track
  Shelf.tsx       saved styles
public/fonts/preview/   metrics-only subsets — never seen, see below
scripts/          build, verify and comparison tooling
```

**You type into the specimen itself.** The big line is not a preview of a field
somewhere else. A transparent input lies over the treated outlines, so the caret,
selection, click-to-position and every keyboard behaviour are the browser's own. That
only works because the field lays its text out on the source font's advance widths —
which is what `public/fonts/preview/*.woff2` are for. They are a few KB each, cut to the
preview charset by `make-glyph-data`, and never rendered. Because treatments preserve
advance widths, the field and the outlines agree to the pixel on all seven faces.

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
reproducible from `{treatment, params, seed}` — which is also what the URL encodes.

## Licence

GPL-3.0-only. The font engine builds on
[font-flux-js](https://github.com/mattlag/Font-Flux-JS), which is GPL-3.0; since this app
ships its code to every visitor, the app carries the same licence. That was a deliberate
choice — this is meant to be a free, open tool.

Fonts you generate are yours, subject to the licence of whatever font you started from. The
export path enforces OFL Reserved Font Name rules rather than leaving you to discover them.

## Known debt

- **Not deployed.** The domain is owned; [docs/DEPLOY.md](docs/DEPLOY.md) has the plan.
- **The bundle carries the font writer for everyone** — the export worker is inlined so the
  published single-file page works, which costs every visitor ~877 KB of JS whether or not
  they export. Splitting it is the first job in DEPLOY.md.
- **Saved styles don't persist** across a reload.
- **Treatments don't stack** in the interface, though the engine takes a chain.
- **Uploading your own font** isn't wired up.

See `docs/DECISIONS.md` for the reasoning behind the choices above, and the traps that cost
real time.
