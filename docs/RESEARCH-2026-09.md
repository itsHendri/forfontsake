# Research, September 2026 — Font Gauntlet, the field again, and the specimen stage

The August note (`RESEARCH-2026-08.md`) settled the positioning and gave us Growth and the
sheet. This one started from Dinamo's Font Gauntlet, which was shared as a reference for its
editing panel, and widened into two questions: what has appeared in the field since August,
and what the specimen sheet — the one thing here nobody else has — could become. Nothing in
this note was built. It ends with a ranked list, and the ranked list is in `DECISIONS.md`.

---

## Font Gauntlet

`fontgauntlet.com` — Dinamo's free proofing tool, built in-house, rebuilt and republished in
May 2021 after a community beta. The name is literal: a font is run through it to find its
weaknesses. Driven here with ABC Diatype Widths Variable loaded, the left rail top to bottom:

- **Text setting.** Size, tracking, leading; alignment, RTL, case; an auto-size that fits
  the text to the viewport; fullscreen. A language picker that marks languages with special
  forms, Sample Text (Title / Pangram / Paragraph / Wikipedia), glyph sets.
- **Family chips.** Standard / Mono / Mono Condensed / Mono Compressed / Rounded.
- **Variable Axes — the part worth studying.** `Play`, `Reset` and `Audio` (mic) for all
  axes together, then for *each* axis: its own play button, **two range handles on the
  track** bounding where the animation is allowed to travel, an easing select (Linear /
  Quad / Cubic / Quart / Quint), a `×1.0` speed multiplier, and its own mic toggle. Then
  `Generate Static Font File`.
- **Preset Styles** (every named instance), colour, OpenType features with their tags.
- **Views** along the bottom: `Plain` / `Waterfall` / `Styles` (every instance as a
  waterfall row) / `Glyphs` (a searchable glyph table) / `Present` (all chrome hidden, the
  axis panel floating under the type). `CSS Code` copies the current axis position.

