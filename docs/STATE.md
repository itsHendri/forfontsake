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
| Engine (6 treatments) | Done. Grit, Bubble, Bleed, Outline, Extrude, Mosaic. |
| Live preview | Done. Type into the specimen itself. |
| Glyph grid, waterfall | Done. All 69 preview glyphs; 96→12 on the 8-pt grid. |
| **In-browser export** | **Done.** Same engine as the CLI, in a Web Worker. |
| Saved styles | Done, in-memory only — lost on reload. |
| CLI export + verification | Done. `build:font` + `verify:font` (7 checks). |
| Deployment | **Not started.** |

Seven source fonts ship, all OFL: Pirata One, Anton, Archivo Black, Bebas Neue,
UnifrakturCook, Abril Fatface, Pacifico.

## The two non-obvious mechanisms

Both are explained fully in `DECISIONS.md`; know they exist before touching either.

1. **You type into the specimen.** A transparent `<input>` sits over the treated outlines.
   It only lines up because treatments preserve advance widths *and* the source faces ship
   as metrics-only woff2 subsets in `public/fonts/preview/` (cut by `make-glyph-data`, never
   seen). Measured delta across all seven faces: **0.0 px**. The vertical position is
   measured from a hidden probe, not derived from font metrics.
2. **The download is built in the page.** `buildTreatedFont` — the same function the CLI
   runs — executes in a Web Worker over the real source bytes. Verified equal to the CLI
   output on Pirata One (1144 glyphs) and Anton (4095), and accepted by the browser's own
   sanitiser.

## Verified, and how

- `npm run typecheck` · `npm run test` (32) — both green.
- `npm run verify:font` — 7 checks: size, **ots-sanitize**, fontTools, **CoreText**,
  alternates actually substitute, ligatures still form, naming + Reserved Font Names.
- The browser export was checked by loading the result with `FontFace.load()`, which *is*
  OTS, and confirming glyphs draw.

**Known-failing, and why it is not a regression:** `verify:font`'s metric-parity check
compares raw glyph counts, so it always fails when built with `--alts > 1` (386 source vs
1144 with three cuts). All seven pass at `--alts=1`. A task to fix the check properly was
spun off separately.

## Debt, roughly in order of how much it matters

1. **Not deployed.** The single biggest gap — see `docs/DEPLOY.md`.
2. **Bundle is 877 KB** (266 KB gzipped) because the export worker is inlined
   (`?worker&inline`) so the published single-file page works. Every visitor downloads the
   font writer whether or not they export. Fix before launch; DEPLOY.md has the approach.
3. **Saved styles do not persist.** In-memory only.
4. **No OG share image.** `index.html` points at `/share.png`, which does not exist yet.
5. Treatments do not stack in the UI, though the engine takes a chain.
6. Uploading your own font is not wired up.
7. Big faces are slow to export — Anton is ~1,373 glyphs and three cuts of it is a 4 MB
   file that takes ~a minute in-browser. Honest about it now (the strip shows the glyph
   count and names the assembly phase) but not fast.

## Where things live

```
src/engine/          pure geometry + font writing, no DOM (browser-safe)
src/lib/             glyphData · render · urlState · exportFont
src/components/      Plate · ExportBar · GlyphGrid · Waterfall · Panel · Dial · Shelf
src/workers/         buildFont.worker.ts — the export, off the main thread
public/fonts/        7 sources + OFL.txt each; preview/ holds metrics-only subsets
scripts/             make-glyph-data · build-font · verify-font · inline-build · figma-export
out/                 build output and scratch — gitignored, safe to delete
```

`out/exports/` holds superseded scratch (old workbench builds, comparison SVGs). It used to
sit in `public/`, where Vite shipped 4.4 MB of it to every visitor.

## Design source of truth

Figma: `https://www.figma.com/design/TKbuhH0KFYuVEagpqcweRC` — its document name reads as
"Document" because the API cannot set it.

> **Access warning.** This file sits in the **SwissBorg org**, and that employment ends
> Monday. Once the account is deactivated the file goes with it, along with the Figma MCP
> connection here, which authenticates as `hendri@swissborg.com`. Duplicate it to a personal
> Figma account, or archive the frames to SVG, before then. The vector type is reproducible
> from `scripts/figma-export.ts`; the layout work in it is not. Page *Build* is the shipped design; page *Variations* has
three, of which **C (export + saved styles) was chosen and is what shipped**. Variation B's
idea — plate full width, waterfall beside the rail — is still unbuilt and is the best
candidate for the next layout pass.

The type in that file is real vector from `scripts/figma-export.ts`, not screenshots.

## Artifact

`https://claude.ai/code/artifact/44e1246f-b539-46f0-b194-855c04e10fbc` — a preview vehicle,
not the product. It is 2.4 MB because the source fonts and the worker are inlined so the
download works with no server, and it saves through the host's `downloads` capability
because artifact pages may not start a download themselves. **A real deployment needs none
of that** — see DEPLOY.md.
