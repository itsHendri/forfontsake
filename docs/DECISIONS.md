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

## Overrides are dial deltas, never a different stack

Per-glyph customisation could have meant per-glyph *chains* — select a q, give it Bubble
while the rest wears Grit. It deliberately does not. An override is a sparse set of dial
values over the global chain: same steps, same order, only the numbers a person moved for
those letters. Three reasons, in order of weight.

First, "what am I looking at" must stay answerable. With deltas, a global slider still
flows through every dial a glyph has not overridden — the CSS-cascade model — and the
grid's corner dots plus the panel's accented dials account for every exception. With
forked stacks, the stack tabs would mean something different per selection and the answer
would be "it depends where you click".

Second, the three-caller rule. Preview, sheet and font writer already must agree through
`applyChain`; overrides add `resolveChain` beside it as the *only* place a delta merges,
keyed by character (the writer maps `glyph.unicode` back to one; composites and unmapped
glyphs take the global chain). A resolution model any more expressive than "merge these
numbers" would have three chances to diverge.

Third, GSUB. Every varied glyph must carry the same variant count or the rotation jitters,
so seed and cuts stay global — "sliders are intent, the seed is chance" survives per-glyph
scope. The reroll is a per-character *nudge* added to the seed, not a second seed.

The map rides a seventh `|` field in the URL. A state with no overrides encodes to the
same six fields it always did — old links byte-identical, old builds reading new links
simply ignore the extra field — and the shelf gets it for free because shelf entries are
encoded states. The characters themselves are percent-encoded, since the glyph set
contains the format's own punctuation.

## The sheet is a performance, not an animation

Sound does not touch the geometry directly and never touches the seed. It modulates the
treatments' primary dials around their set points — bass (with a kick on the beat), mids,
highs and level, one dial each in declared order — so a captured frame is exactly
reproducible from the values it was drawn with, which is the same promise the rest of the
tool makes.

Three decisions make it feel alive rather than broken. The values are *not* snapped to
the dial's step: the seed is fixed, so geometry is a continuous function of the values,
and quantising clicked through increments. The modulation runs through a second set of
followers far slower than the analyser's own (which are tuned for light shows — 12 ms
attack, made to twitch), each band on its own clock so the drives never move in lockstep;
the Speed dial is time dilation on those clocks alone, analysis untouched. And every
geometry rebuild is covered by an opaque cross-fade — the outgoing sheet lingering over
the incoming one — because the rebuild rate is honest about cost (adaptive, ~30fps for a
light chain, ~7 for Organic) and the fade is what turns the gap between frames into a
morph.

The bubble loop is synthesised in the page from a seeded PRNG — a low pulse for the beat
detector to latch onto, sine pops gliding down an octave, band-passed fizz — so no audio
asset ships and every visitor hears the same thirty seconds. The mic path disables the
browser's echo cancellation and noise suppression, which would eat exactly the transients
the detectors listen for. Recording paints each new sheet onto a canvas at 30fps, muxes
the analyser's tap alongside, and prefers MP4 because that is what Instagram and iMessage
accept without complaint. Nothing about closing the overlay may cost a take: the backdrop
stops closing while sound or recording runs, and Close and Escape finish and save.

The analysis stack (envelope followers, spectral-flux onset detection, band splitting) is
lifted from FLUX — the author's own audio-visual instrument, MIT — rather than rewritten,
attribution kept in the headers.

## Advances widen everywhere, or the caret lies

Growing treatments used to widen only the glyphs they touched, and only in the export —
the preview advanced on raw widths, so the downloaded font was spaced differently from
the plate that sold it. Now the chain's growth is added to *every* advance — spaces and
untreated glyphs included — in the preview, the sheet and the writer alike, and the
plate's transparent input compensates with letter-spacing, the one CSS property that adds
the same amount after every glyph. Uniformity is what makes that compensation exact;
measured against the drawn ink it is pixel-for-pixel. A glyph with its own override can
grow by its own amount, which diverges from the input only in the exported file — the
plate compensates with the global figure, and the divergence is recorded as debt rather
than hidden.

