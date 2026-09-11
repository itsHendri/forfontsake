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

**The movement is centred on what you set, not stacked on top of it.** The drive was a level
between 0 and 1 and it could only ever be added, so the dial values you chose were the quietest
the sheet ever got: everything you actually looked at was heavier than the font you had made,
and the louder the track the further it drifted. Two followers per band fix it — a fast one for
the motion and a slow one for how loud this material has lately been — with the dials driven on
the difference. A steady passage settles back to your font, a transient pushes above it and the
dip after pulls below. It is also self-levelling, so a quiet recording and a loud one move the
letters about the same, where an absolute level left one inert and pinned the other at the top
of every dial. Depth came down from 35% of a dial's span to 15%, which is more motion than it
sounds now that it runs both ways.

The reason this matters is what the sheet is for. It is a way of looking at the font you made —
a preview with something to say — not a second surface to design on. Letters that reshape
themselves on every beat are a different typeface every second, which is a worse advertisement
for yours than letters that breathe.

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

### Present mode, and Escape leaving one thing at a time

The rail goes, the sheet takes the window, and the ground darkens. It changes nothing about
what comes out — the recorder draws the sheet at its own 1080×1350 either way — so this is for
looking at, and for pointing a camera at.

Two rules make it safe to be in. A stray click on the backdrop already could not close the
sheet while sound or a recording was live; presenting joins that list, because it is a
performance too. And **Escape leaves one thing at a time**: from a performance it returns the
rail rather than throwing away the sheet and whatever was playing, and a second press closes
as it always did. There is a visible way back as well, since the rail's own Close is hidden —
a mode you can only leave by guessing at a key is a trap.

The recording control follows into the bar when a take is running. The rail is hidden, so a
countdown with no way to stop it would be the same trap in a different shape.

The caption there is set in `paper`, not `muted`: the ground in this one mode is ink, and
`muted` on it measures about 2.5:1.

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

**Which preset a screen opens on, measured rather than eyeballed.** Halftone and Hatch both
opened on their faintest setting. Ink coverage — treated area over untreated area, on
"Handgloves" — puts the Screens family at a median of 0.55 where every other family is 0.97 or
more, and eight of the ten lightest presets in the tool are screens. That much is by design: a
halftone of a solid letter *is* partial coverage, and at 96px Classic 45° looks exactly like
what it is. The defect was narrower. Classic 45° leaves 0.27 and Single pass 0.30, so the
first thing anybody saw of either treatment was its weakest version, and both are flat grey by
16px. They moved to **Coarse dots** (0.64) and **Cross-hatched** (1.22), which hold their
texture down the size ladder and are still unmistakably a dot screen and a crossed hatch. The
ratios hold on all seven shipped faces, so this is not a Pirata-One-shaped choice.

**Halftone went back to Classic 45° when it became the landing treatment, and that is a
different question.** The measurement above is still true — 0.27 coverage, the faintest chip in
its own row, flat grey by 16px — but it was answered when Halftone was one style among
thirteen, where the job of the landing preset is to show what the treatment can do. As the
first thing anybody sees of the whole tool, the job changes: Classic 45° is the picture people
already have of a halftone, and a coarse dot screen is not. Hendri called it. The cost is
paid in two visible places, and they are worth knowing rather than discovering — the preset
chip is the palest in the row, and the finer grid costs about 3,100 points on "Wedge" against
Coarse dots' 1,250, which is over the contact sheet's 2,200 flag though well inside the 4,000
preset budget.

Below about 32px every screen collapses to flat grey whatever the preset — a halftone dot at
12px is smaller than a pixel. That is physics, not a bug, and the size ladder is right to show
it.

Two functions, deliberately not one. `defaults()` is each dial's own default — the baseline a
preset is a delta from, and what the engine, the CLI and the tests use. `initialParams()` is
what the workbench opens on. Keeping them separate means the headless build and the recorded
verification numbers do not move.

**The consequence worth knowing:** a dial's tick, its muted-versus-marked colour and its
double-click reset all measure from the landing preset, not from the spec default. Measured
from the spec default they would paint every dial as changed the moment the tool opens, which
is every time, and the signal would mean nothing.

## What the sound moves is a choice, not an accident

The sheet drove each step's first four primary dials in declared order — bass, mids, highs,
level — with no say in it. On half the treatments that puts the kick on the wrong dial: Grit's
declared order leads with Amount, which is the one you most want steady while everything else
breathes, and a stack of three gave every layer's leading dial the same bass with no way to
stagger them.

Each drivable dial now names the band it rides, or none. Two things kept it small:

**Only the overrides are stored.** The default is derived — the first four drivable dials of a
step take the four bands in order — so opening the sheet behaves exactly as it did before, and
the map cannot go stale when a layer is added, removed or retreated. A binding is a `Record`
keyed by step position and dial, and a key that is absent means "whatever the default is",
which is a different state from a key set to `null`, meaning "explicitly nothing".

**Depth is one control, not one per dial.** Font Gauntlet gives every axis its own range
handles. With up to three layers of four dials that is twelve pairs of handles in a 260px rail,
so the swing is a single Depth slider (default 35%, the value that was hard-coded) and the band
is per dial. If per-dial range is ever wanted, the binding map is where it goes.

`modulate()` moved out of `Poster.tsx` into `src/lib/modulate.ts`, because `motion.test.ts`
carried a hand-written copy of it under a comment reading "this mirrors modulate() in
Poster.tsx — if that changes, change this". The test now calls the real function, which is the
only version of that arrangement that cannot drift.

## The finish layer, and the one raster in the product

Everything else here is outlines. A finish is the exception: a pass over the *rendered sheet*,
the way ink and paper and a scanner are passes over a printed page. So it carries a rule, and
`finish.test.ts` holds it structurally rather than behaviourally — **nothing on the path from a
chain to a font file may know finishes exist**. A behavioural test would only prove it for the
three finishes that exist today.

**The sheet is a canvas now.** One WebGL2 program, four textures, a full-screen quad. Three
things moved into it and two of them got simpler:

- **The cross-fade is a uniform.** It used to be a second copy of the whole sheet in the DOM
  under a CSS animation. Two textures and a `mix` do the same job, and the recorder gets it
  for free instead of reimplementing it.
- **The recorder captures the canvas.** It used to keep its own canvas, decode each new sheet
  from an SVG data URI, and hand-roll the fade with out-of-order arrival guards. All of that
  is gone: `canvas.captureStream()` on the canvas the screen is already showing, which also
  makes it impossible for the video and the screen to disagree.
- **Dragging is still free, and that took work.** `buildPosterLayers` cuts the sheet into a
  ground and a word, each the size of the sheet, with the word's *placement offset removed* —
  the offset becomes the uniform. A rebuild re-runs the whole treatment chain, so the old code
  mutated the live SVG group's transform to avoid one; the new code changes a float. Scale
  stays baked, because resizing is already debounced and can afford the rebuild.

**Hit-testing without a DOM.** A canvas has no `[data-part="word"]` to point at, so the sheet
reports the rectangle it drew the word in and the pointer is tested against it. A test pins
that box to the transform beside it, because a box that drifts means dragging quietly starts
missing.

**The PNG is the same pipeline, one throwaway view wider.** Two ways of applying a finish
would be two finishes. The SVG download is unchanged and still letterforms only — it says so
when a finish is on, rather than handing over a sheet that does not match the screen.

Two things cost real time and are worth knowing:

**A StrictMode double mount left a dead canvas.** Creation was on a ref callback and teardown
in an unmount effect; under StrictMode's mount-unmount-mount the effect's cleanup lost the GL
context while the first canvas was still in the holder, so everything rendered onto a dead one
and came out blank with `getError()` reporting `CONTEXT_LOST_WEBGL`. Both now live on the ref,
which is the only arrangement where a holder can hold something dead for zero frames.

