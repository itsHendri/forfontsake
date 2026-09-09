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

---

## The share environment, measured

Added 6 September, before the sheet leaves its modal. The question was how tools whose job is
"make a post from my thing" arrange the canvas, the controls and the export — and how much of
our rail (Finish, Sound, a per-dial band table, five exits) the field thinks belongs on screen.
Where a site would not render headlessly (typetrials.com is an empty shell, tdbr.xyz refuses
the fetch, OpenMosh is client-rendered) the claim rests on docs, changelogs or third-party
write-ups and says so.

### Nobody exports from a modal, and nobody picks a size in one

- **Canva** ([download](https://www.canva.com/help/download-file-types/),
  [resize](https://www.canva.com/help/resize/)) — Share is an anchored panel off the top bar;
  inside it, Download is file type, scale, quality, transparent background, pages. Size is not
  there: *Resize & Magic Switch* is a separate top-bar dropdown of platform presets (Instagram
  Post, Story, YouTube thumbnail) plus custom pixels. Format is a design-time decision; download
  is a file dialog.
- **Adobe Express** ([change page size](https://helpx.adobe.com/lv/express/web/organize-your-designs/arrange-layers-and-pages/change-page-size.html))
  — the same split: a *Resize* left panel with Instagram 1080×1080, 1080×1350, 1080×566, Story;
  Download a separate top-right panel.
- **Kapwing** ([resize](https://www.kapwing.com/tools/resize)) — *Resize Canvas* in the right
  sidebar opens presets (16:9, 9:16, 4:5, 1:1, custom) with Fit / Fill-and-crop; Export is a
  separate top-right button.
- **Figma** ([export settings](https://help.figma.com/hc/en-us/articles/13402894554519-Export-formats-and-settings))
  — export is a section of the properties sidebar, stackable rows of scale · suffix · format.
  Size is the frame's, chosen from the frame tool's presets.
- **Shots.so** ([shots.so](https://shots.so/)) — a full-page editor; export is a top-bar button
  reading `1x · PNG` with a dropdown. Two fields.
- **Ray.so** ([ray.so](https://ray.so/)) — the whole page *is* the export environment: one
  bottom toolbar (theme, background on/off, padding chips, language), PNG / SVG / copy / share
  URL at its end. No modal anywhere.
- **Effect.app** ([features](https://effect.app/features)) — an export menu with a single
  *Image / Video* switch, then fps, size, container.
- **Unicorn Studio** ([docs](https://www.unicorn.studio/docs/getting-started/)) — an Export
  panel with four tabs: Image, Video, Embed, Code.
- **Jitter** ([changelog](https://jitter.video/changelog/)) — worth one line for a different
  reason: it changed its Instagram post preset from 1:1 to 4:5.

The pattern across all of them: the format is a property of the canvas, chosen with
platform-named chips, and "export" is a two-to-four-field popover — format, scale, sometimes
fps. Full-page editors dominate the category (Shots, Ray, Pika, Ditther); a modal appears only
as the final file dialog, never as the room the work happens in.

### What Instagram takes in 2026

Feed posts accept 4:5, 1:1, 1.91:1 and — since the 2025/26 change — **3:4 (1080×1440)**
natively, with grid thumbnails at 3:4; a 4:5 sheet shows uncropped in the feed and loses about
7% top and bottom on the grid ([SocialBee](https://socialbee.com/blog/instagram-aspect-ratio-and-image-size/),
[Social Media Today](https://www.socialmediatoday.com/news/instagram-adds-support-phone-camera-aspect-ratio-images/749205/)).
Stories and Reels stay 1080×1920. The practical chip set is **Post 4:5 · Square 1:1 · Story
9:16**, with 3:4 a candidate fourth; TypeTrials gets away with two (post, story). Keep
1080×1350 as the default and call it what it is.

### The audio-reactive tools keep the matrix off the front

- **Font Gauntlet** ([Dinamo, May 2021](https://abcdinamo.com/newsletter/the-dinamo-update-issue-6-may-2021))
  — "the higher the volume is, the higher the axis goes." One signal, one axis. The earlier
  note here crediting it with per-axis range handles could not be verified; treat that as
  unconfirmed.
- **OpenMosh** ([github](https://github.com/zivavu/OpenMosh)) and Neural Frames
  ([audio visualizer](https://www.neuralframes.com/audio-visualizer)) — the prosumer end: any
  parameter to any band, stems to parameters. Neural Frames ships an *Autopilot* that assigns
  the reactivity first and lets you refine after.
- **WebLight** ([music reactive](https://www.weblight.app/effects/music-reactive)) — fixed
  mappings behind named modes ("Disco", "Liquid Glass"). Kaleidosync — ten global sliders,
  reactivity baked into each scene. Patatap — no controls at all.

Consumer tools ship fixed or preset mappings plus one sensitivity control. A per-dial band table
is a pro feature, and even the pro tools add an automatic mode in front of it. Ours defaulted
to the table.

### Help on a dial

- NN/g, [Why So Many Info Tips Are Bad](https://www.nngroup.com/articles/info-tips-bad/) —
  the (i) is well understood for nice-to-know information; hover on desktop, tap on touch; keep
  it beside the control; assume most people never open it, so nothing essential goes in.
- Carbon, [tooltip usage](https://carbondesignsystem.com/components/tooltip/usage/) — a
  *definition tooltip* on the label where space is tight; a slider already shows its value
  while dragging, so don't add a second thing that moves.
- Blender's [tooltip guidelines](https://developer.blender.org/docs/features/interface/human_interface_guidelines/tooltips/)
  and Ableton's Info View (a persistent pane describing whatever is hovered) are the two other
  shapes: everything on hover with no icon, or one shared caption area.

The value stays visible while dragging; help sits behind something you ask, and it must not
change under the pointer.

### Per-layer versus document settings

- **Photoshop** — the Properties panel is context-sensitive: a layer selected shows its
  properties; nothing selected shows Canvas, Rulers & Grids, Guides.
- **Unicorn Studio** ([variables](https://www.unicorn.studio/docs/variables/)) — the same rule,
  stated: scene-level variables appear when no layer is selected.
- **Procreate** ([layer options](https://help.procreate.com/procreate/handbook/layers/layers-options))
  — layer options on the layer, canvas settings under a different entry point (the wrench).
- **STUDIO·ITY** ([dither](https://studio-ity.com/dither/)) — each effect layer carries its own
  controls, opacity and blend; the source and the render are global.
- **Ditther** ([v1.3](https://www.ditther.com/updates/v1-3/)) — *Looks* snapshot every setting
  at once: effect, filters, background, blend, grading. One picker instead of every slider.

"Nothing selected shows the document's settings" is the convention. Applied here: the sheet's
own settings (format, layout, palette) show when no Finish or Sound card is selected; a
selected card shows its dials beneath it.

### What this suggests, ranked

1. Share is a room, not a dialog — a view that replaces the workbench in the window, the sheet
   given the height (Shots, Ray, Pika, Ditther).
2. Format chips on the sheet — Post 4:5 · Square · Story 9:16 — not in the export (Canva,
   Adobe Express, Kapwing).
3. Export as a two-field popover: what · at what size (Shots' `1x · PNG`, Figma's row).
4. Sound as named modes plus Depth, the band table behind Advanced (WebLight, Font Gauntlet,
   Neural Frames' Autopilot).
5. The (i) on a dial, saying the same thing every time (NN/g, Carbon). Shipped.
6. Nothing-selected shows the sheet's settings; a selected card shows its own (Photoshop,
   Unicorn).
7. Looks — finish + palette + sound mode as one picture of *this* sheet — as the cheap first
   step, with Customise behind it (Ditther).
8. A share URL that reopens the sheet as it was (Ray.so). Nothing about the sheet is in the URL
   today.

### The screenshot record — what shipped products actually draw

The pass above read documentation. A second pass, 7 September, read Mobbin's screenshot library —
real shipped UI rather than help pages — and then took Ditther apart in the browser, because that
is the tool Hendri named as closest to what the share room should be. Three negative findings
first, because they are the strongest claims:

- **No app in the set puts effect sliders in a modal over its canvas.** Modals appear only for
  export, resize and format. Creative dials are always in a persistent rail, a persistent bottom
  tray, or a floating panel you can move.
- **No export screen returned contains an aspect-ratio control**, which confirms the
  documentation pass from a different kind of source.
- **No app shows document-wide and per-layer settings in one panel at once.** Per-layer settings
  replace the list in place; document settings live somewhere else.

The patterns worth taking:

- **Riveo** ([export sheet](https://mobbin.com/screens/a3b0cc43-2952-4161-972e-643d1cb4e530),
  [effect properties](https://mobbin.com/screens/d60f7063-a292-4337-bba3-4c6d7639daf1)) — the most
  useful screen found. Effect parameters are rows: enums as segmented scrollers, numerics as a
  slider with a right-aligned value **and a bind button on the row's right edge**. Binding is a
  property of the parameter, not a table beside it. Its export sheet compresses five settings into
  one summary row plus a disclosure.
- **Jitter** and **Rive** ([Jitter](https://mobbin.com/screens/46f65180-3df4-41aa-a62d-7a91632cc742),
  [Rive](https://mobbin.com/screens/a21ef588-6033-4665-b4dc-c734fdac0220)) — a `Design | Animate`
  segmented control at the very top of the rail, splitting static properties from time-based ones.
  Export is a top-right button, never inside the rail. This is the answer to a rail that has to
  hold a format picker, a finish, a sound block and five exits.
- **Squarespace** ([effect panel](https://mobbin.com/screens/9cf06d0a-eef3-48df-a4e7-0fd8b98d67ee))
  — an accordion of named treatments with only the selected one open, three sliders with
  right-aligned values, and **Shuffle Settings as the last item inside that panel**. Randomise
  belongs with the dials it randomises, not at the top of the rail. Ours is in the plate footer,
  which is the same argument.
- **Spotify's Create cover art** ([screen](https://mobbin.com/screens/5130c62a-ad89-44e8-8646-928b0dfb6d14))
  — fixed-ratio canvas, a tray of effect chips, and **two sliders that appear only once an effect
  is chosen**. "None" is a chip in the row, not a separate control.
- **Artlist** ([LUT grid](https://mobbin.com/screens/5b68fb42-f7ce-451c-ab2b-63e8bbc66789)) — one
  control re-renders every thumbnail at once. Applied here: changing the word or the layout should
  repaint all four finish thumbnails, so the picker always previews the current sheet.
- **Jitter's format dropdown** ([screen](https://mobbin.com/screens/1b82de67-4ac2-49d8-bf2b-50cd6c074cb4))
  — grouped rows with pixel dimensions right-aligned, sitting beside Export in the rail header.
  **Adobe Express** ([screen](https://mobbin.com/screens/adeda86c-a4cb-4741-8ff1-65bee742620a))
  draws each ratio as a proportionally-shaped tile labelled twice, ratio inside and name plus
  pixels underneath. **VEED** adds a `Fit & center | Fill & crop` control for content that does not
  fit, and calls the button "Duplicate & Resize" — a second ratio becomes a sibling rather than
  destroying the first composition.
- **Photoroom** ([layers](https://mobbin.com/screens/17875c39-0946-4b6b-a760-bb3868918e01)) — the
  document background is stated as a layer, with its opacity in the label.

### Ditther, taken apart

`app.ditther.com`, walked through in the browser on 7 September. It is the closest thing to what
the share room could become, and its structure is worth stating exactly:

- **Canvas centred on a dark ground**, sized to its content, nothing else competing.
- **Left rail, 170 px:** `EFFECTS (75)` with category chips (All, Color, Analog, Distort, Glitch,
  Print, Light, Artistic) over a five-column grid of thumbnails, then `ADJUSTMENTS` — twelve
  named rows, each a **fused slider**: label left, value right, and the track *is* the row's
  background fill. Twelve fit where five of ours would.
- **Right rail, 170 px:** `LOOKS (69)` — bundles as named thumbnails, with All / Effects Looks /
  Texture Looks / **Saved Looks** filters and a Save affordance — then `TEXTURE` and `DUOTONE`,
  each **gated by a toggle**, their controls greyed until it is on.
- **Floating Layers panel** over the canvas, left: `Background image · Image layer`, and adding
  text pushes a `Hello` text layer above it, each row with lock and eye.
- **Selecting a layer swaps the right rail** to that layer's properties — a text layer gives Edit
  your text, Font Size, Line Height, Letter Spacing, Opacity, Rotation, Font Weight, Blend Mode,
  Alignment, Color, then Stroke / Glow / Drop Shadow as toggle-gated sections.
- **Bottom floating dock** for what you can add: layers, adjustments, frame, images, mask, text.
- **Export is a top-right popover**: 720 / 1080 / 2K / 4K, PNG or JPG, Export. No ratio in it.

Two mechanisms carry most of its density, and both are cheap for us: **the toggle-gated section**
(a whole block dims rather than disappearing, so you can see what you are not using) and **the
fused slider row**. Between them, a 300 px rail can hold a treatment's dials, a finish and a
sound block without a disclosure anywhere.

The thing it changes is the framing rather than the furniture. Ditther is not an export dialog
that grew; it is a composer whose subject happens to be an image. The equivalent reading here is
that the workbench makes a **font** and the second room makes a **post** — which is an argument
about what the room is called as much as how it is laid out, and it is recorded as an open
question on the Figma board rather than settled here.

### The Tools shelf, walked

Hendri's own bookmarks (`hendri.design/bookmarks`, Tools, 61 links) were the next source. Five
were close enough to our problem to be worth opening; two of those repaid it.

**Unicorn Studio** ([getting started](https://www.unicorn.studio/docs/getting-started)) is the
most useful thing found in either research pass, because it is a shader tool that chose our
model and wrote down why:

> "Most shader-driven tools are node-based — build a graph, connect outputs to inputs,
> construct a pipeline. Unicorn Studio takes a different approach. You work with layers, just
> like Figma, Framer, or Photoshop."

Three details in it settle questions that are open here:

- **An effect's scope is where you put it.** "An effect can manipulate everything beneath it or
  just a single layer. Add an effect as a child of a layer and it will only affect that layer."
  That is a shipped answer to the global-versus-per-layer problem the rail keeps running into —
  Detail, Keep counters, and Finish are all the same question. The answer is not to pick a side
  per dial but to make the scope a position, and to let the position be visible.
- **The background is a layer that can be hidden but not deleted.** Our own rule — the last
  layer cannot be removed, so its control becomes Clear — is the same rule arrived at
  independently, which is the best evidence it is right.
- **Effects are grouped exactly as our treatments are** (Filters, Distortion, Blur, Lighting,
  Stylize, Misc, Custom against our Wear, Ink, Screens, Press, Structure), and each carries its
  own time-based animation with its own speed — a per-effect speed rather than one global one,
  which is worth remembering when the sound block gets its Speed dial.

Its Variables idea is the other thing worth stealing eventually: "almost any property can become
a named control that publishes with your scene". A sheet that exposed three promoted dials and
hid the rest is the same move.

**Paper Shaders** ([shaders.paper.design](https://shaders.paper.design)) has grown an *image
filters* group — paper texture, fluted glass, water — since the August note, and its parameter
panel is the shape ours should be. Presets sit **inside** the effect panel as a 2×2 of named
buttons (Default, Cardboard, Abstract, Details) directly above that effect's dials; then colour
swatches with hex fields; then a dozen rows of label, slider and a boxed numeric value —
including **`seed` exposed as an ordinary dial**, which is what we do. Under the canvas: "Click
to change the sample image", the Artlist move again. Above it: `copy link` and `open Paper`, so
the state is in the URL and there is a door into the full tool.

Three dead ends, recorded so nobody repeats them: **Modyfi** now 404s at its own domain;
**Unicorn Studio**, **Krea** and **Recraft** put the editor behind a signup wall, so their UI
here comes from documentation rather than from use; and **Supershort** is a UX-writing studio,
not a short-form content tool — that bookmark's description does not match the site.

What none of them do is worth stating too. Not one composes a **fixed-ratio social artefact** as
its main job: Unicorn ships components to the web, Paper Shaders is a library demo, Ditther
exports an image at a size you pick. The format-first framing — this is a 1080 × 1350 post, and
everything on screen serves that — is still unoccupied ground, and it is the same gap the
August note found around fonts.

---

## Direct manipulation, layers and transport, measured

A third pass, 9 September, for the questions Hendri's walk through the app raised that
the earlier passes had not covered. Ditther, Unicorn Studio, Paper Shaders, Riveo,
Jitter, Rive, Spotify and the Canva/Express format pickers were deliberately excluded —
they are written up above.

### Selecting and moving an object on a canvas

- **Konva's `Transformer`** (MIT) is the closest thing to a specification anyone
  publishes: eight anchors plus a `rotater` on a stalk, `anchorSize 10`,
  `anchorStroke 'rgb(0,161,255)'`, `anchorStrokeWidth 1`, `borderStroke` the same blue,
  `rotateAnchorOffset 50`, `rotationSnapTolerance 5`, `keepRatio true`, corner cursors
  `nwse/nesw-resize`. Its own snapping demo uses `GUIDELINE_OFFSET = 5` px and draws
  guides as 1 px dashed `[4, 6]` lines in that same blue, destroyed on `dragend`.
- **tldraw** snaps at **8 screen px** and — the interesting part — has **no rotation
  handle at all**: a hit area sits with its inside corner on the geometry's corner and
  the cursor becomes `nesw-rotate`. Source-available, not open source; production needs
  a key and the hobby key stamps a watermark, so it is a reference and not a dependency.
- **Figma** rotates by hovering just outside a bound, Shift snaps to 15°, and its snap
  guides are red. **Canva**'s are purple, its rotate handle is outside the border, and
  Cmd/Ctrl temporarily suspends snapping.
- **Polotno** is the ready-made version of all of this and is **$249/month** with no
  free tier, which settles it.

**What this suggests:** the numbers are unanimous enough to copy without choosing a
library — ~10 px anchors, a 1 px border, 5–8 px snap tolerance, one accent for both
handles and guides, guides dashed, Shift for 15° steps. The sheet is a WebGL canvas
with a reported `wordBox`, so the overlay is ours either way; Konva would bring a
stage we do not want. The open question is tldraw's handle-less rotate against a
visible stalk, which is a picture worth drawing both ways.

### Backgrounds

Kittl, Canva and Photoroom all agree on the shape: the background is **a special
bottom layer set by a one-click action**, never a free object you might drag. Kittl
puts them in a Textures library and adds "Use as Background" to any image's context
menu; Canva has a Backgrounds tab and "Set image as background"; **Photoroom's picker
is three tabs — AI / Color / Image — with upload in the first slot of Image**, under
"Start with", ahead of the preset categories. PosterMyWall is the same with a gradient
pair instead of textures.

**What this suggests:** Colour / Texture / Image tabs, upload first inside Image,
thumbnails in a grid, and a background swap that never changes what is selected.

### Layers carrying several effects

- **Figma**: effects are rows under the layer, each with its own eye and settings icon,
  drag to reorder, and order changes the render. It caps them per kind — 8 drop
  shadows, 8 inner shadows, 1 layer blur, 1 background blur, 2 noise, 1 texture.
- **Pixelmator Pro**: unlimited stacked effects applied **bottom to top**, drag to
  reorder, and an effect can be applied to several *layers* at once. An Effects layer
  affects everything below it — Unicorn Studio's rule again, from a different vendor.
- **Photoshop** nests `fx` under the layer with an eye per effect and a master eye.
  Photopea does the same and its multi-layer apply is an open bug.

**What this suggests:** the shipped pattern is indented effect rows with an eye each,
reorderable, order = render order. Multi-selecting *layers* to apply one effect is
common; **multi-selecting effects is done by nobody**, which answers Hendri's question
about ganging grain and riso — they gang by both being on, not by being co-selected.

### The number field

- **Blender** is the closest precedent for one rectangle holding everything: `<` and
  `>` triangles appear at the ends **only on hover**, the value sits in the middle, the
  fill is the background of the field, drag anywhere scrubs, Ctrl snaps, Shift is fine,
  click types, and expressions evaluate.
- **Figma** scrubs from the *label*, with cursor height selecting 2× / 1× / ½ / ¼ speed.
  **Webflow** uses Alt-drag inside the input and ↑/↓ for ±1. **Framer**'s `ControlType.Number`
  is a slider plus field by default and a stepper when asked.
- **The pill**: macOS Control Center's brightness and volume sliders are the reference —
  a thick rounded track whose fill *is* the value. iOS 26 added a neutral anchor so the
  fill can start mid-track, which is what our tick at the landing preset wants to be.

### Booleans

Figma renders a boolean component property as a **switch**. Framer's `ControlType.Boolean`
is a **checkbox** with optional labels, and its enums get a segmented control. Blender
uses checkboxes for options and pressed-in buttons for toggles. Paper Shaders exposes
`inverted` as a plain boolean, drawn as a switch in its playground.

**What this suggests, and what shipped:** switch for a state that stays on, segments for
named alternatives. That is what `kind` now encodes.

### Export formats

Everyone ships a set, not a file. **Transfonter** is five checkboxes (TTF/EOT/WOFF/
WOFF2/SVG) and a zip with the CSS and a demo page. **Glyphs 3** has an OTF tab with
`.otf` / `.woff` / `.woff2` checkboxes and a CFF-versus-TrueType radio. **Font Squirrel**
sells Basic / Optimal / Expert presets. **Fontshare** hands over OTF plus WOFF2; **Google
Fonts** hands over static TTFs plus the variable file where one exists.

**On variable fonts, the negative finding is the useful one:** no browser-based tool
lets a user pick axes and export a variable font. opentype.js documents that it cannot
write one (issue #788), samsa-core only writes static instances and says it is not
production ready, and the only real route is fontTools' `varLib` under Pyodide — tens
of megabytes. That is on top of our own blocker, which is that the engine has no
compatible masters to interpolate between.

### Play and mic

- **Chrome's autoplay policy** makes the gesture mandatory: an `AudioContext` created
  before a user gesture is suspended until something calls `resume()` in one. So a play
  control on the canvas is not a nicety, it is the thing that starts the audio.
- **Specterr** plays a beat-reactive canvas at 60 fps the moment a track is dropped.
  **Adobe Express**'s Animate-from-audio takes a recording or an upload first, then
  previews with a play button or the spacebar. **Kaiber** binds bass/mid/treble to a
  parameter per layer, which is our binding table by another name.
- **Chrome Music Lab's Spectrogram** puts a microphone button in the bottom control row.
  **Riverside** shows a level meter under the name, which is the ordinary way a product
  says "the mic is live" — and is what our sheet has never had.

**What this suggests:** a play affordance on the canvas for the first gesture, transport
under the canvas after that, and a level bar beside the mic button. Three of Hendri's
"the mic does nothing" causes are addressable this way; the fourth is that `SoundDrive`
is a difference rather than a level, so steady sound correctly settles to nothing.
