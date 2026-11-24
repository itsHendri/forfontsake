# Images and grounds

What Compose prints a sheet on besides the four grounds in `src/lib/poster.ts` (Flat, Screen, Grid, Tooth), and how to make more of them.

## Rules

- A ground is drawn in code wherever it can be. Code grounds cost no download and take their colours from the sheet's palette.
- A material that code can't fake (paper, cloth, ink) is a black and white scan used as an ink mask, so it still recolours. It is never shown as a photo.
- No text or letterforms in a generated image. Type on a sheet always comes from the engine.
- Every ground keeps the word readable: ink cover stays light under the middle of the sheet.

## Scans

Nine textures, made with Seedream V5 (model `V5.5`, `image_size` `portrait_4_3`, 1536 × 2048, 5 credits a run). The finished files are greyscale PNGs in the brand folder, `assets/image/texture/fontsake-texture-<name>.png` (`-tile.png` for the three that repeat). The originals of every run, picked or not, are in the brand's `raw/assets/image/texture/`.

The site ships two JPEGs of each in `public/grounds/`: `<name>.jpg` and `<name>-thumb.jpg` at 225 × 300 for the picker. A full scan is 1152 × 1536 (quality 36 to 60, so 120 to 410 KB); a tile is 768 × 1024 (quality 60, 150 to 220 KB). The full file is fetched the first time someone picks that ground, never before, and goes into the sheet as a data URI: the sheet reaches the GPU as an SVG decoded as an image, and an image cannot fetch anything of its own. The code is `src/lib/grounds.ts`.

| Ground | File | Prompt (shortened) | Gain | Floor | Repeat |
|---|---|---|---|---|---|
| Ink roll | `brayer` | A dry, almost empty ink roller pass on white paper: tiny ink specks and thin streaks, mostly white paper, horizontal. | 1.1 | 0.02 | |
| Linen | `linen` | Very fine, dense bookbinding cloth: hair-thin threads in a tight weave too small to count, low relief, soft contrast, light grey. | 0.65 | 0.3 | |
| Crumpled | `crumpled` | A large sheet of white paper seen from far away, crumpled and flattened, many small creases spread evenly. | 1.3 | 0.03 | |
| Kraft | `kraft` | Recycled kraft card: fibres, flecks, small inclusions. | 3 | 0.56 | |
| Newsprint | `newsprint` | Uncoated newsprint paper, close up: faint short fibres, a few small grey flecks, very soft texture, nearly white. | 3.6 | 0.11 | |
| Photocopy | `photocopy` | A worn photocopy of a blank white page: scattered black toner specks, a few faint streaks top to bottom, mostly white. | 2.5 | 0.03 | |
| Concrete | `concrete` | Smooth pale concrete: tiny pinhole pores and fine dark speckles spread evenly, faint soft tonal variation. | 1.6 | 0.22 | 360 |
| Washi | `washi` | Japanese mulberry washi held against the light: long thin fibres criss-crossing, soft cloudy patches, mostly light. | 1.08 | 0.15 | 360 |
| Watercolour | `watercolour` | White cold-press watercolour paper under low raking light: small irregular bumps spread evenly. | 1.6 | 0.14 | 360 |

Every prompt is a flat-bed scan or a straight-on photo, black and white, filling the frame edge to edge, and ends with "no border, no text, no letters". Check every result by eye for stray letters before using it.

Keep the tone exactly when converting. The masks cut close to the scan's own grey, so a few percent decides whether the sheet takes a texture or a flood of ink. macOS's "Generic Gray Profile" darkened linen and kraft by 7% and flooded them; "Generic Gray Gamma 2.2 Profile" keeps the tone. Baking the mask into the file does not save bytes: the grain is what costs them. To set a new scan's gain and floor, measure its lightness percentiles: a floor near `1 − (p50 + p90) / 2` leaves the lightest third as bare paper, and a gain that brings the darkest 1% to about 0.4 keeps the word readable. Aim for a mean ink cover around 0.06 to 0.12.

### Repeating scans

A scan with a `tile` width is drawn as a pattern that many units wide (4:3 tall) and repeated, which makes its grain finer than a scan stretched over the whole sheet. The tile has to be seamless and flat:

