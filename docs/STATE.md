# Where the project is

Read this first in a new session, then `README.md` for how to run it and
`docs/DECISIONS.md` for why it is built the way it is.

**Repo:** `/Users/hendri/forfontsake` → `github.com/itsHendri/forfontsake` (public, `main`)
**Live:** https://forfontsake.xyz — GitHub Pages, deployed from `main` by
`.github/workflows/deploy.yml`. See `docs/DEPLOY.md`.
**Licence:** GPL-3.0-only (forced by `font-flux-js`; deliberate — see DECISIONS).

---

## What works today

The whole loop is real: **pick a font → apply a treatment → turn dials → download an
installable font**, entirely in the browser.

| Piece | State |
| --- | --- |
| Engine (13 treatments) | Done. Grouped in the picker as Wear, Ink, Screens, Press, Structure; the full list is in `README.md`. Organic keeps id `growth`. **Consolidated from seventeen**: Soak into Bubble; Outline and Beads into Onion; Stipple and a soft halftone into Halftone; a noise dissolve into Pixel; a drag and the Ghost rebuild into Extrude. Melt cut, Ghost retired into Extrude, **Fur added** as the one new operation. `retired.ts` keeps old links opening on what they described, and drops steps naming a cut treatment. See DECISIONS. |
| Stacking | Done. Up to three treatments in a row, in the UI, the URL and the export. |
| Live preview | Done. Type into the specimen itself, at up to 144px. |
| Workbench layout | Done. An action bar carrying the name **with Save font beside it** — a bookmark that fills and reads Saved when the font is kept, pressing again forgets; same button as Compose — **Base font and Style under labels**, then Compose and Download as the two ways out. `Saved · N` sits in the mark's row above the bar, hidden at zero; presets above the plate as pictures of themselves; layers as cards, **each with its own Reset**; every dial visible — the four longest treatments breaking into named runs rather than hiding half of themselves — and the size ladder labelled above each line. **Randomise is gone** and the plate's footer with it. See DECISIONS. |
| **Presets are the default** | **Done.** No unnamed state: a treatment opens on a named preset (`defaultPreset`, else the first). Grit opens on Sandblast. Dials measure their tick, their colour and their double-click reset from that preset, not from the bare spec default. |
| Glyph grid, waterfall | Done. All 69 preview glyphs; the grid is also the override selection surface. |
| **Per-glyph overrides** | **Done.** Select glyphs → dial deltas over the global chain, per-glyph reroll; in the URL (7th field), the shelf and the export. |
| **In-browser export** | **Done.** Same engine as the CLI, in a Web Worker; overrides included. **One Download button that opens its four choices** (`Menu.tsx`, the project's only popover): TTF, WOFF2, WOFF, or a zip of all three — one build, since the web formats are containers over the same validated bytes (`engine/webfont.ts`, written by hand because the library's own WOFF2 is rejected by OTS on real fonts). |
| Compose (was Share) | **A room of its own, not a modal.** Replaces the workbench, keeps the URL, closes with a ×. Three formats (Post 4:5, Square, Story 9:16) chosen in the header, **which also carries the export and is sticky**; layout picked as two engine-drawn pictures and switched with a cut rather than a dissolve. At 1440×1000 the sheet draws at 852 px, against 702 in the modal. Renamed on 9 September: Share named the exit, not the room. |
| **Finishes** | **Done, and they stack.** The sheet renders through WebGL2: grain, riso misregistration and a scanner losing sync, in that order and in any combination. Pixels, never geometry — a structural test keeps finishes off the path from a chain to a font file, and the SVG download stays letterforms only. |
| **The sheet as layers** | **Done, and you click the sheet rather than the list.** Background, Word, Caption, Finishes, with **Sheet** as a row of its own at the foot so the layout picker is always one press away. Clicking the canvas selects what is under the pointer — the word, any of the caption's six marks (named in the rail), or the ground — and Escape backs out one step before it leaves the room. Colour belongs to a layer; the word is an object with corner handles and a knob that **snaps to the square and fifteen-degree angles unless Shift is held**. |
| **Grounds** | Flat, Screen, Grid, Tooth, or a picture you bring. Wash was cut. Tooth was sub-pixel noise reading as a flat grey veil and is now a banded speckle in the sheet's own caption ink; Screen halved its pitch. |
| **Effects on a picture** | **Done.** Halftone, Dither, Duotone and Mosaic, on the Background layer and only when a photograph is loaded: they reprint the ground in the sheet's two inks and the word is composited over the result, so the type stays letterforms. In `finish.ts` beside FINISHES, positional uniforms and all. A video backdrop is not built — see the note below. |
| **Sound + clip** | **Done, behind a Static / Video switch.** Sound exists only in video, so choosing MP4 can never start it. Three named modes — Pulse, Breathe, Shimmer — plus Depth and Speed. The export *is* the take: no separate Record button. **Both layouts can move**; the rail reports the measured rebuild rate when a chain is slow enough to step. |
| Saved fonts | **A room of its own**, reached from `Saved · N` in the mark's row, with an empty state. Its cards are drawn when the room opens rather than by the workbench. Kept across reloads in `localStorage`. |
| Bring your own font | Done, from the font menu. Read in the worker, licence reported, held in memory. |
| CLI export + verification | Done. `build:font` + `verify:font` (7 checks). |
| Deployment | **Live** at forfontsake.xyz. Pushes to `main` deploy; HTTPS enforced. |