**Bloom keyed off brightness washes the sheet**, because paper is the brightest thing on it.
A scanner's bloom is light leaking *into* the ink, so it keys off darkness instead.

## The sheet is a room, and it asks one question at the top

The problem is recorded below as it stood; this is what was done about it.

**Share replaces the workbench rather than opening over it.** Same URL, same state, its own
bar, and a close × top right — the room reads as something you leave rather than somewhere you
navigated to, which is why it is a × and not a back link. Measured at a 1440 × 1000 window the
sheet now draws at **852 px**, against 702 px in the modal and 846 px in Present mode. Present
itself is gone: it named a mode nobody could picture, and with the rail this quiet the sheet
already has the window.

**The format is a property of the sheet, never of the export.** Post 4:5, Square and Story
9:16 live in the header beside the ×, and `SHEET_W`/`SHEET_H` became `FORMATS` in `poster.ts`
with the old constants kept as the default so every older caller still means the same sheet.
Every tool in this category splits it the same way — Canva, Adobe Express, Kapwing and Jitter
choose the size on the canvas and keep the download to type and scale — and not one export
screen in the whole research pass carried a ratio control.

**Static or Video is the one question at the top, and the dependency runs one way.** Sound is
what makes a moving export possible; choosing MP4 never turns sound on. In static there is no
sound in the room at all — absent, not greyed — so the question cannot arise. It is a mode
rather than a consequence of the sound being on because the clip is the capability nobody else
in this niche has, and a mode nobody can see is a mode nobody uses.

**Either sheet can be a video; what varies is how fast.** The character set was barred outright
on the grounds that 69 glyphs a frame is beyond the engine. Measured rather than assumed, it is
13–15× a word — a lot, and still not a wall. Median rebuild on Pirata One, in node:

| chain | word | character set | character sets per second |
| --- | --- | --- | --- |
| Halftone | 4 ms | 52 ms | 19 |
| Organic | 3 ms | 40 ms | 25 |
| Bubble | 10 ms | 140 ms | 7 |
| Grit | 42 ms | 617 ms | 1.6 |
| Grit + Bubble | 146 ms | 1725 ms | 0.6 |

A browser is slower than node, and the settled figures on the live site are what a person
actually gets: **Grit on the character set reads about 0.7 rebuilds a second, Halftone is fast
enough to draw no warning at all.** So the limit is the chain's cost, not the layout, and the
two are barely related — Grit is fourteen times slower than Organic on the same sheet. A ban keyed on the layout was therefore
forbidding Halftone at 19 fps while allowing a stack at 0.6. **The picker no longer refuses
anything.** The rebuild rate was already adaptive (the tick backs off to the measured cost), so
the rail simply says what that measurement is: under about six a second it warns that the
letters will step between shapes rather than morph through them, and names the remedy — a
lighter chain, or one layer fewer. That reading is honest for the word sheet too, which is why
it is not a character-set message.

**The measurement takes more than one sample.** The first build of a sheet is not
representative — cold paths, nothing warm — and on the character set it came in around sixteen
times the settled cost, which briefly shipped a reading of one frame every ten seconds for a
chain that actually manages 0.7 a second. The rail now reads the median of the last few
rebuilds and says nothing at all until it has three, because a single cold sample is not an
opinion worth publishing.

The unfixed part is worth naming: a rebuild is synchronous on the main thread, so a 1.7-second
chain janks the page rather than merely running slowly. Moving poster geometry into a worker is
the real fix and has not been done.

**The layout is chosen as two pictures**, drawn by the engine at the current format, because it
is the one choice here whose difference is entirely visual — the same argument the workbench
presets won on, and the one no competitor can answer. They are memoised on everything except
the dials, so it is two renders per visit rather than two per frame.

**Export is one type and one button.** Copy SVG and Copy link went with it: a second row of
verbs beside a download is furniture, and the type select already says what they said. **Record
clip stopped being a button** — in video the export *is* the take, which is what fixed it
feeling hidden. While a take runs the mode switch is the only disabled control, because turning
a dial mid-take is the point of recording a performance; and the older rule holds that nothing
about leaving may cost a take, so the × finishes and saves.

**What the sound moves became three named modes** — Pulse, Breathe, Shimmer — plus Depth. The
per-dial band table went from the front of house. Consumer tools ship named mappings and one
intensity control; the matrix is a prosumer feature that even OpenMosh and Neural Frames put an
automatic mode in front of, and the closest peer, Dinamo's Font Gauntlet, maps one signal to one
axis and stops. The map underneath is unchanged: a mode is a function that fills in the same
`Bindings` record, rebuilt from the chain rather than stored so it cannot go stale when a layer
is added or removed.

## The sheet outgrew its modal

The problem as it stood before the section above resolved it.

The specimen sheet opens as an overlay over the workbench, two columns capped at 900 px. That
was right when it was a sheet and four buttons. It now carries a Finish picker with three
dials, a Sound block, a per-dial binding table and five ways out, and the sheet gets whatever
column is left: about **702 px for a 1080 × 1350 artefact**, roughly half its real size, while
the rail measures 893 px and exactly fills its container at a 1000 px window. Fitting, not
scrolling — so on a shorter screen the bottom clips and the downloads are what gets cut.

Present mode is the cheap version of the answer and it works: rail hidden, sheet to 94vh, 846
px. That it is so much better with the chrome gone is the argument that the chrome is in the
wrong place, not that it should be hideable.

The measurements, the constraints and the things that must survive a redesign — the Escape
rules, the sheet being a canvas, nothing about it being in the URL — are written up in
`STATE.md` under "The sheet wants to stop being a modal", which is where the session that
takes this on should start.

## Say each thing once: the rail after the second look

A session's use of the layout pass turned up four things that were said twice or said
unasked, all in the rail and the plate. Fixed together, September 2026.

**The layer card lost its dial.** It carried the layer's headline dial as a shortcut, and the
same dial sat first in the settings group directly beneath it — Bubble showed Weight twice
within 60 px. A shortcut to something already in view is not a shortcut. The card is the
thumbnail, the name and the remove control now; the dials are the group under it.

**The blurb and the stack note went.** "Fattened and rounded, the way a marker nib turns a
corner" described what the letters beside it already showed, and "Applied top to bottom — each
one works on what the last one left" explained an order the cards' own order shows. The blurb
survives as the option's hover title; the note is gone.

**Help lives behind an (i), and never moves.** The caption under a dial only ever showed on
hover, but hover is where your pointer is while dragging, and the caption grew a "double-click
the track to reset" clause the moment the value left the preset — so the text changed under the
hand mid-drag and read as a glitch. Now each dial has a small (i) beside its label; hover or
focus it and the tip says the note and the reset value, and says the same thing every time
because it depends on the spec and the landing value, not on the value in hand. NN/g's rule
holds: the tip is nice-to-know, never an instruction the dial needs. The value stays visible
while dragging, which is the help that matters then.

**Simplify is one dial, and it is called Detail.** Every treatment carries `simplify`
with the same meaning, so a stack of three offered it three times. The rail now shows it once,
in an Output group, and the dial writes the same value into every layer. Nothing about the
state moved: `simplify` stays a parameter of each step in the URL, on the shelf and in the CLI
(`STACK_WIDE_KEYS` in `types.ts` names the set). A preset chip judges itself on every dial
*except* those — `presetMatches` — because otherwise every Detail change un-lit whatever preset
the layer was sitting on while its picture still described the letters. Keep counters stays
per layer: it appears on three treatments under different keys with different mechanics, and
Soak's second one — `squeeze`, a press on the holes — was relabelled **Press** so that no two
dials in a Bubble + Soak stack wear the same name.