1. Seamless, in two passes, horizontal then vertical: the image shifted by half along that axis underneath, the image itself on top through a mask that is clear at that axis's edges and opaque across the middle 40%. Doing both axes in one pass leaves the shifted copy's seams showing along the tile's edges.
2. Flat: subtract a wide blur (σ 28 on a 768 × 1024 tile) and add back the mean, measured over the tile repeated 3 × 3 so the edges see their neighbours. Without this a patch of raking light repeats as a pattern.

Both steps are SVG filters rendered with resvg; there is no image library in the project.

### The ink mask

The scan's darkness becomes ink cover:

```
cover = gain × ((1 − luminance) − floor), clamped to 0…1
```

As an SVG filter on the `<image>`, over a paper rect:

```xml
<filter id="mask" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
  <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -0.2126 -0.7152 -0.0722 0 1" result="a"/>
  <feComponentTransfer in="a" result="band"><feFuncA type="linear" slope="{gain}" intercept="{-gain × floor}"/></feComponentTransfer>
  <feFlood flood-color="{palette ink}"/>
  <feComposite in2="band" operator="in"/>
</filter>
```

The floor removes the scan's own grey, so only its texture prints. The gain sets how heavy it is. Crumpled grid adds a drawn grid on top: a 30-unit square pattern, ink at 0.38 opacity, 1.1 wide.

## Code grounds

In `src/lib/grounds.ts`, after Flat, Screen, Grid and Tooth. They all take the palette (`ink`, `paper`, `mark`) and follow the `Ground` shape in `src/lib/poster.ts`.

- Cutting mat: inch squares of 104, centred, running to about 38 from the edge, with half lines between them. Ruler ticks at eighths fill the gap between grid and edge on all four sides. No numbers: the only figures on a sheet are the font's.
- Press sheet: crop marks at the corners 72 in, registration targets on three edges, and an 11-step tone bar at the foot followed by one block in `mark`.
- Grain gradient: three soft ellipses of ink (0.3 to 0.45 opacity), blurred and then dithered into grain printed at 40% of the ink.
- Grain bands: 12 vertical bands, each a gradient (0.26 to 0.32 at most) whose light point moves down band by band, dithered the same way, also at 40%.
- Truchet: quarter-circle tiles of 45, turned at random from a seeded PRNG. Stroke 4, ink at 0.13.
- Drafting sheet: a 45 grid, centred and running to about 38 from the edge, with a heavier line every fifth, dashed rays at 15, 30, 45 and 60 degrees from the grid's bottom-left corner (clipped to the grid), and a quarter arc. No numbers, no gradient.

### Grain dither

The grain grounds blur their shapes, add noise to the alpha, then cut at half:

```xml
<feGaussianBlur stdDeviation="150"/>                      <!-- the soft shape -->
<feTurbulence type="fractalNoise" baseFrequency="0.53" numOctaves="2"/>
<feColorMatrix values="… 2 0 0 0 -0.65"/>                 <!-- noise into alpha, gently stretched -->
<feComposite operator="arithmetic" k2="1" k3="1" k4="-0.5"/>
<feComponentTransfer><feFuncA type="discrete" tableValues="0 1"/></feComponentTransfer>
<feFlood flood-color="{palette ink}" flood-opacity="0.4"/> <feComposite operator="in"/>
```

Two things that went wrong:

- `baseFrequency` 0.5 gave no grain at all. At a sheet drawn at half size, the noise lands on its own lattice points, where it is flat. Use a value off the round number (0.53, 0.55).
- A stronger stretch makes the noise close to on or off, so a gradient starts with a hard edge, and reads harsh. Use a gentle stretch (`2 0 0 0 …`, `k3` 1).
- With an offset of -0.5 the bare paper still catches a few specks, and their density jumps where the blur's tail ends, which shows as a hard-edged empty patch. An offset of -0.65 keeps the bare paper clean.

resvg (used by `scripts/make-share-image.ts`) draws nothing for a filtered rect with `fill="none"`. Give it a fill; the filter replaces it anyway.