Seven source fonts ship, all OFL: Pirata One, Anton, Archivo Black, Bebas Neue,
UnifrakturCook, Abril Fatface, Pacifico.

## The non-obvious mechanisms

All are explained fully in `DECISIONS.md`; know they exist before touching any of them.

1. **You type into the specimen.** A transparent `<input>` sits over the treated outlines.
   It only lines up because treatments preserve advance widths, the source faces ship as
   metrics-only woff2 subsets in `public/fonts/preview/` (cut by `make-glyph-data`, never
   seen), **and every layout feature is switched off on that field** — kerning in particular.
   The subsets are cut with `--layout-features=` so they had nothing to apply and that last
   part went unnoticed until upload brought in a whole font: Pacifico sat 11 px adrift over
   one line. Measured delta now, shipped and uploaded alike: **-0.01 px**. The vertical
   position comes from a hidden probe, not from font metrics. Growing treatments widen every
   advance uniformly (spaces included) and the field compensates with letter-spacing — the
   uniformity is what keeps the compensation exact.
2. **The download is built in the page.** `buildTreatedFont` — the same function the CLI
   runs — executes in a Web Worker over the real source bytes. Verified equal to the CLI
   output on Pirata One (1144 glyphs) and Anton (4095), and accepted by the browser's own
   sanitiser.
3. **One `applyChain`, used by everything.** The preview, the specimen sheet and the font
   writer are separate code over different inputs, and the only thing they must agree on to
   the unit is which treatments run, in what order, over what context — so that lives in
   exactly one function in `treatments/registry.ts`. Critically the context, and the random
   stream in it, is shared across the steps rather than renewed per step; a second step given
   a fresh rng draws different geometry, and if one caller did that the specimen and the
   downloaded font would quietly stop matching.
4. **Organic only works because it inserts points.** It is differential growth on the glyph's
   own contours (id stays `growth` — it lives in URLs and shelves), and the node insertion
   *is* the effect — the fixed-point-count version of it grows the perimeter 5.7% over sixty
   steps and looks like nothing. A per-glyph point budget caps it at 700, because folding is
   unbounded and points are bytes in the export.
5. **Overrides merge in one place, like chains run in one place.** `resolveChain` in the
   registry is the only spot a per-glyph delta meets the global chain; preview, sheet and
   writer all call it. Seed and cuts stay global (GSUB needs uniform variant counts); the
   per-glyph reroll is a nudge on the seed, never a second seed.
6. **Sound modulates values, never the seed.** The sheet's sound mode drives primary dials
   through slow per-band envelope followers (the Speed dial scales their clock), un-snapped
   so the geometry morphs; every frame is reproducible from its values. Which dial rides
   which band is a choice — `src/lib/modulate.ts` holds the mapping, stores only the
   overrides and derives the rest, so the default is what the sheet always did. The audio
   analysis is FLUX's (MIT, same author), kept in `src/audio/` with attribution.

## Verified, and how