## Styles were growing where dials should have been

Seventeen treatments, and a mood board of 112 pins said several of them were the same
picture. Reading the code rather than the specimens settled it: **Pixel and a proposed
noise-dissolve treatment are the same loop** — a grid of square cells, each kept when a
measure of the letter under it beats a threshold, then unioned — differing only in what
does the measuring. **Extrude and a proposed smear are the same loop** too: copies of the
glyph shifted along an angle and unioned, one of them also shrinking each copy as it goes.

The pattern under all of it is that the tool had been growing *styles* where it should have
been growing *dials*, which is why the picker managed to feel cluttered and narrow at the
same time. Four merges, chosen because each pair really is one operation:

| Was | Is now | The dial that was the difference |
| --- | --- | --- |
| Soak | Bubble | Rounding, pushed past the point where corners go — two presets |
| Outline | Onion | **Style**: outside, centred, inside |
| Beads | Onion | **Beaded**: break each ring into discs |
| Stipple | Halftone | **Scatter**: the rotated grid loosened until nothing lines up |

Onion is now the one style that carries every ring a letter can hold — hollow, hairline,
inline, beaded — because where the band sits relative to the edge was the only thing
separating them. Halftone is the one style that carries every dot: a print screen and
dotwork are the same marks from a different sampler, so Scatter is a dial and Overspray
came across with it.

Two things this cost, both worth paying. **Halftone is no longer deterministic**, because
Scatter and Overspray draw on the seeded stream; at zero they take nothing and a reroll
changes nothing, which is exactly where Grit already was at amount 0. And **complexity moved
out of the picker and into the dial panel** — Halftone now carries ten dials, Onion eight.
The panel shows every dial since the layout pass removed the accordion, which was right for
a five-dial style and will not hold much past this. Halftone's dials group cleanly (Grid,
Mark, Tone, Body) and that grouping is the next layout question.

**Treatment ids are permanent, and merging one away is the one change that breaks them
silently** — the link still parses, it just names something that is no longer there. So
`soak`, `outline` and `stipple` are translated rather than dropped, in `retired.ts`, in one
place that the URL reader and the shelf both go through. The dials are converted with the
id, because the numbers meant different things in the treatment that has gone: Soak's Melt
was a share of a third of the stem where Bubble's Rounding is the share itself, and
Outline's Style counted outward where Onion's counts in, so its three modes swap ends. A
per-glyph override at a migrated step is dropped rather than guessed at — it named dials
that no longer exist — while the glyph keeps its reroll and every other step's deltas. An
old link opens on what it described and then rewrites itself into the new form.

The scale bug worth remembering: beads are walked along offset paths, which are
working-scale, while every dial is in font units. Placing discs with a font-unit radius put
them on the page a hundredth of their size, and the motion suite caught it — a frame with
four thousandths of a percent of its ink left.

## The tone field, and the two screens it unlocked

Half the reference board is one idea the engine could not draw: marks that carry *past* the
letter and thin away, so a word reads as blurred, sprayed or evaporating rather than printed.
Every screen here reads tone as depth into the stroke, which makes the outline a wall — marks
stop dead at it.

The plan called for an outset band field to match the inset ones. Building it showed that was
more machinery than the problem needed: `distanceToEdge` already returns a smooth, continuous
value outside the glyph, and Stipple had been using it for overspray all along. What was
actually missing was smaller and sharper.

**Two functions in `tone.ts`, used by both screens.** `outsideTone` is the far side of the
existing field — 1 against the outline, 0 at the end of the reach. `fadeRamp` is a ramp along
a direction, measured once per glyph and asked for at every mark, so a word can thin toward
one end instead of evenly. Almost every grain and haze on the board has a *way* about it,
rising off the top or drifting to one side, and distance alone cannot say that.

**Grain is the dial between two kinds of haze**, and it is the one that made a separate soft
halftone unnecessary. Past the edge each mark either survives an exponential coin toss
weighted by how far out it sits — spray paint, which is what Stipple always did — or it stays
and simply shrinks, which is a letter out of focus. One dial runs between them, and it is a
power on the same probability rather than a branch, so there is no seam in the middle.

**Pixel needed no core dial, and that is the whole argument for the merge.** A noise-dissolve
treatment had to be told where the letter's core was, because its measure was soft everywhere.
Pixel measures coverage, and a cell the letter fills completely beats any threshold below 1 —
so wobbling the threshold with noise takes the edge cells first and leaves the core standing,
with nothing protecting it. The letter dissolves from the outside in because of what the
measurement already was.

**A latent bug the growth test caught.** Giving Pixel a `growth()` for the first time — it
needed one for Spread — made the registry's growth check apply to it, and it failed
immediately at defaults. A cell the edge runs through is drawn whole, so the grid has always
reached half a cell past the letter and never said so. Every Pixel font shipped with advances
that much too narrow. Now declared, which widens them slightly and is a fix, not a regression:
"Advances widen everywhere, or the caret lies".

**Melt is cut, and a cut cannot be translated.** It sagged the letter off its baseline and
drew drips by hiding narrowed copies inside the body; nothing else in the registry sags, so
mapping its links anywhere would open them on a picture their author never chose. A step
naming a cut treatment is dropped and the rest of the stack opens without it; if that empties
the stack there is no state left to restore and the workbench opens fresh. Per-glyph deltas
follow their step to its new index, which is the part that is easy to get wrong once a step in
the middle disappears.

## One corridor, three pictures — and the one thing that was actually new

Extrude swept the letter along a direction and unioned the copies. A proposed smear did the
same and shrank each copy as it went. A proposed rebuild of Ghost offset the letter once and
screened the gap. Three treatments, one loop, and the differences were a multiplier and an
intersect — so they are two dials now.

**Taper** thins each copy on an eased curve, so the corridor holds its weight and then lets
go rather than narrowing evenly; when a copy collapses the trail simply ends, which is what a
drag running out of ink does anyway. **Screen** takes the shadow down to a grey, with dots or
with lines running along the throw — and lines along the throw is why a smear's streaks and a
misprint's lined echo are the same dial rather than two.

**The screened shadow needed a fourth layer, and it corrects an old assumption.** Extrude drew
its face hollow because a solid face merged with a solid shadow "just reads as a slightly
bolder letter, which is no shadow at all". True — while the shadow is solid. Screened down to
a grey it stops being true, and a solid letter over a grey shade is exactly what a plate
printing twice looks like. Layer 3 is that, and it is the one the ghost and smear presets use.

**Ghost is retired into it, and the translation stays faithful rather than flattering.** Its
drift becomes depth, its mode picks the layer, and its angle carries over except where it was
0, which Ghost read as "let it wander" and Extrude reads as "throw it right". The screen is
left *off*: a link asked for the hard fringe it was written against, and the grey rebuild is
one dial away rather than something done to it on the way in.

**Fur is the only candidate that survived as itself.** Every other one was an existing
operation with a term changed. This emits geometry *from* the letter, along the outward normal
of the outline, and nothing else here can be dialled into doing that. It is also the cheapest
thing on the list to draw: a hair is a triangle, three points, so a letter can wear two
hundred of them and still be a font.

Which way is out is never computed and never asked for. After the outlines are unioned the
outer contours wind one way and the counters the other, so taking the normal to the right of
the tangent grows hair off the outside of a stem and *into* the hole of an `o` with no test
for which is which — the same rule, and the counter stays open because the hairs line it
rather than fill it. Winding was already load-bearing here (`ringsToContours` reverses every
ring on the way into a font, because TrueType fills opposite to PostScript); this is the
second place it does real work.