## The counter guard

Bubble and Bleed both closed the eye of an `e` well before their dials ran out, and
neither could get it back. Bubble's relief pass — shrink the result, grow it again —
softens an aperture that survived, but a hole that closed is not a small hole, it is an
absence, and no later offset can recover a shape that is no longer there.

So the counters are taken from the *original* glyph and put back afterwards
(`keepCounters` in `paths.ts`). Two details decide whether it reads:

- **Shrink by less than the treatment closed.** Give the hole back at exactly the
  closure and the guard only reproduces what the offset already did — a counter that is
  technically open and visually gone. The dial's job is to say how much of the closing to
  undo, so the closure passed in is scaled down by it.
- **Floor the aperture on the hole's own inradius** (`2A/P`), not on an absolute figure. A
  counter narrower than the closure would otherwise vanish however generous the dial is,
  and small counters are exactly the ones at risk.

It builds the cutters with `inflatePaths` rather than `grow`, deliberately: `grow`'s
empty-fallback would hand back a vanished hole at full size and carve the letter open.

At dial 0 the guard is off — a letter whose counters have filled is a real look, and it
stays reachable.

## Outline broke on high-contrast faces

The line weight is a share of the **median** stem. On a face with contrast, the thin
strokes are narrower than the inset that carves the band out of them, so the inner offset
collapses — and `grow()` returns its input when an offset empties, which meant the inner
copy came back as the *whole glyph* and `difference(outer, glyph)` erased the band
entirely. That fallback is right for the treatments that grow things and wrong for
anything that subtracts, so `growStrict()` was added alongside it rather than `grow()`
being changed.

With honest emptiness restored, the remaining case is a stroke genuinely too thin to hold
a band. Those regions are recovered with a morphological opening and kept solid.
Neutraface puts no inline in a hairline either; the letter staying whole is the honest
failure, and it is better than a hole.

## Ten more treatments, and a picker that groups

Halftone, stipple, hatch, scanline, pixel, soak, melt, ghost, onion and shatter — built as
prototypes, judged on a contact sheet, then all ten kept. Seventeen names in one `<select>`
is a wall, so `Treatment.family` groups them: Wear, Ink, Screens, Press, Structure. The
families are true rather than tidy — the ones sharing a family compete with each other more
than with anything else on the list, which is exactly what somebody scanning the picker
needs to know.

The unlock that made most of them possible is **tone out of geometry** (`src/engine/tone.ts`).
Halftone, dither, stipple and engraving all size their marks by how dark the source is, and a
filled letter has no darkness to read. Depth into the stroke — successive Clipper insets — is
a luminance signal the shape already carries, so the whole screening family arrives without a
rasteriser anywhere near the pipeline. The earlier research note called that direction crowded
and raster-native; it is neither, once the tone comes from the outline.

`ctx.penX` finally has users: halftone, scanline and pixel all phase their grids on the pen
rather than the glyph box, so a screen runs unbroken across a word instead of restarting under
every letter.

`registry.test.ts` holds what every treatment owes the tool — unique id, a family, two to four
front-of-house dials, presets carrying every key, ink left on a stem and a counter and a
period, and a `growth()` that does not under-promise. A new treatment gets all of it the
moment it is registered.

## Dials the sound may not ride

The specimen sheet drives each step's primary dials from audio, which quietly assumes a dial
moves *within* a picture. Some dials instead choose *which* picture: Outline's style, Ghost's
style, Pixel's dither and gap. Driven, those do not animate — they alternate, and the word
strobes between two unrelated states on the beat.

Hence `ParamSpec.steady`: front-of-house, but the sound skips it. The dial stays where the
hand put it, which is what a mode switch wants anyway.

