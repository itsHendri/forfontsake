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
| Stale bundle | Engine edits appear to do nothing | `build:workbench` chains glyph data → Vite → inlined HTML for exactly this reason. Always run it after engine changes before publishing. |
| Bare `tsc --noEmit` | Passes while broken | The root tsconfig has `files: []` and checks nothing. Use `npm run typecheck`. |
| `Object.entries` on a glyph map | The specimen grid opened on the digits | JavaScript hoists integer-like keys to the front of an object, so `"0"`–`"9"` come before `"A"`. Iterate an explicit order. |
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

## The workbench is a React app, published as one file

It began as an HTML string generated by a build script, which was the right call while it was
a throwaway proof and the wrong one the moment it became the interface. Editing a template
literal gives no components, no hot reload and no type safety on the markup.

It is now a normal Vite app. `scripts/inline-build.ts` folds the build output — script,
stylesheet and glyph outlines — into a single self-contained file for publishing, because an
artifact has no server to fetch from. The app reads `window.__GLYPH_DATA__` when it is
present and falls back to fetching, so the same code serves both.

## The specimen is the input

The obvious build is a text field that drives a preview. It is also the wrong one: it puts
the thing you are editing and the thing you are judging in two different places, and the
field ends up small and off to one side, which is exactly the complaint that started this
rework.

So the big line *is* the field. A transparent `<input>` sits over the treated outlines,
which means the caret, selection, click-to-position, double-click-a-word, IME and mobile
keyboards are all the browser's own — none of it reimplemented.

That only holds if the browser lays the text out on the same advance widths the outlines
were drawn with. Two things make it true. Treatments preserve advance widths, which the
font verification already tested for its own reasons; and the source faces are shipped as
metrics-only woff2 subsets in `public/fonts/preview/`, cut to the preview charset, applied
to the field and never actually seen. Measured across all seven faces the field's text
width and the drawn outline width agree exactly — a delta of 0.0 px.

The vertical half is measured rather than derived. A hidden probe span with a zero-height
strut reports where the text baseline actually falls in real layout, and the outlines are
positioned against that. Deriving it from `ascender`/`descender` instead would mean
guessing which of hhea, OS/2 typo or OS/2 win metrics the browser chose, and being wrong
on some faces. The plate carries a little padding above the line so faces whose ascenders
overshoot their own line box — Pacifico by about 2 px at display size — are not clipped.

## One order for every treatment

Controls are laid out in the same sequence whatever treatment is loaded: actions, presets,
dials, more dials, then randomness. Switching treatments moves the values without moving
the furniture.

Cuts per letter and seed come last and are grouped apart, because they are the same two
controls on every treatment that has them rather than part of any particular effect. They
disappear entirely on deterministic treatments instead of sitting there implying an effect
they cannot have.

## The download runs in the page

Exporting was a command-line step for a long time while the page only previewed. That split
was untenable for a tool whose whole positioning is *the download works*: every competitor
ships a broken money step, so ours has to be the most visible control on the page, not a
README instruction.

It is the same `buildTreatedFont` the CLI calls, given the same source bytes, so the file is
the one the verified build path produces. Three things make it work in a browser:

- **A Web Worker.** Treating a whole face takes seconds — 7 s in Node for Anton's 1,373
  glyphs — which is fine to wait for and not fine to freeze the page for. The worker is
  inlined at build time so the published single file still works.
- **The source fonts ride along.** The preview deliberately ships outlines as data and no
  font parser, but an export has to rewrite the original binary. The published page carries
  those binaries inline; everywhere else they are fetched on demand, so nobody downloads a
  font just to look.
- **Reserved Font Names are enforced in the field.** A derivative of Pirata One may not have
  "Pirata" anywhere in its name, so the default name is generated to be safe and the button
  disables while the typed one is not.

**Progress has two phases, and saying so matters.** The glyph loop reports a fraction, but
writing the substitutions and checksumming a few megabytes afterwards takes as long again on
a big face. A bar sitting at 100% for a minute reads as a hang, so assembly is named.

## Growth grows the curve; without insertion it only trembles

Growth is differential growth run on the glyph's own contours — repulsion between nearby
points, attraction toward the neighbour midpoint, and a leash tying every point to where it
started. It came out of the "Reaction Diffusion Typography" sketch, which despite the name
runs no reaction-diffusion at all; `docs/RESEARCH-2026-08.md` has the full teardown.

**The first cut of it did nothing, and the reason is worth remembering.** It followed the
sketch exactly: resample the outline densely once, then iterate the two forces on a fixed set
of points. That looked like a faint wobble at any setting. Measured, the perimeter grew 5.7%
over sixty steps — because a closed curve whose point count is fixed, with a smoothing term
holding the spacing even, *cannot get longer*. A curve that cannot lengthen cannot fold, and
folding is the entire effect. Adding node insertion took the same sixty steps to a ~50%
longer perimeter and produced real ruffling.

