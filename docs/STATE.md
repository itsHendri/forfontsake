# Where the project is

Read this first in a new session, then `README.md` for how to run it and
`docs/DECISIONS.md` for why it is built the way it is.

**Repo:** `/Users/hendri/forfontsake` → `github.com/itsHendri/forfontsake` (public, `main`)
**Domain:** forfontsake.xyz — owned, **not deployed yet**. See `docs/DEPLOY.md`.
**Licence:** GPL-3.0-only (forced by `font-flux-js`; deliberate — see DECISIONS).

---

## What works today

The whole loop is real: **pick a font → apply a treatment → turn dials → download an
installable font**, entirely in the browser.

| Piece | State |
| --- | --- |
| Engine (7 treatments) | Done. Grit, Bubble, Bleed, Outline, Extrude, Mosaic, Growth. |
| Live preview | Done. Type into the specimen itself. |
| Glyph grid, waterfall | Done. All 69 preview glyphs; 96→12 on the 8-pt grid. |
| **In-browser export** | **Done.** Same engine as the CLI, in a Web Worker. |
| Specimen sheet | Done. Poster overlay — roll, recolour, PNG/SVG, copy for Figma. |
| Saved styles | Done, in-memory only — lost on reload. |
| CLI export + verification | Done. `build:font` + `verify:font` (7 checks). |
| Deployment | Build, Pages workflow and `CNAME` in. **Waiting on two settings** — see DEPLOY.md. |

Seven source fonts ship, all OFL: Pirata One, Anton, Archivo Black, Bebas Neue,
UnifrakturCook, Abril Fatface, Pacifico.

## The three non-obvious mechanisms

All are explained fully in `DECISIONS.md`; know they exist before touching any of them.

1. **You type into the specimen.** A transparent `<input>` sits over the treated outlines.
   It only lines up because treatments preserve advance widths *and* the source faces ship
   as metrics-only woff2 subsets in `public/fonts/preview/` (cut by `make-glyph-data`, never
   seen). Measured delta across all seven faces: **0.0 px**. The vertical position is
   measured from a hidden probe, not derived from font metrics.
2. **The download is built in the page.** `buildTreatedFont` — the same function the CLI
   runs — executes in a Web Worker over the real source bytes. Verified equal to the CLI
   output on Pirata One (1144 glyphs) and Anton (4095), and accepted by the browser's own
   sanitiser.
3. **Growth only works because it inserts points.** It is differential growth on the glyph's
   own contours, and the node insertion *is* the effect — the fixed-point-count version of it
   grows the perimeter 5.7% over sixty steps and looks like nothing. A per-glyph point budget
   caps it at 700, because folding is unbounded and points are bytes in the export.

## Verified, and how

- `npm run typecheck` · `npm run test` (43) — both green.
- `npm run verify:font` — 7 checks: size, **ots-sanitize**, fontTools, **CoreText**,
  alternates actually substitute, ligatures still form, naming + Reserved Font Names.
- The browser export was checked by loading the result with `FontFace.load()`, which *is*
  OTS, and confirming glyphs draw. Re-checked on Growth over Archivo Black: a 692 KB
  `font/ttf` blob, 1268 glyphs including 842 alternates, sfntVersion `0x00010000`, 18
  tables, accepted by `FontFace.load()`.
- All seven treatments were built at `--alts=2` and put through `verify:font` in one sweep —
  7/7 checks each, no regressions from the `story` field being added across the set.
- The specimen overlay (mechanism 1) was re-measured with Growth on its heaviest preset,
  since a *growing* treatment is the case most likely to break it: **-0.01 px** between the
  input's laid-out text and the drawn outlines.

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

## Debt, roughly in order of how much it matters

1. **Not deployed — and now only two switches away.** The build, the Pages workflow and the
   `CNAME` are all in. What is left is enabling Pages (Source: GitHub Actions) and pointing
   DNS at GitHub; neither can be done from a shell. `docs/DEPLOY.md` has both, with the
   records.
2. **Saved styles do not persist.** In-memory only.
3. Treatments do not stack in the UI, though the engine takes a chain.
4. Uploading your own font is not wired up.
5. Big faces are slow to export — Anton is ~1,373 glyphs and three cuts of it is a 4 MB
   file that takes ~a minute in-browser. Honest about it now (the strip shows the glyph
   count and names the assembly phase) but not fast.
6. The specimen sheet has one layout. Book of Shapes ships several and lets you page
   through them; the second layout is the cheapest good improvement here.

## Where things live

```
src/engine/          pure geometry + font writing, no DOM (browser-safe)
src/lib/             glyphData · render · urlState · exportFont · poster · clipboard
src/components/      Plate · ExportBar · GlyphGrid · Waterfall · Panel · Dial · Shelf · Poster
src/workers/         buildFont.worker.ts — the export, off the main thread
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