Finding this took measuring the right thing. The first guard counted contours, and Pixel
failed it at fifteenfold — but the letter was never in trouble: a grid legitimately fuses and
unfuses as it rescales, so its contour count swings wildly while the ink on the page holds
between 92% and 111%. **Mass is what the eye tracks**, so that is what `motion.test.ts`
asserts: every treatment keeps a letter on the page at every drive level, and changes weight
smoothly between frames. Cost is guarded separately, in points added rather than multiplied —
going from 14 points to 340 is free, and going from 3000 to 6000 is the hitch.

## The workbench is a bar, a plate, layers and dials

The page used to open on a brand line and a headline, then stack a specimen, an export strip
and a rail of tabs. That is a marketing page wearing a tool's clothes. What shipped instead:

**The top left is where you name the font.** Naming the thing is the first act of making one,
so the name is the page title — a field that looks like a title until you hover it — with what
it is set underneath. The brand line is gone from the workbench entirely; it belongs to an
intro page that is not this one.

**Three ways out, all in the bar.** `Save font`, `Share`, `Download .ttf`. The long line
describing what is in the file moved onto the download as a hover tooltip, dark on paper. It
answers a question you ask once, immediately before pressing, and never again — as a permanent
line under the button it was furniture.

**What acts on the letters lives in the box with them.** Randomise and Reset sit in the plate's
footer with the cuts-and-seed readout, because they act on what you can see. In the rail they
sat among the panel's own controls and read as settings.

**The stack became Layers, and layers are cards.** A stack is a list of things, not a set of
modes, so tabs were the wrong shape. Each card carries the treated letter as its thumbnail —
a real preview of what that step alone does, which most tools in this category would have to
fake — and its own headline dial, the tweak people reach for most. Cards are hidden from the
per-glyph scope, where a global dial would answer a different question than the panel below.

**The last layer cannot be removed, so its control changes.** With one layer the × becomes
`Clear`, which puts the dials back. Procreate's answer, and better than the two alternatives:
hiding the control makes the row twitch as you add a second layer, and leaving a dead × sitting
there is the mistake Figma makes in variant properties.

**No disclosures.** Every dial the treatment has is on the page. Eight sliders in a column is
not a wall, and hiding half of them behind "More" only teaches people the tool has parts it
would rather they left alone. `How this works` went with them; `Treatment.story` still exists
and is still worth having, it just is not a permanent accordion in the rail.

**The value is an input.** Framer, Figma, Rive, Jitter and Blender all make it one, and a
slider cannot hit 1337 on a 1–9999 range without a fight. Minus and plus flank it for the
single-step nudge dragging is bad at. The caption under a dial is now dark, because it is a
tooltip and was being read as body copy.

**The size ladder lost its gutter.** The number sits above each line at the type's own left
edge. Measured across eight foundries, not one puts a size in a left gutter: Fontshare and
Google Fonts put it above the line, Klim runs it inline as a superior figure, Grilli and OH no
print no size at all. A gutter reads as a column and pushed the one block on the page made
entirely of the thing being sold off the grid everything above it sits on. The ladder also
moved inside the main column, so the dials stay on screen while you look at 12px.

The research behind all of this is in `RESEARCH-2026-09.md`, and the explorations it came from
are one page in the Figma file named in `STATE.md`.

## A preset is a picture, and the default is one of them

Two problems that turned out to be the same problem.

**A selected chip and the download button were the same object** — a solid ink rectangle — so
the loudest thing on the page was a preset rather than the thing the tool is for. Six
alternatives were drawn: underlined, segmented, a radio dot, and pictures. Pictures won,
because a button is a word and a preset is a picture with a word under it, and those can never
be mistaken for one another. It is also the answer only this tool can give: the thumbnail is
the letters actually treated at that preset, which every competitor would have to fake. The
selected one thickens its border rather than inverting, and loses a pixel of padding so the
row does not jump as the selection moves. Cost is one render of two glyphs per preset, keyed
on the font and the treatment, so turning a dial does not redraw the row under the pointer.