- `npm run typecheck` · `npm run test` (486 across 21 files, including the grounds against the sheet they
  draw, where the word snaps and that those lines are ones the sheet really draws, the
  word box holding still however far the word is turned, the finish order the shader's
  positional uniforms depend on, the WOFF and WOFF2 containers
  decoded back out and compared table by table, the switch/segment dials against the
  values their presets land on, when the sheet cuts rather than dissolves, override URL
  round-trips, the poster's
  word transform, the layered sheet against the composed one, the word's hit-test box against
  the transform that draws it, the sound's per-dial bindings, the audio maths, the recorder's
  container choice, and the structural rule that keeps finishes off the path to a font file)
  — both green.
- `npm run verify:font` — 7 checks: size, **ots-sanitize**, fontTools, **CoreText**,
  alternates actually substitute, ligatures still form, naming + Reserved Font Names.
- The browser export was checked by loading the result with `FontFace.load()`, which *is*
  OTS, and confirming glyphs draw. Re-checked on Growth over Archivo Black: a 692 KB
  `font/ttf` blob, 1268 glyphs including 842 alternates, sfntVersion `0x00010000`, 18
  tables, accepted by `FontFace.load()`.
- All seven treatments were built at `--alts=2` and put through `verify:font` in one sweep —
  7/7 checks each.
- Alternates are cut only for Basic Latin and Latin-1 (`worthVarying`), which halved the
  heavy faces: Pacifico 6.5 MB / 12.6s → **2.7 MB / 5.2s** in the CLI and 26s in the page,
  Anton 4 MB → **1.75 MB**. The verifier still shows the rotation working
  (`a a.alt1 a.alt2 a.alt1`) and ligatures still forming, which is the pair that had to
  survive it.
- A **stacked** font (`--treatment=grit+bubble`) passes all eight against the source, with
  the advances grown by the sum of both steps. Collapsing the three copies of the chain loop
  into `applyChain` was checked by rebuilding that font and diffing: **byte-identical**.
- The specimen overlay (mechanism 1) was re-measured with Growth on its heaviest preset,
  since a *growing* treatment is the case most likely to break it: **-0.01 px** between the
  input's laid-out text and the drawn outlines.
- The shelf's persistence is covered by tests that stub `localStorage`, including the paths
  that are easy to get wrong: storage that throws outright (a private window), storage that
  throws on write (quota), junk in the slot, and one corrupt entry among good ones — which
  drops itself rather than emptying the shelf. Exercised in the browser too: seeded entries
  survive a reload, entries naming a font or treatment that no longer exists are pruned
  rather than crashing the page, and partial entries are backfilled from defaults.
- **On the live site after this round's deploy** (run 34400350089, 9 September): the workbench
  serves with the setup row, the picture range chips, square cells, the one-box stepper and no
  Randomise, and the format menu offers all four. A **WOFF2 built in the page** came back as
  172 KB with a `wOF2` signature and was accepted by `FontFace.load()`, which is the browser's
  own sanitiser — so the new containers work where it counts, not only on this machine.
- **On the live site**, not just locally: `https://forfontsake.xyz` serves, `http` and `www`
  both 301 to the canonical apex, HTTPS is enforced, and pressing Download there produced
  `Growth-Regular.ttf` — 519 KB, sfntVersion `0x00010000`, 17 tables, accepted by
  `FontFace.load()`. That last one is the check worth repeating after any deploy that
  touches the build, because it is the claim the whole project rests on.

The metric-parity check that used to fail on `--alts > 1` has been fixed — it compares the em
square, the mapped codepoints and the shared glyphs' advances rather than raw glyph counts,
and it understands a growing treatment. It only runs when `VERIFY_AGAINST` points at the
source font:

```
VERIFY_AGAINST=public/fonts/pirata-one/PirataOne-Regular.ttf \
  npm run verify:font -- out/CoralOne-Regular.ttf Pirata
```

Growth passes all eight at `--alts=3` — on the defaults that is 519.4 KB, 1144 glyphs,
"advances grown +36 on 379". Note the CLI wants `--treatment=growth`, with the `=`; the
bare-space form parses as the treatment named `true`.

The CLI builds stacks too: `--treatment=grit+bubble`, with dials addressed by position,
`--p1.amount=60 --p2.weight=30`. Position rather than name because a stack may repeat a
treatment, which would make a bare `--p.simplify` ambiguous. `--p.` with no number is step 1,
so every older invocation still means what it did.