So the rule: **the insertion is not an optimisation detail of differential growth, it is the
mechanism.** The sketch gets away without it by running many hundreds of frames on a very
densely sampled bitmap contour; we cannot, and should not want to.

What is ours rather than the algorithm's:

- **A point budget per glyph**, capped at 700. Folding is unbounded and every point is bytes
  in the exported file. This is the line between a treatment and a glyph nobody can install —
  an untreated glyph runs to a couple of hundred points, and a Pirata One export at the Coral
  preset with three cuts lands at 715 KB with a 448-point worst glyph, which is fine.
- **The leash is what `growth()` reports**, so the builder widens advance widths by exactly
  the distance a point is allowed to travel.
- **A seeded jitter before the first step.** A resampled straight edge is perfectly symmetric
  and symmetric forces cancel, so without it a stem would sit still while a round letter
  buckled — the same word coming out half-grown.
- **Presets are cut back until the word still reads as the word.** The dials go far past all
  of them. At full spread and step count the letters dissolve into a genuine brain-coral maze,
  which is a fine thing to arrive at by turning a dial and a bad thing to hand somebody as a
  starting point.

The force strength was tuned by measurement, not taste: at half the point spacing per step it
gives a monotonic, non-saturating response across the Steps dial. Stronger (1.2×) reads better
on the perimeter graph and destroys legibility at the preset values; weaker lets the attraction
term win and the shape *shrinks*.

## The stack has one apply loop, and one random stream

The engine always took a chain; the UI only ever handed it one treatment. Exposing it turned
out to be less about the UI than about a trap underneath.

Three places now put a glyph through a stack: the live preview, the specimen sheet, and the
font writer. They run over different inputs — flattened library outlines in the page, real
font bytes in the writer — so they cannot share much. But the one thing they must agree on to
the last unit is which treatments run, in what order, over what context. Written three times,
that agreement is a convention, and conventions rot. It is now one exported function,
`applyChain`, and the other two call it.

The subtle half is the context. Each step gets the *same* `TreatmentContext`, and therefore
the same seeded random stream, rather than a fresh one. Treatments draw from that stream as
they work, so a second step handed a new rng produces different geometry from the same
settings. If the preview renewed it and the writer did not, the specimen on screen and the
font on disk would disagree — silently, and only for stacked settings, which is the worst
possible shape for a bug in a tool whose entire claim is that the download matches. Sharing
one function makes it impossible instead of merely tested.

The cap is three. Every step re-treats what the last produced, so cost compounds and so does
illegibility: by the third pass a letter is usually at the edge of being one. Four would only
offer a slower way to make something unreadable.

The URL kept its six fields. The treatment field and the parameter field each hold one entry
per step, joined by `+`, so a link written before stacking existed has no `+` and still reads
as a one-step chain. Those links were the thing people were told to keep, and there is a test
pinning the old shape.

## Alternates are only cut for letters people set

Three cuts of every glyph is the obvious reading of "three cuts per letter" and it is
wasteful to the point of being a bug. Pacifico carries 1,528 outlines, most of them
Vietnamese tone-mark composites; cutting three of each tripled the export for variation
nobody will ever see. The file was 6.5 MB and took 12.6 seconds, and roughly eight-ninths of
the alternates work was for glyphs that will never appear twice in a line of display type.

Alternates exist for exactly one reason: so a letter repeating in a word does not read as
stamped. That is a property of the few dozen characters people actually set. So they are cut
for Basic Latin and Latin-1 Supplement — which keeps é, ñ, ü and å, characters that do turn
up — and everything past that is still treated, still in the font, and gets one cut. Pacifico
came to 2.7 MB and 5.2 seconds; Anton went from 4 MB to 1.75.

The pair that had to survive it is the rotation and the ligatures, because both live in the
GSUB we write. The verifier checks both, and both still hold.

Profiling is what found it. The glyph loop was 4.1 seconds of a 12.6 second build — the other
8.5 were the alternates pass, which also reported no progress at all, so the bar filled up
during the first third and then sat at full. It reports now, and the main loop was rescaled
to the first half so the bar covers the whole build instead of filling twice.

## Where to look next

Highest value first, from the competitive research:

1. **Amount master slider** lerping source → preset. Lightroom shipped this after a paid
   plugin filled the gap for years.
2. **Hover a preset to preview it** on the main canvas. Nearly free here because the engine
   is client-side and deterministic; expensive for everyone else.
3. **Slider craft**: drag on the label not the number, `Shift` for fine. The tick on the
   track showing the default is done.
5. **Licence panel at font upload** — read the source's `name` table and `fsType`, show
   open / unknown / restricted. Nobody in the category does this.