**The weight / slant / mono sliders are variable-font axes, read from the font's `fvar`.**
Gauntlet has no fixed set; that trio is what Dinamo fonts ship. Weight and slant are the
registered `wght` and `slnt`. **Mono** is Dinamo's own `MONO` axis, 0–100, which morphs a
proportional design into a monospaced one — on Monument Grotesk the midpoint is the
"Semi-Mono" they sell as a cut, and Dinamo says the cut came out of playing with Gauntlet
([release note](https://abcdinamo.com/news/typeface-release-abc-monument-grotesk),
[v-fonts](https://v-fonts.com/fonts/monument-grotesk-variable)).

Export is a screenshot, the CSS values, or a static instance. Video export is claimed in
one review ([type.today](https://type.today/en/journal/var_animated_preview)) and denied by
a 2021 forum thread that says to screen-record instead
([Glyphs forum](https://forum.glyphsapp.com/t/exporting-an-animated-font-from-dinamo-to-a-video/13547));
**unverified**. Audio mode is confirmed in Dinamo's own newsletter as microphone volume
driving axis intensity ([issue 6](https://abcdinamo.com/newsletter/the-dinamo-update-issue-6-may-2021)).

### What maps onto us

| Gauntlet | Here today | Verdict |
| --- | --- | --- |
| Axis sliders | No axes. `DECISIONS.md` rules variable *export* unsafe (stale `gvar`). | Not the lesson. Our dials are our axes. Two geometric analogues would be safe to export: **Slant** (a shear on the outlines) and **Tracking** (a uniform advance change, which is exactly what the caret mechanism already tolerates). Weight is Bubble. Parked until the layout pass says whether they belong in the rail. |
| Per-axis animate: range handles, easing, speed, mic-per-axis | Sound drives the first four non-steady primary dials **in declared order** at 35% depth, one Speed for all (`Poster.tsx`, `modulate()`). | **The single best learning.** The user has no say in which dial listens to what, or how far it may swing. A per-dial *listens to: off / bass / mid / high / level* plus range handles is the direct translation. OpenMosh (below) does the same for image effects and it is the feature people cite. |
| `Present` view | The sheet always shows its rail. | A chrome-free toggle is small, and it is a better recording stage. Escape-to-finish semantics from "The sheet is a performance" carry over unchanged. |
| `Styles` view | `scripts/style-samples.ts`, CLI only. Presets are a list in the Panel. | Presets as a waterfall in the page is the same artefact, and it pairs with the hover-to-preview item already on the list. |
| Size / tracking / leading | Waterfall is a fixed ladder; the sheet has `Word size`. | Size is not needed yet. Tracking makes less sense over a grid. Parked with Slant. |
| `Generate Static Font File` | `Download .ttf` | Ours is the stronger version. But Samsa's per-instance download arrow suggests a sheet-side **Freeze this frame as a font**: every sound-driven frame is reproducible from its values, so a frame you like *is* a font, and nobody else can offer that. |
| Drop your font anywhere | `Upload your own…` in the font select. | Whole-window drop is the norm (Gauntlet, Wakamai Fondue, FontDrop). Cheap. |
| `CSS Code` | The URL is the state. | Already better; it needs a visible *Copy link* so people know. |

---

## The field, September update

The August position holds: **nothing living applies treatments to an existing face in the
browser and exports a verified installable font.** NaN's Glyph Filters still needs Glyphs
2.6 and its Glyphs 3 support is still "coming soon"; Prototypo shut in July 2020; FontArk is
gone; Metaflop builds letters from parameters rather than treating a face. Glyphr Studio,
FontStruct, BitFontMaker2, Birdfont and Calligraphr are all alive and all editors — none
treat.

New names since August, closest first:

- **TypeTrials** ([typetrials.com](https://typetrials.com), Pangram Pangram). A Gauntlet
  clone plus **Instagram post and story video export** and animated specimen pages, free
  with your own fonts. The nearest thing to our sheet, and worth watching.
- **tdbr.xyz Variable Font Animator** (Jean Böhm). A square **XY pad with an axis on each
  side**, kerning modes, in-browser video recording. The best direct-manipulation UI in the
  group.
- **Vartype** ([vartype.com](https://www.vartype.com), Space Type, beta). A kinetic stage
  for variable fonts with "sound-based sketches".
- **Space Type Generator** ([spacetypegenerator.com](https://spacetypegenerator.com)). One
  word, one dramatic treatment, export a clip. Processing under the hood.
- **Samsa** ([lorp.github.io/samsa](https://lorp.github.io/samsa/)). The deep variable-font
  inspector: a 2D designspace picker, and a static TTF download per instance.
- **Wakamai Fondue** relaunched in 2026 on LibFont
  ([pixelambacht](https://pixelambacht.nl/2026/a-new-wakamai-fondue/)); drop anywhere,
  CSS out, "fonts never leave your computer" as the pitch.
- Proofing siblings: FontDrop, Bulletproof Font Tester, Font Playground, v-fonts.

The image side is where the fashion is, and it has moved since August:

- **Ditther** ([ditther.com](https://ditther.com)) — 75 stackable effects, a *Shuffle /
  Remix* button, saved *Looks*, MP4 out; 1080p free, 4K paid.
- **Effect.app** — WebGL plus WebCodecs, MP4 at 60 fps, keyframes on a paid tier. The
  current best-practice export stack.
- **OpenMosh** ([open-mosh.vercel.app](https://open-mosh.vercel.app), open source) — a
  Svelte + WebGL2 PhotoMosh clone. A *Mosh* button builds a random effect stack, **any
  parameter can be bound to a frequency band**, BPM detection, WebM with the audio muxed.
  PhotoMosh's own free web app is gone; it is a paid desktop product now.
- **studio-ity** — riso, halftone, CMYK, mezzotint, pixel sort as a layer stack, with SVG
  for the plate-like ones. **halftone.tools** — a ZIP of colour-separated plates.
- **Paper Shaders** ([shaders.paper.design](https://shaders.paper.design)) — 28
  zero-dependency WebGL2 shaders under Apache-2.0: grain, dithering, halftone dots, CMYK,
  mesh gradients, every parameter exposed with copy-paste code.
- **Unicorn Studio** — layers not nodes, a built-in performance estimator; Codrops' 2026
  ["WebGL for Designers"](https://tympanus.net/codrops/2026/03/04/webgl-for-designers-creating-interactive-shader-driven-graphics-directly-in-the-browser/)
  credits the layer paradigm for why designers adopted it.
- **textmode.art** — WebGL2 image and video to textmode, nine export formats; ertdfgcvb's
  `play.ertdfgcvb.xyz` is still the artful ancestor.

Codrops' [2025 year in review](https://tympanus.net/codrops/2025/12/29/2025-a-very-special-year-in-review/)
says shader-driven work dominated and a real-time dithering shader "really took off"; Figma
Config 2026 shipped generative shaders. It is crowded, and every tool in it is raster in,
raster out, and none of them touch fonts. That is still our line.

---

## The specimen stage

The sheet is pure SVG — `buildPoster()` returns a string — and canvas appears only as a
sink, to rasterise a PNG or to feed the recorder. The engine has no raster anywhere, and the
docs are rightly proud of it. So the shader direction has to be framed as **a second layer
with its own name**, not as a change to what a treatment is:

- **Treatment** — geometry. Lives in the font. Exported as `.ttf` and as SVG.
- **Finish** (working name) — pixels. Lives on the sheet only. Paper grain, riso
  misregistration, dot gain, scanner drift, CRT and scanline, chromatic aberration, dither.
  Exported in the PNG and the clip. The SVG stays letterforms-only and the button says so.

The mechanism: the sheet's SVG is drawn to a canvas each frame already, for recording. Make
that canvas a WebGL texture and run one fragment shader per finish. Paper Shaders is
Apache-2.0 and has grain, dither and halftone ready to lift with attribution. A finish takes
the same `ParamSpec` shape as a treatment — three or four primary dials, `steady` where a
dial picks a mode — so the sound can ride it, and a finish never touches the seed.

SVG filters (`feTurbulence`, `feDisplacementMap`) were the vector-preserving alternative and
were rejected: renderers disagree on them, and at 1080×1350 at 30 fps they are too slow.

**The tension, stated plainly:** this would be the first raster in the product. The rule that
keeps it honest is *a finish never changes what the font is*, and a test can hold it — the
`.ttf` must be byte-identical with any finish on or off, which is the same kind of check that
proved `applyChain` (`STATE.md`, "Verified, and how").

---

## Export and clip

- **WebCodecs `VideoEncoder` plus a muxer** (mediabunny, mp4-muxer) encodes faster than
  realtime, with `MediaRecorder` kept as the Safari fallback. Effect.app and OpenMosh do
  this; a Three.js visualiser thread
  ([discourse](https://discourse.threejs.org/t/audio-reactive-3d-visualizer-three-js-web-audio-api-with-in-browser-mp4-export/92234))
  documents the stack with ffmpeg.wasm as the last resort. We are on
  `canvas.captureStream()` + `MediaRecorder` (`src/lib/videoRecorder.ts`): realtime-bound,
  capped at 15 s.
- **Platform-sized canvases.** We have 1080×1350 portrait. **1080×1920 story** is the obvious
  second (TypeTrials, Shots.so).
- **Colour-separated plates** for the screen treatments (halftone.tools, studio-ity). Cheap
  here because the marks are already geometry.

---

## Patterns worth stealing, ranked for us

1. **Per-dial sound binding with range handles** (Gauntlet, OpenMosh).
2. **Present mode** on the sheet (Gauntlet).
3. **Freeze this frame as a font** (Samsa's per-instance download, made ours).
4. **Presets as a Styles waterfall**, plus hover-to-preview (Gauntlet; already listed).
5. **XY pad** for two dials in one gesture (tdbr.xyz, Samsa's designspace).
6. **Whole-window drop target** for a font (everyone).
7. **Shuffle** that rolls the whole stack, not just the seed (Ditther, OpenMosh). Checked:
   both of our `Randomise` buttons roll only a seed — the Panel's rolls the chain seed, the
   sheet's rolls the sheet number. Neither picks a different treatment or preset.
8. **Story-size** sheet preset (TypeTrials, Shots.so).
9. **WebCodecs clip export**, MP4 with the audio in it, longer than 15 s (Effect.app, OpenMosh).
10. **Copy link** for the URL state (Wakamai's copy-CSS, Paper Shaders' copy-code).
11. **Plate export** for the screens (halftone.tools).
12. **Saved styles with thumbnails** on the shelf (Ditther's Looks).

---

## Hand-off for the layout pass

The export controls and the sheet rail are going to be moved around in a design file before
anything is implemented. So that the file starts from what exists, the exact labels today:

- **Sheet rail** (`src/components/Poster.tsx`): `Specimen No. NNN`; layout chips `Word` /
  `Character set`; `Randomise` · `Recolour`; `Word size` slider with `Drag the word to place
  it` and `Reset position`; a `Sound` block with `Play loop` / `Stop`, `Use mic` / `Stop mic`,
  a `Speed` slider ("low is a slow drift, high is eager") and `Record clip` → `Stop · Ns`;
  then `Download PNG` (busy: `Rendering…`) · `Download SVG`; `Copy SVG` · `Close`.
- **Export bar** (`src/components/ExportBar.tsx`): the `Font name` field and one button,
  `Download .ttf` → `Treating… NN%` → `Assembling…` → `Download again`, with a meta line
  under it.
- **Plate** (`src/components/Plate.tsx`): font select ending in `Upload your own…`, the
  grouped treatment select, the blurb, and `View specimen`.

Things to try there, not decide here: one *Take away* group on the sheet (font / PNG / SVG /
copy / clip / link) instead of two rows of buttons; per-dial listen controls inside the Sound
block; a Present toggle; and where a Finish picker would sit relative to the treatment picker
— beside it as a second family, or on the sheet only. `STATE.md` still records that layout
Variation B (plate full width, waterfall beside the rail) was drawn, never built, and is the
best candidate for the next layout pass; it should be on the board too.

---

## Interface patterns, measured

A second pass, after the first layout variations came back too alike. This one is about the
parts rather than the page: how foundries set a size ladder, how design tools build a numeric
row, how layers lists behave, and whether hand-drawn chrome survives contact with a real tool.
Measured from the live DOM at 1440×900 where possible, so these are numbers rather than
impressions. The explorations are in the Figma file (see `STATE.md`).

### The size ladder — our left gutter is not a convention

Of the foundries checked, **none puts the size in a left gutter**. There are three placements
in production and a fourth position of showing nothing at all:

| Where the number goes | Who | Detail |
| --- | --- | --- |
| Above the line, same `x` as the type | Fontshare, Google Fonts, Adobe Fonts | Fontshare: label `x=20`, specimen `x=20`, 10 px between them. Google: both at `x=32`. |
| Inline, as a superior figure after the style name | Klim, Pangram Pangram | Klim sets the style name *in* that style, then the weight as a 12 px `#555` span with `vertical-align: top`. |
| Per-row controls above the line | Sharp Type, OH no | The only true descending ladder found; every row has its own size slider sharing the specimen's left edge. |
| Nothing at all | Grilli Type, Dinamo | Zero size labels in the DOM. Different sample text per row instead. |

A second pass over eight foundries, measured the same way, sharpened this and corrected one
claim I had made too strongly:

1. **The label is small and low-contrast.** Usually the site's UI sans — Klim sets its size
   readout in Söhne at 16 px on `#555`. But **Dinamo does use mono**: Monument Grotesk Mono at
   9.6 px, and its whole size row fades in on hover (`opacity: 0` until then). So mono is
   defensible if it is genuinely tiny, which is worth knowing for a tool that already has a
   mono accent.
2. **No rules between rows.** Universal. Whitespace separates — 24 px on Fontshare, 46 px on
   Google — or a faint card tint does it (Dinamo, `#F5F8FA`).
3. **The number is a readout on a control, not a caption.** Klim, Dinamo and Pangram Pangram
   all pair it with a size slider in a row above the line, left-aligned to the type. Grilli,
   OH no and Commercial Type print no size at all — Commercial's sliders run on an abstract
   0–100 scale, so no pixel value is ever exposed. Since our ladder is fixed rather than
   dragged, this argues for discrete size chips over a printed number.
4. **A left gutter is fine for a style name, just not for a size.** Grilli puts the style name
   in a fixed column at `x=122` with the specimen indented to `x=296`. Colophon put its label
   *below* the line with an up-arrow pointing back at it — though that site is gone, folded
   into Monotype in March 2025.

Also worth taking: **the specimen line is `contenteditable` almost everywhere** (Fontshare,
Google, Sharp, Grilli, Dinamo), which is the trick we already use on the plate; and Fontshare
offers **discrete size chips** rather than only a slider, which gets somebody to 16 px in one
click.

### The numeric row — the value is a box, not a caption

Framer, Figma, Rive and Jitter all make the number an input you can type into. Blender goes
further and is the most complete widget documented anywhere: **label, fill track and value
fused into one control**, with `<` `>` steppers appearing **on hover only**, `Ctrl` to snap,
`Shift` for precision, expressions and units in the field, `Esc` to cancel, `Tab` between
fields. For a 262 px panel with eight dials, the fused widget is the better fit than Figma's
three columns — Figma optimises for density we do not need.

On scrubbing: Photoshop, Sketch and After Effects all **drag on the label, not the number**,
because dragging the value fights text selection. Sketch's spec is the cleanest — label drag
±1, `Shift` ±10, `Option` ±0.1. Figma additionally picks speed from the cursor's vertical
position (2× / 1× / ½ / ¼).

On defaults, **Webflow tints the label** to say a value has been changed and resets on click.
That is a better answer than our tick on the track, and it solves "is this a lot?" without
looking at the track at all.

Reference numbers, from Tweakpane's shipped CSS: 20 px row, 4 px gap, 256 px panel, 11 px
mono, track and number sharing the row. Base UI's number field documents `pixelSensitivity: 2`,
`Alt` = 0.1, `Shift` = 10.

### Layers — the last one gets Clear, not a dead ×

Row heights run 22–32 px in the tools that treat layers as a list (Figma, Sketch, Framer,
Rive) and 40–100 px in the ones that show a picture (Photoshop, Affinity, Procreate). Figma
and Sketch hide the eye and lock until hover, then keep them visible once actually used.
Nesting is indentation everywhere; nobody draws connector lines.

The question we had — what the remove control does when only one layer is left — has a good
published answer. **Procreate substitutes the action: Delete becomes Clear**, which resets the
layer rather than removing it. That beats hiding the control (the row twitches as you add a
second layer) and it beats Figma's variant properties, where the delete button stays present
and simply does nothing.

### Hand-drawn chrome — rough the canvas, never the controls

Excalidraw and tldraw both keep **every panel, input and button an ordinary rectangle in an
ordinary UI sans**; only the drawing is rough. Excalidraw's own hand-drawn typeface is a
canvas option and is never used for interface copy — and it was replaced in 2024 explicitly
for legibility. The one load-bearing technique is a **persisted seed per element**: without it
the wobble re-rolls on every reload. Rough.js gets its look from double-stroking each line
rather than from per-point noise.

The counter-example is `wired-elements`, which advertises that "no two renderings will be
exactly the same" and is criticised for exactly that.

So the honest read on a drawn interface: it is available to us, our seeded PRNG already makes
it reproducible, and the credible tools all keep it off the controls. A drawn workbench is a
real position to take, but it is further than Excalidraw goes, not a safe default.

### What this changes

1. Move the size label above the line, at the type's own left edge, in Archivo at 12 px. Drop
   the rules between rows. This is the one clear defect the research found in what we ship.
2. Make dial values typeable. Prefer the fused widget — label, fill, value in one row — with
   steppers on hover.
3. Scrub on the label; tint the label when a value is off its default and reset on click.
4. On the last remaining layer, Delete becomes Clear.
5. If the drawn direction is taken, rough the borders and rules only, keep the seed, and leave
   type and inputs clean.