## Thirteen dials get headings, not a lid

Consolidation moved the complexity out of the picker and into the dial panel, exactly as
predicted. Halftone came out of it carrying thirteen dials, Pixel and Extrude eight, Onion
seven — and the layout pass had already removed the more-dials accordion on the grounds that
"eight sliders in a column is not a wall, and hiding half of them behind More only teaches
people that the tool has parts it would rather they left alone".

That reasoning still holds, so the wall gets headings rather than a lid. Every dial is still on
the page; the long ones break into named runs with a hairline between them. Halftone reads
**Grid** (screen, scatter, angle), **Mark** (dot size, fuse, shape), **Tone** (overspray, fade,
fade direction, grain, falloff), **Body** (keep the letter, invert). Pixel: Grid, Threshold,
Past the edge. Extrude: Throw, Screen, Face. Onion: Rings, Line.

**Only four treatments are grouped**, and the test for which is the one the families already
pass: true rather than tidy. Grit has seven dials and they are all damage in one way or
another; splitting them would be arranging, not explaining. A run of one is the tell that a
grouping was invented rather than found, so that is an invariant rather than a note — along
with all-or-nothing, since a half-grouped treatment leaves orphans under whichever heading
happens to precede them.

**The headings pay for themselves in the labels.** Under a heading called Screen, "Screen
shape" and "Screen pitch" stutter; they are Shape and Pitch now. Same for Onion's Line weight
under Line. The group carries the noun, so the dial does not have to.

**The reorder that nearly went wrong.** Grouping is rendered from the parameter list, so the
groups have to be contiguous in it or the panel shows the same heading twice. Reordering that
list is not cosmetic: `modulate` drives *the first four primary non-steady dials in declared
order*, so rearranging it silently changes what the sheet's sound rides. It happens that all
four treatments came out driving exactly what they drove before — but only by luck, and nothing
would have said otherwise. The four are written down in a test now. Changing them is fine;
changing them by accident is what that stops.

## The word says what it is

The tool opened on "Grittier letters" long after Grit stopped being the treatment it opened
on — a pun left behind by a default that moved. Rather than pick another fixed word, the word
follows the style: choose Bubble and the page reads *Bubble letters*, choose Extrude and it
reads *Extruded letters*. The first thing on the page now names what is being shown.

**Most treatments do not need to be told what to say.** `specimenFor()` is the name and a
noun, and only four treatments override it — Grit, Extrude, Hatch and Shatter, whose names are
verbs, so the plain form reads as an instruction rather than a description. "Bleed letters"
is a picture; "Extrude letters" is a command. A test rejects an override that merely restates
the default form, because a line that changes nothing is a line that looks like it does.

**Whether the word is still ours is asked, not tracked.** The obvious build is a flag — *the
reader typed this one* — and it is wrong here, because the text lives in the URL and on the
shelf, and a flag survives neither a reload nor a shared link. So App holds the set of words
it would have written and asks whether this is one of them. The single cost is that typing
"Bubble letters" by hand hands the word back to the tool, which is invisible until you switch
style, and then reads as the feature working rather than as a bug.

**An emptied field stays empty.** Refilling it as somebody deletes their way back to a blank
would fight them; the specimen falls back to the style's word for the render alone, which is
what it already did.

**The rule lives in one place, and the type says so.** Adding a layer, removing one, swapping
a treatment and dragging Simplify all change the stack, so each would have needed the same
line. `patchChain` is the single edit point instead, and it decides the word from the chain
that is landing rather than the one before it — the two are different, and doing it in an
effect afterwards means a cascading render and a hash written twice. `patch` takes
`Partial<Omit<WorkbenchState, 'chain'>>` so the next stack-editing handler cannot quietly opt
out of the rule; the first version of this was a convention, and `patchStep` and `setSimplify`
were already ignoring it.

**One consequence to know about: specimen strings have joined ids and preset names as
vocabulary that lives in shared links.** Because the tool recognises its own word by comparing
against the set it would write today, renaming Grit's specimen means every link already
carrying "Grittier letters" is read as somebody's typed text from then on — the word freezes
instead of following the style. Nothing breaks and no link stops opening, so this does not earn
`retired.ts`-style machinery yet. The deeper fix, if it ever does, is not a flag but a
`text: string | null` in the state with `null` meaning "ours", resolved at the same decode
boundary where `migrateStep` already runs — then the distinction is carried by the type instead
of inferred from the string, and the historical set has an obvious home next to `MERGED`.

## Six presets that were already on the page

Seventy-two presets across thirteen treatments, and the honest question about any one of them
is not whether it looks good — they all do — but whether it says anything the one beside it
did not. `scripts/preset-audit.ts` is the tool for asking it: coverage, cost per glyph, and
the distance to the nearest sibling with every dial normalised by its own range.

**The distance number is half an answer and pretending otherwise would have cut the wrong
six.** Halftone's Classic 45° and Coarse dots sit 0.055 apart, which is nearer than most of
the pairs that were cut — and they are plainly different pictures, a fine screen against a
coarse one. Meanwhile Pixel's Bitmap and Hard threshold sit 0.058 apart and are the *same*
picture, one of them at ten times the point cost. Dials near each other can straddle a
threshold; dials far apart can land on the same image. So every flagged pair was looked at on
the contact sheet before anything was cut, and the numbers only decided which pairs to look at.

**What went, and why:**

| Cut | Because |
| --- | --- |
| Halftone · Dots alone | Sprayed stencil is the same fine scatter, and this was the most expensive preset in the tool at 1,660 points a glyph |
| Halftone · Soft focus | Evaporating is this preset with Fade turned up, and the fade is the more interesting picture |
| Pixel · Hard threshold | Indistinguishable from Bitmap at 10× the points — 2,492 against 231 |
| Extrude · Drop | Block already is a letter with a block shadow down and right |
| Onion · Hairline | 0.13 coverage, the faintest thing in the tool; Inline says the same with enough presence to see |
| Bubble · Blotted | The same swell as Balloon, and its name was Bleed's |

**Two names were used twice, and both clashes were between treatments that do not look
alike.** Bleed and Bubble both shipped "Blotted"; Bleed and Organic both shipped "Wet ink".
Preset names are how a look gets talked about — in the shelf, in a note, in these docs — and
none of those places carry the treatment beside the name. Bleed keeps both words, because a
blot and wet ink are literally what Bleed does; Bubble's Blotted was cut as a duplicate anyway,
and Organic's Wet ink is now **Tremor**, which is what this document had been calling it for
months. A test keeps names unique from here.

**Organic opens on Swell.** Its landing was Tremor, a wobble you have to be told is there —
coverage 1.00, which is to say the letter is exactly as heavy as it started. A landing preset
that shows nothing reads as a treatment that does nothing, and Organic is one of the good ones.
Swell is unmistakably the edge buckling and still reads as the word.

**Left alone deliberately.** Grit still opens on Sandblast at 1,044 points a glyph, the most
expensive landing in the tool: that was a considered call above and the cost is paid only by
people who pick Grit. Coral and Thorn sit 0.059 apart and both stay, because they are the top
of Organic's ladder and cutting one leaves it with three. Scanline's Fine and tapered is the
faintest survivor at 0.19, and it is the only preset showing what the taper does.

## The preset lists were in merge order, not in any order

Hendri's read, and it was right: after the consolidation the presets stopped making sense. Not
because any of them looks wrong — the pictures are sound and every dial on every treatment is
moved by at least one preset, which was the first thing measured and it came back clean. The
staleness is in the *lists*. Five of them are assembled from up to three former styles, in the
order the merges happened:

