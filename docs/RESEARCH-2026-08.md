# Research, August 2026 — diffusion typography, Book of Shapes, and the field

Two references were pulled apart to see what was worth taking. Both gave something, and one
of them turned into a treatment. This is the record of what they actually do, so nobody has
to reverse-engineer them a second time.

---

## "Reaction Diffusion Typography"

`claude.ai/code/artifact/4a4fc3e2-7283-43da-8fdf-934e7e310d8e` — a single-file HTML sketch,
Japanese UI, exports PNG, SVG and Lottie. The full source is worth reading before touching
`growth.ts`; it was fetched from the artifact frame and its main script is about 1,170 lines.

**It is not reaction-diffusion.** No Gray-Scott, no chemical field, nothing diffusing. The
name is atmosphere. What it actually runs is:

1. **Rasterise** the text to a canvas at 2× (`EXTRACT_SCALE`), oversampled specifically so
   small kanji counters survive as closed loops.
2. **Marching squares** over the bitmap to recover contours, in doubled coordinates so pixel
   corners are integers. Contours are then nested by point-in-polygon into a parent tree, and
   the whole character is drawn as one compound path with `fill-rule="evenodd"` — which is
   what makes holes-inside-holes come out right at any depth.
3. **Two forces per frame**, on the contour points:
   - `smoothPass()` — weighted neighbour averaging over a variable reach, pulling each point
     toward the local average. Curve-shortening; on its own it collapses the shape.
   - `relax()` — every point pushes off every other point within `relaxRadius`, via a spatial
     hash. On its own it explodes the shape.
   - each point is then **clamped** to `maxDisp` from where it started.
4. **Ramped in** over ~900 frames with a smoothstep, so the first seconds barely move.

The antagonism of 2-and-3 under the clamp is the whole effect, and it is **differential
growth** — the Anders Hoff / `inconvergent` differential line — not reaction-diffusion.

Also worth knowing: the Lottie export records frames, then emits path-morph keyframes. The
vertex count has to be identical across frames for Lottie to interpolate, so it computes RDP
keep-indices **once from frame 0** and reuses them for every frame. That trick is the reason
the export works, and it is the piece to steal if animated specimens ever get built.

### What we took, and the one thing we changed

The raster → marching-squares stage exists only because the sketch starts from arbitrary
canvas text. **We already have vector contours**, so the force loop drops straight onto our
`Ring[]` — no canvas, identical in the worker and the CLI, and deterministic per seed. That
is `src/engine/treatments/growth.ts`.

The change that mattered is **node insertion**, and it was not optional. The first cut of
Growth followed the sketch exactly: dense resample once, fixed point count, iterate. It
looked like nothing. Measured, the perimeter grew 5.7% over sixty steps, because a curve with
a fixed number of points and a smoothing term cannot get longer — so it cannot fold, and all
it can do is tremble. Adding insertion (split a segment when it stretches, drop a point when
it bunches, stop at a per-glyph budget) took the same sixty steps to a ~50% longer perimeter
and produced actual folding. See the Growth entry in `DECISIONS.md`.

---

## Book of Shapes

`bookofshapes.com`, by Nikolaj Sokolowski — a collection of generative SVG patterns, 100-odd
of them across grid / radial / noise / flow / isometric / organic / distortion / physics.

What is worth stealing is not the patterns:

- **Three or four sliders, plus a seed.** Every pattern page. No more. It is the same
  discipline as `primary` on our `ParamSpec`, and it is the reason the pages feel like
  objects rather than control panels.
- **Editorial lineage.** Each pattern carries a paragraph naming its algorithm and crediting
  it — Flow Lines cites "the evenly-spaced streamline placement of Jobard and Lefer (1997)"
  and names the tool it was built after. This is now `Treatment.story`, written for all seven.
- **"Make a poster."** The tuned pattern set on a numbered Swiss-style typographic sheet,
  with Roll again / Recolour / a seed readout. This is the single best idea on the site and
  is now `src/lib/poster.ts` — more natural for a type foundry than for a pattern library,
  because a specimen sheet is the form a foundry has always published in.
- **Copy for Figma**, sitting next to Download SVG. Trivial, and it removes the download
  round-trip for the common case.

---

## The field

Two clusters, and we are in neither.

**Image-effect tools** — dither, ASCII, halftone: Efecto, Ditther, Ladybug, ASCII Magic,
DitherEffect, MagicPattern, and ertdfgcvb's `play.ertdfgcvb.xyz` as the artful ancestor. A
crowded and currently fashionable space. All raster or video in, raster or video out. None of
them touch fonts.

**Type-effect tools** — ATOM (`atomtypelab.com`), SAMPL, TextStudio's Text Warper,
`maketext.io`, `generate.thehivemind.live`, Jumyoung Lee's tool collection. These do treat
letterforms, some very well, and several export clean SVG. **None of them export a font.**

Tools that produce an installable font from an existing one: essentially two.

| Tool | What it does | Catch |
| --- | --- | --- |
| Metaflop | Parametric Metafont construction → OTF, OFL | Builds letters from parameters rather than treating a face; server-side toolchain |
| Bevel Type Generator (Jumyoung Lee) | One treatment (bevel) → "a working OTF" | Single effect; output not independently checked |

So the position holds, and it is narrow enough to state in one line: **treatments applied to
an existing face, exported as a verified installable font, entirely client-side.** The Bevel
generator is the only thing in the category doing the same trick, on one effect. Worth
re-checking in six months.

The corollary for scope: the dither/ASCII/halftone direction is tempting and thoroughly
taken, and every tool there is raster. Fonts stay the point.
