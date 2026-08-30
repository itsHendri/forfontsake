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
| Engine (7 treatments) | Done. Grit, Bubble, Bleed, Outline, Extrude, Mosaic, Organic (id `growth`). |
| Stacking | Done. Up to three treatments in a row, in the UI, the URL and the export. |
| Live preview | Done. Type into the specimen itself. |
| Glyph grid, waterfall | Done. All 69 preview glyphs; the grid is also the override selection surface. |
| **Per-glyph overrides** | **Done.** Select glyphs → dial deltas over the global chain, per-glyph reroll; in the URL (7th field), the shelf and the export. |
| **In-browser export** | **Done.** Same engine as the CLI, in a Web Worker; overrides included. |
| Specimen sheet | Done. Instagram portrait 1080×1350, word and character set; word draggable/resizable; randomise, recolour, PNG/SVG/copy. |
| **Sound + clip** | **Done.** Bubble loop (synthesised) or mic drives the dials; Speed dial; Record clip → MP4/WebM with audio. |
| Saved styles | Done, and kept across reloads in `localStorage`. |
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
   so the geometry morphs; every frame is reproducible from its values. The audio analysis
   is FLUX's (MIT, same author), kept in `src/audio/` with attribution.

## Verified, and how

- `npm run typecheck` · `npm run test` (76, including override URL round-trips, the poster's
  word transform, the audio maths and the recorder's container choice) — both green.
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
   modulation depth (35% of each dial's span) and the bubble loop's mix deserve a pass on a
   phone and real speakers.

## Where things live

```
src/engine/          pure geometry + font writing, no DOM (browser-safe)
src/engine/extract   one font → outlines + licence; shared by the build script and the page
src/audio/           AudioEngine · sources (mic + bubble loop) · EnvelopeFollower ·
                     OnsetDetector · bands — FLUX's analysis stack (MIT), adapted
src/lib/             glyphData · render · urlState · savedStyles · exportFont · importFont
                     poster · videoRecorder · clipboard
src/components/      Plate · ExportBar · GlyphGrid · Waterfall · Panel · Dial · Shelf · Poster
src/workers/         buildFont.worker.ts — the export *and* reading an uploaded font
public/fonts/        7 sources + OFL.txt each; preview/ holds metrics-only subsets
scripts/             make-glyph-data · build-font · verify-font · inline-build · figma-export
                     make-share-image (regenerates public/share.png from poster.ts)
out/                 build output and scratch — gitignored, safe to delete
```

`out/exports/` holds superseded scratch (old workbench builds, comparison SVGs). It used to
sit in `public/`, where Vite shipped 4.4 MB of it to every visitor.

## Design source of truth

**There is no Figma file any more.** The original lived in the SwissBorg org and was deleted
deliberately when that access ended; a new one gets made later, from wherever the design has
got to by then. Do not go looking for it, and do not treat its absence as something to
restore.

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