| Treatment | Its own | Absorbed | Absorbed |
| --- | --- | --- | --- |
| Halftone | Classic 45°, Coarse dots, Fine square screen, Punched out | *Stipple:* Sprayed stencil, Heavy overspray, Coarse dotwork | *Haze:* Evaporating, Fused blobs |
| Onion | Three rings, Tight engraving, Halo, Wide chrome | *Outline:* Hollow, Inline | *Beads:* String of beads |
| Extrude | Block, Long throw, Shade only | *Smear:* Dragged, Motion | *Ghost:* Grey ghost, Lined echo |
| Pixel | Bitmap, Heavy dither, Gridded tiles | *Static:* Photocopied twice, Dissolving, Rising smoke | |
| Bubble | Marker, Balloon, Softened | *Soak:* Soaked through | |

So Halftone went from a printer's screen to a spray can to a haze with no ladder between them,
and a reader arriving at the row had to already know the merge history for the order to mean
anything.

**The fix is presentation, not pictures.** Every one of the sixty-six settings survives
untouched; four lists are reordered so each runs as one progression. Halftone: regular grid at
three densities, the grid inverted, then the grid broken into scatter, then sprayed, then the
marks fusing, then fading out. Onion: one ring, then many, then beaded. Extrude: a solid throw,
longer, the face removed, the shade screened, the shade lined, dragged sideways, smeared.
Pixel already read as a ladder and was left alone.

**Two names were speaking a neighbour's language.** Bubble's "Soaked through" arrived from Soak
and is wetness vocabulary, which belongs to Bleed next door — Damp, Wet ink, Blotted. It is
**Fattened** now, which is what Bubble's own blurb says it does. Halftone's "Blob halftone"
named its own treatment inside its own list, the way a Grit preset called "Gritty grit" would;
it is **Fused blobs**, after the dial that makes it.

**Reordering a list moved a landing, and every test stayed green.** `landingPreset` falls
through to `presets[0]` when `defaultPreset` is not set, which is a fine convention until the
order is a design decision — putting Onion's ladder in order silently moved its landing onto
Hollow, the outline it had absorbed, rather than the three rings it is named after. Onion names
its landing explicitly now, and **all thirteen landings are pinned in a test table**. Ordering a
list is a presentation decision; which preset a treatment opens on is not, and the two should
not be able to change each other by accident.

**The audit grew a fourth measure while checking this**: which dials no preset moves. It found
nothing but Simplify and two fade directions, which is the answer being reported rather than a
wasted check — the merged looks are all demonstrated, so the problem really was the ordering.

## A button that reports success and shows nothing

Randomise moved the seed and nothing else (`patch({ seed })`), and a treatment
reads the seeded stream only where a dial asks it to. Halftone opens on Classic 45°,
whose Scatter and Overspray are both zero — and `halftone.ts` only draws on the rng
when one of those is above zero. So on first load the button was enabled, the readout
beneath it changed to a new seed, and the letters did not move. That is the first
thing a lot of people press.

`hasRandomness` was the wrong guard for it: `deterministic` is a property of the
*treatment*, but whether the stream is consumed is a property of the *values*. A
guard that read the values would have been the alternative fix, and it was not taken —
the honest conclusion is that a control which does one small thing on some settings
and nothing on others is not worth the row it sits in. The Seed dial in Randomness
says exactly what it does and is still there.

**Reset had the same shape of problem one level down.** It sat in the plate's footer
as a single control acting on whichever layer happened to be selected, so what it
would undo depended on something else on the page. It belongs to the layer, so it is
on the card, and the card names the preset it goes back to. It takes that layer's
per-glyph exceptions with it: leaving them means pressing Reset and still seeing
letters that disagree with the dials.

The lone layer's `Clear` was this button under another name, so the two merged.
The rule that replaced it is simpler than the one in "The workbench is a bar, a
plate, layers and dials": Reset always, `×` only while there is more than one layer.
No dead control, and no control that changes its name as the stack grows.

With both gone the plate's footer held only the cuts-and-seed readout, which repeated
the Randomness dials, so the strip went with them.

## Five dials that were sliders because everything is a number

Invert is on or off. Onion's Style is inside, centred or outside. Extrude's Layer is
one of four pictures. Each was an `<input type=range>` with a tick and a percentage,
and you had to drag one to discover its range was two stops long.

`ParamSpec` gains `kind` (`switch` | `segment`) and `options`. **The value stays a
number**, which is the whole design: presets, the URL, the CLI, `presetMatches` and
the sound's bindings see exactly what they saw before, and only the drawing changes.

These turn out to be almost exactly the dials already carrying `steady` — the ones
the sound may not ride because they pick *which* picture rather than move within one
(see "Dials the sound may not ride"). That is the same observation arriving from the
other end, and it is the strongest evidence the split is real rather than tidy.

Two tests hold the pair that can rot silently: a segment whose names do not line up
with the values it can take, and a preset landing on a value with no name.

## The sheet cuts to a new picture and dissolves into a new frame

The cross-fade is a shader uniform decayed by the sheet's one rAF loop, and it is what
makes a rebuild read as the letters morphing rather than jumping — every rebuild the
sound causes wants it. Picking Word or Character set is not that: it is a choice you
just made and are waiting to see, and a third of a second of the old sheet dissolving
through the new one reads as the tool being slow to agree. Changing the sheet size had
the same problem and worse, because the canvas is remounted at the new size and the
fade was against an empty texture.

`dissolveFor(prev, next)` in `poster.ts` is the rule, returned as the fade's starting
value so it is the same number the uniform takes. It is a pure function so the four
cases are tests rather than a condition buried in an effect.

**The wheel handler went at the same time.** It tested the event target against
`[data-part="word"]`, which lives inside the SVG string that becomes a GPU texture and
has not been in the DOM since the sheet became a canvas — so it could never fire. Dead
since that change, and invisible because the slider was doing the work.

## The way out belongs in the bar

Export sat at the foot of the sheet's rail, under Layout, Finish and Sound, held down
by a spacer — so on a short screen the control the room exists to reach was the first
thing cut. It is in the bar now beside the size and the close, which is where the
research pass found every tool in this category puts it, and where the workbench
already puts Download. Still one type and one button; what each type gives you rides
the button as a tooltip rather than standing under it as a line.

**And the notes went to their causes.** A refused microphone was reported at the far
end of the rail, inside Export, under a heading about something else. Sound problems
appear under the sound buttons; export problems take their own line in the bar.

## The font you install, and the font you serve

The tool made something you could install and nothing you could put on a site, which
is where most of these are going. Download offers TTF, WOFF2, WOFF, or a zip of all
three — one build either way, because the web formats are **containers over the same
bytes** and the tables inside them are the ones that already passed validation.

`FontFlux.export({ format: 'woff2' })` exists and would have been four lines. It was
measured rather than assumed, and it fails twice:

1. **It rewrites GSUB.** The library rebuilds layout tables from its own parsed model —
   which is exactly why `fontio` splices our own table into the finished binary (see
   "We write our own GSUB"). Round-tripping hands GSUB straight back to the code we
   went to the trouble of bypassing: our 3,170-byte table came back as a different
   3,164-byte one.
2. **Its WOFF2 is broken on real fonts.** Anton at three cuts came out rejected by
   ots-sanitize with "Failed to convert WOFF 2.0 font to SFNT", which is a browser
   refusing the font. Pirata One hides this the way it hid the GSUB problem for
   months, because almost nothing in it is a real feature — so testing on the landing
   font would have shipped it.