## The UX round, September 2026

Hendri walked the live app and gave about twenty notes. Eleven were settled and are
shipped — they are the ten commits from "Say the name is a field before you touch it"
to "Deflate the TTF inside the zip", and each is explained in DECISIONS:

| | |
| --- | --- |
| Name field | Dashed at rest, mark on hover — it only admitted to being a field once you were over it |
| Base font · Style | Out of the plate's bar, up beside the name, labelled |
| Randomise | Gone. It only moved the seed, and Halftone's landing preset never reads it |
| Reset | On every layer card, naming the preset it returns to; the lone layer's Clear folded in |
| Plate footer | Gone with them — the readout repeated the Randomness dials |
| Glyph grid | Square cells; they were inheriting the global button radius |
| Clear chip | Always present, disabled when empty, so it stops appearing under the pointer |
| Glyph hint | An (i) on the heading, the pattern every dial already uses |
| Five dials | Invert is a switch; Halftone Shape, Extrude Shape and Layer, Onion Style are segments |
| Sheet layout switch | An instant cut; the dissolve stays for the rebuilds sound causes |
| Sheet export | In the bar beside the size and the close, sticky, with the notes moved to their causes |
| Download | TTF · WOFF2 · WOFF · all three |

**A counting trap, recorded because it briefly overstated the suite.** A background task's
git worktree lives at `.claude/worktrees/<name>/`, inside the repo, so vitest globbed into it
and counted every test file twice — 42 files and 958 tests where there are 21 and 486. Nothing
was wrong with the tests; the number was. Removing the worktree fixed it. Worth a `vitest`
exclude if worktrees become a habit.

**The slider track was the one note left, and it was looked at and kept** — six tracks
drawn at real size, the densest of them built out across the whole page, and the current
one chosen anyway. The measurements and what they settled are in DECISIONS under "The
sliders were looked at and kept"; bands 10 and 11 in Figma hold the drawings. Nothing to
build, and the round is closed.

**All twelve picks came back, and all nine that needed building are shipped.** Hendri
took every recommendation. In ballot order: picture chips for the glyph ranges, the
one-box stepper, the Saved fonts view, the stalk rotation handle, the layer list at the
head of the rail, gated finish sections, the background picker in the rail, play on the
sheet with a level meter, and **Compose** as the room's name. Each is explained in
DECISIONS; the picks themselves are still readable at `picks/ux-round-2`.

All of it is drawn in a **new Figma file**, `ZHfdGRnUCfMRxcTgF4v8qu` — "For Font's Sake
— UX round 2, Sept 2026" — three pages (Workbench, Share room, Components) over a
rebuilt `Letterpress` variable collection, with every specimen a real vector from the
engine. Band 01 of each page is the app as built, with the eleven changes called out;
every other band is a fork with its options side by side.

**Twelve picks live on the ballot**, https://claude.ai/code/artifact/a7887920-2679-4a6a-b346-3018145bdcbb,
saved to its own store as document `picks/ux-round-2`. Read that document before
starting the build; nothing structural moves in `src/` until it is filled in.

## Speed, September 2026

Hendri's note was that the product felt slow and laggy. It did. Measured on the live site
before the round, and on the same build after it — headless Brave, `PerformanceObserver`
on `longtask`, sixty-step sweeps driven one a frame:

| What | Before | After |
| --- | --- | --- |
| A dial drag on the bench (Halftone) | 18 long tasks, 1.71 s of blocked main thread, worst 145 ms | none |
| The word's Turn, per step | 31.7 ms | 16.3 ms — one frame, so it waits on the display |
| The word's Size, per step | 22.5 ms | 16.3 ms |
| Dragging the ink swatch, per step | 131.4 ms, 40 long tasks, 4.7 s blocked | 25.9 ms, none |
| Recolour | 122 ms | 0 |
| Switching to the character set | 93 ms | 0 |
| An idle Compose room | 60 frames a second | 0 |
| Opening Compose · Randomise | 134 · 120 ms | unchanged, and rightly: those are new outlines |

Load was never the problem and was left alone: 374 ms to `load`, 161 KB of JavaScript and
190 KB of glyph data, both gzipped.

