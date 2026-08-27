# Decisions and traps

Why the project is built the way it is, and the things that cost real time. Written so the
reasoning survives when the conversation that produced it doesn't.

---

## Direction

### Mosaic is one treatment, not the product

The project started as a mosaic generator, aimed at reproducing a hand-made azulejo-style
wordmark for a rugby brand. It never got close, and more tuning would not have closed it.

Treatments divide by whether they survive being applied *uniformly* across 300+ glyphs.
Azulejo-style mosaic scores lowest of everything surveyed, alongside blackletter flourishing:
the motifs are art-directed per tile, and that per-letter judgement is exactly what a global
rule cannot supply. The hand-made original *was* that judgement.

Grit is the counterexample and the reason the tool works at all. Texture is **easier** to
automate than mosaic, because the eye does not expect texture to follow letter structure, so
uniform application reads as intentional.

The lesson generalises: **prefer treatments that transform the whole shape over treatments
that decorate it with motifs.**

### The brand font is made by hand, elsewhere

The LisbonTag font is drawn letter by letter outside this repo. That work is ~80% shared with
a future "import your own letters" feature, so nothing is wasted, but it does not belong in
the tool's critical path.

### Deterministic geometry, not AI

Rejected AI generation as the engine: no cross-glyph consistency, no live sliders, traced
outlines bloat fonts, and real vector AI fonts are years out. Determinism is also the
differentiator — a result is reproducible from its parameters, which is what makes URLs
shareable and exports repeatable.

### Open source, GPL

`font-flux-js` is GPL-3.0 and ships to every visitor, so the app is GPL too. Chosen
deliberately rather than worked around; the alternative was a worse font writer.

---

## Engine

### Size everything by stroke width

Every size parameter is a percentage of the source font's **median stem width**, where 100
means one stroke. Measured in `measure.ts` by scanning horizontal lines across a sample of
plain glyphs and taking the median ink run — the median, because a glyph's widest run is
usually a crossbar or serif, which would drag an average past what the eye reads as the
stroke.

The bundled fonts range 11%–20% of the em. Em-relative sizing meant a spread that read as
damp ink on Pirata One closed every counter in Anton, and no preset could travel.

### Never call `Math.random`

Treatments take an injected PRNG through `TreatmentContext`. A test pins this. It is what
makes a font reproducible from `{treatment, params, seed}`.

### Randomness needs to look random

Three separate fixes, each found by looking at output rather than by reasoning:

- **Sizes drawn log-uniformly**, not uniformly. A uniform draw clusters everything near the
  mean, which is what made every loss look the same size.
- **Gaps redrawn every time**, not stepped at a fixed interval. Evenly spaced damage betrays
  the algorithm however irregular each individual piece is.
- **Blobs take two noise octaves** so they never settle into circles.

### Erosion must not sever strokes

Bites are capped at half the stroke width. The unevenness multiplier reaches six times the
base size, which was enough for a single bite to cut a stem clean through.

Interior holes are placed by distance from the edge, so stroke cores stay solid and the face
survives being set small. An earlier version gated holes to *within* the protect radius,
which inverted the rule into "only ever touch the edge" and produced a pinstripe just inside
the outline rather than erosion. Worth remembering as a shape of bug: the guard was real, it
was just applied the wrong way round.

### Performance

Two changes took Bubble from 768 ms a redraw to 178 ms:

- **Simplify before offsetting.** Cost scales with point count, and the flattened outline
  carries far more points than the result can show.
- **Pass a font-unit `arcTolerance`** to `inflatePaths`. Clipper's default emits far more arc
  segments than a font can display.

Plus `deterministic: true` on treatments that ignore randomness, so the renderer stops
computing identical "alternates" for them.

---

## Fonts and file format

### TrueType `glyf`, not CFF

CFF caps charstrings at roughly 1500 points and textured glyphs go straight past it. The move
from opentype.js to font-flux-js was to get a real `glyf` writer. Editing the opened font in
place also means metrics, cmap coverage and kerning survive untouched rather than being
copied by hand.

### Composite glyphs must be decomposed

Accented characters — and whole lowercase alphabets in caps-only faces — are stored as
*references* to other glyphs. `font-flux-js` gives those `components` and **no** `contours`,
so a treatment sees an empty shape and silently produces nothing.

This was invisible until Bebas Neue was added and its entire lowercase came out blank. Every
accented glyph in every font had the same problem. `decomposeGlyph` follows references and
flattens them; `components` is cleared when treated outlines are written back, or the
component is drawn twice.

### We write our own GSUB

`font-flux-js` writes a GSUB the OpenType Sanitiser rejects, so browsers refuse the font. A
plain untouched round-trip reproduces it — it is the library, not our edits. Pirata One hid
it for a long time because its GSUB is effectively empty.