So `engine/webfont.ts` writes both containers over bytes that have already been
validated. WOFF is a directory plus zlib per table; WOFF2 is one Brotli stream over
every table end to end, with **no padding between them** — read off a file fontTools
produced rather than assumed, and pinned by a test. `glyf` and `loca` take the null
transform (version 3): repacking them would be a second place for the outlines to be
wrong, and they are already the ones that passed.

The compressors are arguments, not imports, because this is engine code — the CLI
uses `node:zlib`, the browser `CompressionStream('deflate')` and `brotli-wasm` behind
a dynamic import, so a megabyte of wasm reaches only the people who ask for a WOFF2.

Verified across all seven shipped faces: fourteen files, ots-sanitize clean on every
one, every table byte-identical to the TTF's under fontTools, and the alternate
rotation and ligatures still shaping after an unwrap. In the browser a built WOFF2 is
accepted by `FontFace.load()` and draws. WOFF2 lands at 19–28% of the TTF.

**Variable fonts are still not on the table, and it is not a UI question.** Every
master of a variable font has to share point count and order per glyph. This engine
regenerates topology on every dial move — halftone dot counts follow spacing, hatch
line counts follow pitch, Organic *inserts* points as the effect itself, and every
treatment ends in a Clipper boolean plus `simplify`. There is no axis to interpolate
along. No browser library writes `fvar`/`gvar` either. What could honestly be offered
instead is a **family export**: a zip of two or three named instances of one treatment
under one family name, so a stylesheet switches them with `font-weight`.

## The sheet is its layers, and that is what colour was missing

Recolour cycled six fixed palettes. That is the only shape the control could
take, because nothing on the sheet had a name for a colour to belong to — there
was no "the word" for an ink to be a property of. Stating the sheet as
**Background, Word, Caption, Finishes**, topmost first, gives every property an
owner, and picking a layer swaps the rail to it. Four colours on three layers
replace one roll of the dice.

Recolour stays: moving all four at once is the fast way to a *different* sheet,
where a swatch is the way to the sheet you meant. A roll clears what was set by
hand, because a roll is a whole sheet.

`PosterPalette` gained `caption`, defaulting to `ink` — which is what the rules
and the two long label lines always were, before the caption became a thing you
could select.

**The list is the workbench's list on purpose.** Two rooms read the same way,
which is the argument the tabbed rail won on last time.

One trap, caught by lint rather than by eye: the palette became a fresh object
literal, and the sheet request is memoised on it, so `buildPosterLayers` — the
whole treatment chain — ran on every render instead of when a colour moved.

## Finishes stack, in the order they actually apply

They were a radio row with a `None` in it, which asks which single pass a page
has been through. A page can be scanned badly, printed in two inks and still be
on toothy paper. The shader takes a flag and a dial set per finish instead of
one branch on an id, and `None` goes with the exclusivity that made it mean
something — a finish that is off dims rather than vanishing, so the rail still
shows what you are not using.

**The order is fixed and it is a fact, not a preference.** Scanner and riso
*resample* the sheet: they read it at a displaced point, so they have to run
while there is still a sheet to read — and running scanner first is what lets
riso misregister an already-slipped sheet rather than a clean one. Grain is
speckle over whatever came out, so it is last however many are on. Offering a
user-orderable stack would be offering a choice where there is one right answer.

**The uniforms are positional**, so `FINISHES`' order now feeds each finish its
own dials by index. Reordering that list would silently hand each finish
another's numbers, so the order is written down in a test.

Nobody in the field multi-selects *effects*, which was worth checking before
building a selection model for them: Figma, Photoshop, Photopea and Pixelmator
all gang effects by having both on. Multi-selecting *layers* to apply one effect
is the common thing, and this room has four layers, so it is not the problem.

## The ground is a layer, and it is drawn rather than shipped

Background was one flat colour, so it was a word for the paper. It now carries a
texture — flat, wash, screen, grid, tooth — and, if you bring one, a picture.

Every texture is a few SVG tags. An asset would be a download every visitor pays
for whether or not they ever open this room, and a texture that shipped as a PNG
would be stranded on the colour it was baked at. These take the palette, so
recolouring the ground recolours the texture with it. The picker calls the same
function that draws the sheet, so it cannot show something the sheet will not
produce.

**An uploaded picture is cut down to the sheet before it is kept.** The sheet
reaches the GPU as an SVG inside a data URI, so anything in it is re-encoded on
every rebuild — which is on the path a dial move takes. Redrawn once at 1080
wide, a 6 MB photo is a couple of hundred kilobytes. The paper still goes down
underneath: a transparent PNG and a picture that does not cover the sheet both
leave gaps, and a gap should be the sheet's colour rather than whatever the
canvas was.

## The word is an object

It could be dragged and resized by a slider, with nothing to say it was a thing
and nothing to line it up against. It gets a frame now: four corner handles that
scale about its own centre, and a knob on a stalk that turns it.

**The knob is drawn.** tldraw and Figma both use an invisible hit area just
outside the corner, and on a surface most people will touch once, unmissable
beats uncluttered. Shift holds a turn to fifteen degrees.

**What it snaps to is the sheet's own geometry** — its two centre lines, the
margin the type is set to, and the two rules the head and the foot are drawn on
— and those come from `bandOf`, the function that places them. Pointing the snap
at the band top instead put it sixty units off the head rule, on a line that is
not there; a test now holds the two together.

**The tolerance is six *screen* pixels, converted in.** Six sheet units is a
hair on a sheet drawn at 852px and a shove on one drawn at 400.

Two deliberate choices underneath:

- **The reported word box stays unrotated**, and the room turns the pointer back
  through the angle before testing it. Growing the box to the bounds of a spun
  one would claim the empty corners a turned word leaves behind.
- **Moving stays a shader uniform; scale and rotation bake into the geometry.**
  A rebuild per `pointermove` re-runs the whole treatment chain, which moving
  cannot afford — and which the size slider has always paid.

## Four reasons the microphone looked dead

Three were about where the controls are.

1. Play and the mic were the third group down a rail you have to scroll, and
   exist only in video. Play is on the sheet now, and it is not decoration: a
   browser will not let an `AudioContext` out of suspended until something
   resumes it inside a user gesture, so it is the control that makes sound
   possible rather than a shortcut to it. It gives way to a strip under the
   sheet — under, not over: the artefact is the one surface here nothing should
   cover.
2. A refused permission was reported at the far end of the rail, inside Export.
   Fixed earlier in this round.
3. **Nothing confirmed sound was arriving.** The mic is deliberately not
   monitored — playing it back through the speakers is a feedback loop — so a
   working mic and a refused one looked identical. There is a meter now:
   fourteen bars, spaced so the quiet end has resolution, because speech sits
   low and a linear ladder leaves a live mic looking dead. Published about
   twelve times a second; a meter is read by eye, and sixty setStates a second
   is sixty renders a second.

The fourth is not a layout problem and no control will fix it. `SoundDrive`
subtracts a slow envelope from a fast one, so it answers *change* rather than
level: hold a note and the drive settles back to the values you set. That is the
design — see "The sheet is a performance" — and it is exactly what somebody
testing a microphone does. The meter at least shows the sound arriving while the
letters sit still.

## Saved fonts are a room, and Share is called Compose

Two smaller things from the same round.

The shelf was a scrolling row of 44px thumbnails under the sign-off, so the only
way to find a font you had kept was to already know it was there — and the
picture of it was smaller than the preset chip that made it. It replaces the
workbench the way the sheet does, with a count on the door (`Saved · 3`),
disabled while there is nothing behind it. It has an **empty state**, which it
could not have before: `Shelf` returned `null` when empty, so the feature was
invisible until the first time you used it.