Four mechanisms did all of it. **The grid and the layer thumbnails wait 120 ms for the dials
to settle** and go pale while they are behind, instead of being re-run between input events
by `useDeferredValue` — which schedules the work but cannot abandon a `useMemo` part way, so
every tick paid for all sixty-nine glyphs. **The ladder writes one path into `defs` and
points seven `<use>` at it**, rather than seven copies of a forty-kilobyte `d`. **Resizing
and turning the word ride shader uniforms while the hand is down** and bake into the geometry
on release, the way dragging already did; the room draws on demand rather than at 60 fps.
And **the treated outlines are cached on exactly what they depend on** — font, chain, seed,
overrides, word — so a colour, a texture, a size, a layout or a format is string work over
letters that are already drawn.

### What is left, and where it would start

1. **A render worker.** `src/workers/render.worker.ts` as a thin shell like
   `buildFont.worker.ts`, jobs in a DOM-free `renderJobs.ts`, a latest-wins client with one
   pending slot, and a `useWorkerJob` hook replacing the settle timer above. Grid, thumbnails
   and shelf first; the plate's word second. Not a new job kind on `buildFont.worker.ts` —
   that one bundles opentype, brotli and jszip and is spawned per job. Vite's `?worker`
   plugin inlines a new worker into the artifact automatically, at the cost of a second copy
   of the engine (~250–300 KB) in `out/workbench.html`. This is what would take the remaining
   134 ms off opening Compose and off Randomise.
2. **A cross-call glyph cache in `render.ts`.** It must key on `penX` for positional
   treatments — `extrude.ts` reads it — so `Treatment` needs a `positional` flag first.
   Typing on a heavy chain is what it buys.
3. **Poster geometry in the worker**, which DECISIONS has long called the real fix. The
   geometry/paint split it needs is half done: `sheetGeometry` in `poster.ts` already
   separates the treated outlines from the strings drawn around them.
4. **Load polish**, worth doing and worth expecting nothing from: a `preload` for
   `glyph-data.json` (stripped in `inline-build.ts`), and a non-blocking Google Fonts link.
   `React.lazy` for Compose is a no — the artifact build inlines only the entry chunk.
5. **A video backdrop.** The picture effects run on an image texture that arrives inside the
   ground's SVG. A `<video>` cannot travel that way: it needs its own sampler and a
   per-frame `texImage2D` in `draw()`. The draw loop already runs while a take is recording,
   so the loop is not the missing part — the texture path is.

## Debt, roughly in order of how much it matters

1. Big faces are still not fast to export. Pacifico, the heaviest of the seven, takes 26s
   in-browser for a 2.7 MB file — better than the 6.5 MB it was, and honest while it runs,
   but a wait. What is left is genuinely proportional work; the next real gain would be
   splitting the glyphs across several workers.
2. The specimen sheet has two layouts. A third is a function in `poster.ts` and an entry in
   `LAYOUTS`; a waterfall is the obvious one, though it repeats what the workbench shows.
3. `VERIFY_AGAINST`'s uneven-drift rule predates per-glyph overrides, which can legitimately
   grow different glyphs by different amounts — the check would flag such a font. It needs to
   learn to read the override map.