Nothing in the library's API removes the data: deleting `tables.GSUB`, `clearSubstitutions()`
and `setFeatures({})` all leave it. So `sfnt.ts` cuts it from the finished binary and
`gsub.ts` writes a replacement carrying both the source's ligatures and the alternate
rotation.

**The rotation** substitutes each glyph according to which variant the *previous* glyph
became, wrapping at the end of the cycle. Contextual lookups see substitutions already made to
their left in the same pass, and that is what carries the cycle along a word. `calt` is on by
default everywhere, so nothing has to be switched on.

**Carried lookups are written first** so a ligature forms from the plain letters rather than
being missed because one of them had already been swapped. The two compose: a ligature glyph
is itself treated and varied, so `baffle` gives `b a.alt1 ffl.alt2 e.alt1`.

**Language-specific rules are dropped deliberately.** Reproducing `locl` faithfully needs the
language systems that trigger it; carried without those it fires everywhere, and a Turkish
dotted `i` turns up in English text.

### Variable fonts are not safe to export

Replacing outlines leaves `gvar` deltas stale. A variable source parses fine for preview but
must not be exported until that is handled. The unused variable Playfair was removed so it
could not be reached for by accident.

---

## Verification

The rule the project runs on: **a check that only proves the file parses proves almost
nothing.**

- OTS is what browsers run, and it is binary pass/fail with a *silent* fallback — a rejected
  font just doesn't render, with no error the user can see.
- CoreText is what Font Book and Safari use, and it is the strictest of the three.
- A GSUB can be structurally valid and substitute nothing, so verification **shapes text with
  HarfBuzz** and asserts that repeats differ with the feature on and collapse with it off.

Every one of these caught a real bug that the others missed.

### Tests worth keeping

Counters open on `o e B 8`. Small glyphs survive (`. , : ; ' ! i j ä`). Determinism, and
difference under a changed seed. Point budgets. Metric parity with the source. The sfnt
rewriter's head checksum validating against the spec's magic constant.

---

## Traps that cost real time

| Trap | Symptom | Fix |
| --- | --- | --- |
| `contours.map(flattenContour)` | Glyphs render as spikes | `map` passes the index as the second argument, which was the curve-subdivision count. Use an explicit arrow. |
| TrueType winding | Counters fill, outers cancel | TrueType fills opposite to PostScript: outer contours clockwise. Reverse on the way out. |
| `font.validate()` | Name changes silently reverted | It resyncs `info` from stored source tables, permanently. Export first, then validate the produced bytes. |
| `requestAnimationFrame` in preview pages | Controls appear dead | rAF is suspended in hidden and background tabs. Use a timer. |
| Stale bundle | Engine edits appear to do nothing | `build:workbench` chains glyph data → esbuild → HTML for exactly this reason. Always run it after engine changes. |
| Bare `tsc --noEmit` | Passes while broken | The root tsconfig has `files: []` and checks nothing. Use `npm run typecheck`. |
| Test fixtures that lie | A correct change fails a test | A stem fixture declared a 120-unit stroke while being 160 wide. Make fixtures self-consistent before doubting the code. |

---

## Product decisions taken

- **Panel on the right.** Compared both live; right won because the reading column leads.
- **3–4 primary dials per treatment**, the rest behind "more".
- **Randomise moves only the seed**, never the sliders — sliders are intent, the seed is
  texture. The seed is a visible control, because a button that changes the result without
  changing any visible setting reads as broken.
- **Seed and cuts controls hide** for deterministic treatments rather than sitting there
  implying an effect they cannot have.
- **Presets are named after what they produce**, not after their settings.
- **The whole state lives in the URL**, so a setting is a link. Determinism is worth little
  when the only way back to a result is remembering where the sliders were.
- **No node graph.** Origami ships three separate features whose only job is hiding its own
  graph. A capped 2–3 layer stack is the ceiling worth having.

---

## Where to look next

Highest value first, from the competitive research:

1. **Consolidate the workbench into the React app.** Prerequisite for real UI work — see
   *Known debt* in the README.
2. **Amount master slider** lerping source → preset. Lightroom shipped this after a paid
   plugin filled the gap for years.
3. **Hover a preset to preview it** on the main canvas. Nearly free here because the engine
   is client-side and deterministic; expensive for everyone else.
4. **Slider craft**: drag on the label not the number, `Shift` for fine, a tick on the track
   showing the default.
5. **In-browser export**, so the workbench and the download are the same path.
6. **Licence panel at font upload** — read the source's `name` table and `fsType`, show
   open / unknown / restricted. Nobody in the category does this.