`posterOpen` generalised to one `view`, so a third room cannot leave two open.

And **Share became Compose**. Share named the exit rather than the room: sharing
is what you do once the thing exists, and this is where it gets made — a ground
you can replace, colour that belongs to something, finishes that stack, a word
you can take hold of. The question was raised in the Ditther conversation and
left open because it changes more than a label.

## The sliders were looked at and kept

The one note from the September walk that came out with nothing behind it: the sliders
felt basic, and a lozenge was floated. It was drawn properly — six tracks at the real rail
width on Halftone's own dials, and the densest of them, a fused row carrying its minus and
plus in cells cut into its own ends, built out across the whole 1440 page.

The measurements are worth keeping even though nothing changed, because they are the case
anyone would have to answer to reopen this. One dial is **47px**; Halftone's group is
**1,037px** and the whole rail **1,454px**, against a 768px screen. The fused row put the
group at **652px** and the rail at **981px** — a third of the rail back.

**Hendri kept the current track anyway, and that is a real answer rather than inertia.**
The complaint underneath "basic" turned out to be about the stepper, which is what shipped:
minus, value and plus in one divided rectangle. With that fixed the track stopped being the
thing that bothered him. Density was never the problem being reported, so buying it with a
row that has to redefine what double-clicking means, and that leaves 0 and 100 looking alike
at a glance, was paying for the wrong thing.

What the drawings settled, so it does not get re-argued from scratch:

- **The tick has to survive.** A dial's tick, its muted-or-marked colour and its
  double-click reset all measure from the landing preset. Any track that loses it loses
  "is this a lot?".
- **The ends can be fused.** Minus and plus as cells inside the row's own ends works, and
  it is what would make a fused row viable if the rail ever does need the height.
- **Two of Halftone's fourteen are no longer sliders**, so any track change lands in a rail
  that is already a mix of rows, a segmented control and a switch.

Bands 10 and 11 in the Figma file carry all of it.

## The lag was never the engine

Hendri said the product felt slow and laggy. The reflex answer is "the treatment chain is
expensive", and it is — Grit takes 42 ms over a word, a stack of two 146. But a Halftone
word is 4 ms, and a Halftone dial drag was blocking the main thread for 1.71 seconds across
a sixty-step sweep. The engine was not what was being paid for.

What was: **work scheduled between input events that React cannot abandon once it starts.**
`useDeferredValue` on the glyph grid's key does exactly what it says — it renders the grid at
a lower priority — but the sixty-nine-glyph `renderGlyphSet` inside the memo is one
uninterruptible task, so every tick of the drag paid for the whole face. The fix is not
finer scheduling, it is *not starting*: a trailing timer runs it once when the value settles,
and the grid says it is behind by going pale. Fifty-two milliseconds on Halftone, 1.7
seconds on a stack, spent once instead of sixty times.

Three more of the same shape. **The size ladder wrote the word's forty-kilobyte path into
the DOM seven times**, once per rung, and the browser parsed and rasterised each
independently; it writes it once into `defs` now and points seven `<use>` at it. (The
carrier `<svg>` is zero-sized rather than `display: none`, which stops Safari rendering
referenced content, and the fill moves to the `svg` because a `<use>` inherits into its
shadow tree rather than matching `.fall-ink path`.) **The shelf's twelve thumbnails were a
memo in `App`**, so pressing Save re-treated twelve words while you were still at the bench,
and so did loading the page; they are drawn by the room that shows them. And
**`history.replaceState` ran per input event**, which is also a correctness bug: Safari
throws `SecurityError` past a hundred calls in thirty seconds, which a drag reached in ten,
and a throw inside an effect unmounts the tree.

### Two transforms, and the difference between them is what the GPU is doing

Dragging the word was already free, because the offset is a shader uniform over a texture of
the sheet. Resizing and turning were not: every `pointermove` and every slider tick re-ran
the whole chain and re-uploaded two 1080×1350 textures. A comment in `poster.ts` claimed
resizing was debounced. It was not, and had not been for some time.

So the word now has a live transform and a baked one. A gesture moves the live one, which
goes to the shader as a scale and an angle about the word's own centre; letting go bakes it
into the geometry, which is what makes the letters outlines again rather than a resampled
picture. The inverse map is done in **sheet pixels rather than in uv**, because uv is not
square and a rotation applied in it shears the letters by the sheet's aspect ratio.

That approximation has to be checked against the thing it approximates, so it was: a 40°
turn and a 1.5× resize shown as uniforms differ from the same values built into the outlines
by 0.4 and 0.98 of a channel out of 255, where the change itself is 7.3 and 9.3. A sixty-step
sweep of either control went from 31.7 and 22.5 ms a step to 16.3 — one frame, so both are
now waiting on the display rather than on the engine.

The same pass found the room drawing **sixty full-screen passes a second for as long as it
was open**, on a still sheet with no finishes and no sound. It draws when something changes
now, and re-arms only while the cross-fade is running, a take is recording, or sound is
driving the dials.

### A colour is not a reason to re-treat a word

The sheet is memoised on the palette. So are the two layout thumbnails, one of which is the
character set. Dragging through the colour picker therefore re-ran the chain over the word
*and* over sixty-nine glyphs, twice, per event: 131 ms a step and 4.7 seconds of blocked main
thread over a forty-step sweep.

The outlines are cached now on exactly what they depend on — font, chain, seed, overrides,
word — and nothing else about a sheet touches geometry. The character set is a getter, so
the word layout never treats glyphs it is not showing. A colour is 25.9 ms a step with no
long task at all; Recolour and switching to the character set went to zero, the latter
because its outlines were already made for the thumbnail beside it.

One trap worth writing down: the picker must keep its own shown value. A controlled
`<input type="color">` whose `value` prop is a frame behind gets snapped back to the old
colour by the render in between, and the swatch fights the hand dragging it.

**What is deliberately still slow**: opening Compose, and Randomise. Both are new outlines,
and no amount of memoising makes new outlines cheaper. That is the worker's job, and the
worker is the next round — scoped in STATE.

## Keeping a font is not one of the ways out

`Save font` sat in the action bar beside Compose and Download, which are the two things that
hand you a file. It does not hand you anything: it keeps the thing you have named. Every
tool that has both puts the favourite beside the file's name and the outputs at the far end
of the bar — Canva, Jitter and Framer all do, and it is the same reasoning as the name field
being the page title.

So it is a heart on the name's own line. Outline when the font is not kept, filled when it
is, and pressing it again forgets — which the button could not express at all, and which
meant there was no way to take a font off the shelf without going into the room. (Pressing
`Save font` twice quietly moved the entry to the front, because a duplicate would have been
worse. A mark that can be turned on can be turned off.)

`Saved · N` goes up a level into the mark's row. It is navigation rather than an action, and
the heart is what the hand wants while working. The count stays — a door with a number on it
is the difference between a feature you remember having and one you go looking for — but the
door is hidden rather than disabled at zero, because a dead button in the row above the bar
is furniture.

## One verb, and the choice underneath it

Download was a select and then a button: pick the wrapper, then press the verb. That is a
question asked of everybody, including everybody who is not leaving. No tool in the category
does it that way — Canva, Adobe Express and Figma all make Download the verb and hang the
format under it, because the choice only exists once you have decided to download.

So one button, four rows, and the line that used to ride the button as a tooltip is written
against the row it describes. It said the same thing in two places before — as an `<option
title>` and as the tip — and neither was where you were looking.

`Menu.tsx` is the first popover in this project, so it is also the pattern: `aria-expanded`,
`menuitem` rows, arrows and Home/End, Escape to close and hand the button its focus back, a
press outside to dismiss. Compose's export takes the same control; in video there is nothing
to choose, so it stays a button.