4. Sound feel is tuned by ear so far only on one machine: the Speed default (0.5), the
   Depth default (35% of a dial's span) and the bubble loop's mix deserve a pass on a phone
   and real speakers.
5. ~~**The sheet is a modal, and that is now the limit on it.**~~ **Done** — see DECISIONS,
   "The sheet is a room, and it asks one question at the top". The paragraph below is kept
   because the measurements in it are what the redesign was judged against. It opens as an overlay over the
   workbench, so the specimen — the artefact somebody actually leaves with — gets a column of
   a dialog while the rail beside it has grown to Finish, Sound, per-dial bindings and the
   exports. At 1000 px the rail is 893 px and exactly fills its container; on a shorter screen
   the bottom clips, and the download buttons are what gets cut. This is the next piece of
   work: see "The sheet wants to stop being a modal" below.
6. ~~**Recording has not been exercised since the sheet became a canvas.**~~ **Confirmed by
   Hendri on 8 September: a downloaded clip plays, and a downloaded font installs.** What is
   still unverified from a headless session is the *motion* — the browser pane pauses
   `requestAnimationFrame` whenever it is hidden, so the sheet sits still there however the
   sound is driven. `poster.test.ts` pins the geometry half (a driven chain redraws both
   layouts); the live animation needs a real pair of eyes. The old note: The recorder now
   captures the WebGL canvas rather than decoding SVG per frame, which is simpler and cannot
   disagree with the screen — but headless cannot drive `MediaRecorder` meaningfully, so a
   real take is unverified. Play the loop, record a few seconds, confirm the file plays with
   the finish in it.
7. **The sheet room was untested on a phone until 8 September**, which is where it gets posted
   from. Its bar is a single flex row of fixed-width controls, so at 375 px it ran 572 px wide:
   the size picker was cut off and **the close went off-screen entirely**, leaving no way out
   of the room. It wraps now under 620 px. The lesson is the general one — the workbench had
   been checked narrow and the sheet had not, because it was a modal when that check was made.
8. **Accented characters draw nothing in the preview.** The baked glyph data carries exactly
   70 glyphs — space, digits, basic punctuation, A–Z a–z — so typing "Café" shows a gap while
   the character still takes its advance. Exports are unaffected: they read the real font
   bytes and keep the full character set. Widening `PREVIEW_CHARSET` roughly doubles the
   487 KB every visitor fetches, so this is a decision about payload rather than a task.

## Where things live

```
src/engine/          pure geometry + font writing, no DOM (browser-safe)
src/engine/extract   one font → outlines + licence; shared by the build script and the page
src/audio/           AudioEngine · sources (mic + bubble loop) · EnvelopeFollower ·
                     OnsetDetector · bands — FLUX's analysis stack (MIT), adapted
src/lib/             glyphData · render · urlState · savedStyles · exportFont · importFont
                     poster · finish (the WebGL2 stage) · modulate (sound → dials) ·
                     videoRecorder · clipboard
src/components/      TopBar · Plate · Presets · GlyphGrid · Waterfall · Panel · Dial · Thumb ·
                     Shelf · Poster (the specimen sheet, and everything on it)
src/workers/         buildFont.worker.ts — the export *and* reading an uploaded font
public/fonts/        7 sources + OFL.txt each; preview/ holds metrics-only subsets
scripts/             make-glyph-data · build-font · verify-font · inline-build · figma-export
                     make-share-image (regenerates public/share.png from poster.ts)
out/                 build output and scratch — gitignored, safe to delete
```

`out/exports/` holds superseded scratch (old workbench builds, comparison SVGs). It used to
sit in `public/`, where Vite shipped 4.4 MB of it to every visitor.

## The sheet wants to stop being a modal

**This is the next piece of work, and it has its own session.**

The specimen sheet is the artefact somebody actually leaves with — it is the thing that gets
posted, and it is the one part of this tool nobody else has. It currently opens as a modal
over the workbench (`.poster-backdrop` > `.poster`, a two-column grid capped at 900 px), which
made sense when it was a sheet and four buttons. It is now a sheet, a Finish picker with three
dials, a Sound block, a per-dial binding table and five ways out — and the sheet itself gets
whatever column is left.

The measurements, so the next session starts from facts rather than impressions:

- At a 1440 × 1000 window the rail is **893 px tall and exactly fills its container**. It is
  not scrolling; it is fitting, and only just. On a shorter laptop the bottom clips and the
  download buttons are what gets cut.
- The sheet is capped at `min(78vh, 900px)`, so at that window it draws at roughly **702 px**
  for a 1080 × 1350 artefact — about 52% of its real size. Present mode already goes to 94vh
  and reaches 846 px, which is the clue: the sheet is better when the chrome goes away.
- `.poster` is `max-width: 900px`, `grid-template-columns: minmax(0, 1fr) 260px`.

Things worth knowing before redesigning it:

- **Present mode already exists** and is the cheap version of the answer — rail hidden, sheet
  given the window, Escape steps back one level. Whatever replaces the modal should probably
  make that the default rather than a mode.
- **The sheet is a WebGL canvas now**, not SVG. It scales by CSS on one axis (`width: 100%`,
  `height: auto`) and its backing store is fixed at 1080 × 1350, so giving it more room costs
  nothing in geometry — it is one texture upload either way.
- **Nothing about the sheet is in the URL.** Layout, palette, seed, word placement, finish and
  the sound bindings are all local to `Poster`. If the sheet becomes a route or a page rather
  than an overlay, that is the moment to decide which of those deserve to be shareable.
- **Escape and the backdrop already carry rules** — see "The sheet is a performance" in
  DECISIONS. A stray click cannot close it while sound or a recording is live, and Escape
  leaves one thing at a time. Those rules should survive whatever shape it takes.
- The research on where this could go — Finish layers, story-size sheets, WebCodecs export,
  what the field is doing — is in `RESEARCH-2026-09.md` under "The specimen stage", and the
  measured look at how the field arranges a share environment is under "The share
  environment, measured" in the same file.

**Where this got to on 6 September.** The quick fixes shipped first (one Weight, no blurb, no
stack note, an (i) on every dial, one Detail dial — see DECISIONS, "Say each thing once").
Then seven wireframes went up as one page for Hendri to pick from: four shapes for the share
environment (S1 Stage, S2 Toolbar, S3 Sheet layers, S4 Looks) and three for where font, style
and presets sit on the workbench (W1 Setup row, W2 The layer owns its style, W3 Plate head).
**Redrawn in Figma on 7 September**, at Hendri's request, as native layers over the file's own
components and the Letterpress variables — band **09 · The share environment** (six rooms) and
band **10 · Font, style, presets** (three hierarchies), in
`https://www.figma.com/design/ie27RUJUSlkglzarqTMZIO`. Two rooms were added after a second
research pass over Mobbin's screenshot library and a walk through Ditther:
**S5 · Tabbed rail** (a `Sheet | Motion` segmented control at the head of the rail, and the
sound binding moved onto each dial's own row instead of a table) and **S6 · Composer** (the
sheet as a canvas with layers, a replaceable background, a dock of things to add, toggle-gated
sections and Ditther's fused slider rows). A card at the foot of band 09 carries the spectrum
and the open questions.

Recommended: **S5 next, S6 as the direction**, with W2 if the composer is where this is going.
The artifact still holds the pick, saved to its own store as document `picks/layout`
(`share`, `rail`, `naming`, `scope`, `notes`, `at`). Nothing in `src/` moves until that pick is
read. Already decided regardless of it: format lives on the canvas and never in the export
(Post 4:5 · Square · Story 9:16), sound becomes named modes plus Depth, and the sheet's state
stays out of the URL for now.

**The open question the Ditther conversation raised**, recorded because it changes more than
layout: the workbench makes a *font* and the second room makes a *post*, so "Share" may be the
wrong name for a room — Share is what you do at the end. Whether that room is called Compose,
and whether a background image, an inverted palette and your own text layers are in scope, are
both Hendri's to call. **Answered on 9 September: it is called Compose, and the background
image and per-layer colour are both in — see DECISIONS.**

**Round two, 7 September.** Hendri picked the tabbed rail (S5) as the direction and gave notes,
which are now settled across every frame in band 04 of the Share page: the format picker moves
into the header bar; a close **×** replaces the back-to-workbench link, so the room reads as
something you leave; **Present is gone** (it named a mode nobody could picture, and the sheet
already has most of the window); export becomes **one type plus Download**, which removes Copy
SVG and Copy link; and **Record clip stops being a button** — MP4 is a type, so recording is
what Download does when you are making a clip. Four frames differ only in how the
sheet-versus-motion choice is made: R1 shows the two modes as pictures, R2 drops modes for a
list of selectable aspects, R3 moves the question to the exit beside the button that acts on
it, and R4 combines R2's list with R3's exit. R4 is the recommendation.

**Round three, 7 September.** Hendri rejected all four of round two as drawn but kept the parts
that worked. Settled: the **visual picker moves to Layout** — Word versus Character set, as two
real renders, because that is the thing that visibly changes — and the size picker and close ×
sit together top right. What was still unresolved is **static versus video**: where the switch
lives, and how it relates to sound and to the export types. Four placements are drawn in band
05 of the Share page (V1 centred in the header bar, V2 on the canvas above the sheet, V3 at the
head of the rail, V4 no switch at all with sound deciding), two drawn static and two video so
both halves are visible.

**The wiring, which was the real question.** Choosing MP4 must never turn sound on. The
dependency runs one way: sound is what makes a moving export possible, so the export list
follows the state of the room rather than driving it. In Static, sound is *absent* rather than
greyed, so the ambiguity cannot arise. A table on the band 05 card states this for both states.
Terminology is still open — Static · Video (Hendri's words), Still · Clip (the recommendation,
since "clip" says short and postable), or Sheet · Motion (round two's, which named our
furniture rather than the outcome).

**V1 chosen, and drawn in all three states** (Share page, band 06). Only four things change
between static and video, and the fourth is a constraint rather than a decision:

1. A **Sound block** appears — source, mode, Depth. In static it is absent, not greyed.
2. The word **moves**, drawn as the letters swelling and subsiding, which is what `modulate()`
   actually does to the dials.
3. **Export becomes MP4** with a length, and a PNG of the frame you stop on stays available.
4. **The character set cannot move.** `Poster.tsx` already stops the sound when the layout is
   not `word`, because re-treating 69 glyphs per rebuild is beyond what the engine can afford —
   the heavy chains are near 7 fps on one word. So in video that layout is greyed *with the
   reason on the page*, rather than being selectable and inert.

A third state is drawn for recording, because it is the one that is easy to get wrong: the
Static / Video switch is the **only** thing disabled — turning a dial mid-take is the point of
recording a performance — the button becomes `Stop · Ns`, and the existing rule holds that
nothing about leaving may cost a take, so the × finishes and saves.

**The Figma file is three pages now**, split on Hendri's instruction because the work had become
two environments: **Workbench**, **Share**, and **Presets, components & reference**. The band
numbers restart per page. This supersedes the one-page consolidation of 4 September, which was
right when everything was one screen's worth of work.

## Design source of truth

The original Figma file lived in the SwissBorg org and was deleted deliberately when that
access ended. A new one was started on 4 Sept 2026 as the board for the next layout pass:
`https://www.figma.com/design/ie27RUJUSlkglzarqTMZIO`. **One page, seven sections**, in
reading order — a cover block at the top lists them:

Reorganised into three pages on 7 September — **Workbench**, **Share** and **Presets,
components & reference** — so the table below reads as history rather than as the current
band numbering.

| | | |
| --- | --- | --- |
| 01 | Where we are | The shipped app screenshotted at 1440, plus two sheets as real vectors. |
| 02 | Rebuilt as editable layers | The workbench at 1280 and the sheet overlay at 1440 as auto-layout frames over local components, bound to a `Letterpress` variable collection carrying the light and dark palettes from `index.css`. Treated type, glyph grid and size ladder are real vectors from the engine. |
| 03 | What the research changed | Seven findings measured from foundry DOM and design-tool documentation. |
| 04 | Element studies | Six dials, six layer lists, six size-ladder placements, each with its reasoning. |
| 05 | Layout variations | A, B, C move the furniture; A1–A3 take the chosen direction further — no brand mark on the workbench, the font name top left, `Save font` / `Share` / `Download .ttf`, a layer that cannot be removed while it is the only one, no disclosures, and Sizes kept beside the panel. |
| 06 | Screen explorations | D a drawn sheet of paper, E a dark studio with a tabbed canvas, F a floating-panel canvas, and G resolving what Share does. |
| 07 | Components and tokens | Button (eight styles), Select, Dial, Layer row, Tooltip, Share panel, two mono labels. |

None of it is a source of truth.

**The code is the source of truth for the design.** That is the honest position now, and it
mostly always was: `src/index.css` carries the type scale, the paper-and-ink palette and the
8-pt grid, and `scripts/figma-export.ts` regenerates the treated type as real vector
whenever a file is wanted again.

The one thing lost with the file is the layout exploration, which was never in the repo.
Worth knowing that it existed and what it concluded: three variations were drawn, **C
(export + saved styles) was chosen and is what shipped**. Variation B — plate full width,
waterfall beside the rail — was never built and is still the best candidate for the next
layout pass.

## Artifact

`https://claude.ai/code/artifact/44e1246f-b539-46f0-b194-855c04e10fbc` — a preview vehicle,
not the product. It is 2.4 MB because the source fonts and the worker are inlined so the
download works with no server, and it saves through the host's `downloads` capability
because artifact pages may not start a download themselves. **A real deployment needs none
of that** — see DEPLOY.md.