**There is no unnamed state.** Picking a treatment lands on a named preset — `defaultPreset`
names which, otherwise the first — so one chip is always lit and the row always means
something. This dissolved a finding rather than fixing it: thirteen of the seventeen first
presets duplicated the treatment default exactly, which was redundancy only while the default
was a separate nameless thing. Grit is the one that needed a real decision and now opens on
**Sandblast**: Photocopy is a light speckle that undersells what the treatment does. Bubble,
Bleed and Organic land on their first preset.

Two functions, deliberately not one. `defaults()` is each dial's own default — the baseline a
preset is a delta from, and what the engine, the CLI and the tests use. `initialParams()` is
what the workbench opens on. Keeping them separate means the headless build and the recorded
verification numbers do not move.

**The consequence worth knowing:** a dial's tick, its muted-versus-marked colour and its
double-click reset all measure from the landing preset, not from the spec default. Measured
from the spec default they would paint every dial as changed the moment the tool opens, which
is every time, and the signal would mean nothing.

## Where to look next

Highest value first, folding in `RESEARCH-2026-09.md` (Font Gauntlet, the field, the
specimen stage). Sizes are rough. Nothing below is started; a layout pass in a design file
comes first for anything that touches the sheet rail or the export controls.

1. **Per-dial sound binding, with range handles.** Today the sheet drives the first four
   non-steady primary dials in declared order, and the user has no say. Font Gauntlet and
   OpenMosh both let each control choose what it listens to and how far it may swing.
   Medium: a `listens` field on the sheet state, `modulate()` in `Poster.tsx` reads it, a
   per-dial control in the Sound block.
2. **Present mode on the sheet.** Hide the rail, keep the Escape-finishes-and-saves rule
   from "The sheet is a performance". Small, and a better recording stage.
3. **A Finish layer on the sheet** — pixels, not geometry: grain, riso misregistration,
   scanline drift first. WebGL over the canvas the recorder already draws; Paper Shaders
   (Apache-2.0) lifted with attribution; PNG and clip pass through it, SVG and the font do
   not. Large. It is the first raster in the product, so it carries a rule and a test:
   **the `.ttf` is byte-identical with any finish on or off.**
4. **Freeze this frame as a font.** The sheet holds the resolved dial values for every
   frame it draws, so a frame you like can go straight to `buildTreatedFont` in the worker.
   Nobody else can offer this. Small to medium.
5. **Amount master slider** lerping source → preset, and **hover a preset to preview it**
   on the main canvas. Carried over; both nearly free because the engine is client-side and
   deterministic.
6. **Styles view**: every preset of the current treatment as a waterfall in the page — what
   `scripts/style-samples.ts` does on the CLI. Small.
7. **WebCodecs recorder** with `MediaRecorder` as the Safari fallback, the 15 s cap lifted,
   MP4 with the audio muxed. Medium; `src/lib/videoRecorder.ts`.
8. **Story-size sheet** (1080×1920) as a second format; `SHEET_W/H` become a property of
   the layout in `poster.ts`. Small.
9. **Whole-window drop target** for a font, and a visible **Copy link** for the URL state.
   Small.
10. **Slant and Tracking** as export-safe global dials — a shear on the outlines, a uniform
    advance change — with `verify:font` taught to accept the drift. Medium. Parked until
    the layout pass says whether they belong in the rail.
11. **Slider craft, what is left**: drag on the label to scrub, `Shift` for fine, and tint the
    label when a value is off its default (Webflow's trick, better than our tick on the track).
    The typeable value, the steppers and the dark caption shipped with the layout pass.
12. **Tune the seventeen against each other** on the contact sheet.

Shipped from the earlier lists: the licence panel at font upload, and — with the layout pass —
the action bar, layers as cards, every dial visible, and the size ladder's gutter.

A later look at typograph.studio (AI parametric typeface generator, adjacent not
competing) confirmed the positioning: nothing in the niche outputs specimen sheets or
audio-reactive video, and its signup wall is the anti-pattern this tool's no-login,
URL-as-state instant play is the counter to. Nothing else there worth borrowing.