## You should be able to click the thing you can see

Four notes from Hendri's walk through Compose, and they are all the same note: the rail was
the only way in.

**The sheet had no row.** It was the state of having nothing selected, and the only way back
to it was pressing the highlighted layer a second time. Nothing said so, so the layout
picker and the two rolls read as gone the moment you touched a layer. It is a row at the
foot of its own list now. Escape has the same shape of fix: it used to leave the room
whatever you were doing, so the reflex for "close this panel" threw away the sheet. It backs
out one step at a time.

**Clicking the sheet selects what you clicked.** The canvas is WebGL, so there is nothing in
the document to hit; `sheetParts` derives the caption's six marks as rectangles from the same
numbers `chrome()` draws them with, which is why the thing you click and the thing you see
cannot drift apart. The rail names the mark you picked and which of its two swatches owns
it. Order is the word, then the marks, then the ground — the order they are stacked in.

Nothing on the sheet can be *dragged* except the word, and that is on purpose: this room is
a way to preview a font, not a second surface to design one on.

**A turn is a handle with a number beside it, not a track.** Figma, Canva and tldraw all turn
from a handle and keep a field for the angle you can name; none of them has a rotation
slider. So the slider is gone and the field stays. The snapping is inverted from those
tools, though — **on by default, Shift to let go** — because a word a degree and a half off
level on a sheet with two rules ruled across it is a mistake rather than a choice, and the
tool should be the one holding it straight. The pull is Konva's shape rather than a coarser
scale: 43° lands on 45, 37° stays at 37, and the square angles get a wider pull because
upright, sideways and upside down are worth landing exactly on.

## Three grounds, one of which was not doing anything

**Wash is cut.** A vertical gradient is the one thing on that list that paper does not do.

**Screen halved its pitch.** At eighteen units a dot was nearly four pixels on a sheet shown
at 852, which reads as spots on the paper rather than as a screen. Finer dots carry more ink
for the same weight, so the opacity came up as the radius came down.

**Tooth was doing nothing, for three reasons at once**, and Hendri was right that it looked
identical to Flat. Its `baseFrequency` was 0.85 — a period of 1.2 sheet units, under a device
pixel once a 1080 sheet is drawn at the 850-odd it is shown at, so it averaged out.
`feTurbulence` also writes a random *alpha* averaging about a half, and `feColorMatrix
saturate` does not touch alpha, so the whole thing came out as one uniform 14%-of-a-half
veil. And it never took the palette, so it was the only ground that did not recolour with
the sheet. Measured against flat paper on the live site: 3.3 darker, and *no more variation
at all* — a dimmer, not a texture.

It is a coarse fractal noise now, its alpha banded so only the tail takes any ink, flooded
with the sheet's caption ink: 5.4 darker and 1.8 more variation, against the dot screen's
3.1. The picker's chips draw at sheet proportions rather than at the chip's own size, so a
swatch shows the texture at the scale the sheet will — they were showing a coarser one,
which is a picture of a different ground.

The old test only asserted that the five grounds produced five different strings, which a
texture rendering identically to flat passes easily. The new ones assert what actually
failed: every texture contains the palette's ink, the noise period is at least three units,
and the tooth bands its alpha rather than wearing a blanket opacity.

## An effect's reach is where you put it

An uploaded backdrop already travels to the GPU inside the ground's SVG, so it was one
texture away from being something the shader could work on. Four print processes now do:
a rotated dot screen, an ordered dither, a duotone and a coarse mosaic.

They belong to the Background layer rather than to Finishes, and that scope is the whole
point rather than an implementation detail. A finish is a pass over the finished page — that
is what makes it a finish. These reprint the *ground*, and the word is composited over the
result, so the type stays crisp letterforms on a screened photograph instead of being
screened along with it. Unicorn Studio states the rule better than I can: an effect that is
a child of a layer touches only that layer.

Print vocabulary rather than filter names, because that is the language the rest of the tool
speaks. Two dials each at most, so the existing `vec3` packing holds, and `PICTURE_EFFECTS`'
order is load-bearing exactly as `FINISHES`' is — the uniforms are positional, and a test
pins it. The switch-and-dials stack the finishes rail was made of is a shared component now,
so the two rails cannot drift.

A **video** backdrop is the obvious next one and is not built. It cannot travel inside the
SVG the way an image does: it needs its own sampler and a per-frame `texImage2D`. The draw
loop already runs while a take is recording, so the loop is not the missing part.

## Where to look next

Highest value first, folding in `RESEARCH-2026-09.md` (Font Gauntlet, the field, the
specimen stage). Sizes are rough. The layout pass is done and several of these have shipped;
what is left is below.

1. **Freeze this frame as a font.** The sheet holds the resolved dial values for every
   frame it draws, so a frame you like can go straight to `buildTreatedFont` in the worker.
   Nobody else can offer this. Small to medium.
2. **Amount master slider** lerping source → preset, and **hover a preset to preview it**
   on the main canvas. Carried over; both nearly free because the engine is client-side and
   deterministic.
3. **Styles view**: every preset of the current treatment as a waterfall in the page — what
   `scripts/style-samples.ts` does on the CLI. Small.
4. **WebCodecs recorder** with `MediaRecorder` as the Safari fallback, the 15 s cap lifted,
   MP4 with the audio muxed. Medium; `src/lib/videoRecorder.ts`.
5. **Geometry in a worker**, for the sheet and for the bench both. This is now the only
   thing left holding the main thread: after the September speed round, opening Compose and
   Randomise are the two actions that still block, and they block because they are new
   outlines. `buildFont.worker.ts` is the pattern, the engine is DOM-free, and
   `sheetGeometry` in `poster.ts` has already split the outlines from the strings drawn
   round them. The cost is that a synchronous call becomes a request and a reply, which
   needs latest-wins ordering. Scoped in STATE under "Speed, September 2026".
6. **Whole-window drop target** for a font, and a visible **Copy link** for the URL state.
   Small.
7. **Slant and Tracking** as export-safe global dials — a shear on the outlines, a uniform
    advance change — with `verify:font` taught to accept the drift. Medium. Parked until
    the layout pass says whether they belong in the rail.
8. **Slider craft, what is left**: drag on the label to scrub, `Shift` for fine, and tint the
    label when a value is off its default (Webflow's trick, better than our tick on the track).
    The typeable value, the steppers and the dark caption shipped with the layout pass.
9. **Tune the thirteen against each other** on the contact sheet.
10. **A video backdrop.** The picture effects work on an image texture that arrives inside
    the ground's SVG; a `<video>` needs its own sampler and a per-frame `texImage2D`. Medium,
    and it would export for free — the PNG and the recorder both read the same canvas.
11. **Nothing about the sheet is in the URL.** Format, layout, palette, seed, word placement,
    finish and the sound mode are all local to `Poster`, so a sheet you like cannot be
    reopened or sent to anybody. That was an open question when the sheet was a modal; now
    that it is a room with real settings in it, it is a hole. Small to medium.

Shipped: the licence panel at font upload; the action bar, layers as cards, every dial visible
and the size ladder's gutter with the layout pass; presets as pictures with one always
selected; the finish layer; the sheet as a room with three formats, a Static/Video switch and
one-type export. Removed again since: Present mode (it named a mode nobody could picture) and
the per-dial sound binding table (three named modes replaced it).

A later look at typograph.studio (AI parametric typeface generator, adjacent not
competing) confirmed the positioning: nothing in the niche outputs specimen sheets or
audio-reactive video, and its signup wall is the anti-pattern this tool's no-login,
URL-as-state instant play is the counter to. Nothing else there worth borrowing.
