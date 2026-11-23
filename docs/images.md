# Images and grounds

What Compose prints a sheet on besides the four grounds in `src/lib/poster.ts` (Flat, Screen, Grid, Tooth), and how to make more of them.

## Rules

- A ground is drawn in code wherever it can be. Code grounds cost no download and take their colours from the sheet's palette.
- A material that code can't fake (paper, cloth, ink) is a black and white scan used as an ink mask, so it still recolours. It is never shown as a photo.
- No text or letterforms in a generated image. Type on a sheet always comes from the engine.
- Every ground keeps the word readable: ink cover stays light under the middle of the sheet.

## Scans

Four textures, made with Seedream V5 (model `V5.5`, `image_size` `portrait_4_3`, 1536 × 2048, 5 credits a run). The finished files are greyscale PNGs in the brand folder, `assets/image/texture/fontsake-texture-<name>.png`.

The site ships two JPEGs of each in `public/grounds/`: `<name>.jpg` at 1152 × 1536 (quality 50, linen 40, so 135 to 460 KB) and `<name>-thumb.jpg` at 225 × 300 for the picker. The full file is fetched the first time someone picks that ground, never before, and goes into the sheet as a data URI: the sheet reaches the GPU as an SVG decoded as an image, and an image cannot fetch anything of its own. The code is `src/lib/grounds.ts`.

| Ground | File | Prompt (shortened) | Gain | Floor |
|---|---|---|---|---|
| Ink brayer | `fontsake-texture-brayer.png` | A dry, almost empty ink roller pass on white paper: tiny ink specks and thin streaks, mostly white paper, horizontal. | 1.1 | 0.02 |
| Bookcloth linen | `fontsake-texture-linen.png` | Fine, tightly woven bookbinding linen: small threads, crisp weave, a few slubs, high contrast between thread and gap. | 2.4 | 0.48 |
| Crumpled grid | `fontsake-texture-crumpled.png` | A large sheet of white paper seen from far away, crumpled and flattened, many small creases spread evenly. | 1.3 | 0.03 |
| Kraft | `fontsake-texture-kraft.png` | Recycled kraft card: fibres, flecks, small inclusions. | 3 | 0.56 |

Every prompt is a flat-bed scan or a straight-on photo, black and white, filling the frame edge to edge, and ends with "no border, no text, no letters". Check every result by eye for stray letters before using it.

Keep the tone exactly when converting. The masks cut close to the scan's own grey (linen's floor is 0.48 on a cloth averaging 0.47), so a few percent decides whether the sheet takes a texture or a flood of ink. macOS's "Generic Gray Profile" darkened linen and kraft by 7% and flooded them; "Generic Gray Gamma 2.2 Profile" keeps the tone. Baking the mask into the file does not save bytes: the grain is what costs them.

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

In `src/lib/grounds.ts`, after Flat, Screen, Grid and Tooth. They all take the palette (`ink`, `paper`, `mark`) and follow the `Ground` shape in `src/lib/poster.ts`. The numbers on the mat and the drafting sheet are single-stroke numerals drawn in code (`strokeNumber`), because the sheet cannot load a font.

- Cutting mat: inch squares of 104 inside a 70 margin, with half lines between them. Ruler ticks run along all four edges at eighths, and the axes are numbered.
- Press sheet: crop marks at the corners 72 in, registration targets on three edges, and an 11-step tone bar at the foot followed by one block in `mark`.
- Grain gradient: three soft ellipses of ink, blurred and then dithered into grain, so the sheet stays two-colour.
- Grain bands: 12 vertical bands, each a gradient whose light point moves down band by band, dithered the same way.
- Truchet: quarter-circle tiles of 45, turned at random from a seeded PRNG. Stroke 4, ink at 0.13.
- Drafting sheet: a 45 grid with a heavier line every fifth, numbered axes, dashed rays at 15, 30, 45 and 60 degrees from the bottom-left corner, and a quarter arc. No gradient.

### Grain dither

The grain grounds blur their shapes, add noise to the alpha, then cut at half:

```xml
<feGaussianBlur stdDeviation="110"/>                      <!-- the soft shape -->
<feTurbulence type="fractalNoise" baseFrequency="0.53" numOctaves="2"/>
<feColorMatrix values="… 4 0 0 0 -1.5"/>                  <!-- noise into alpha, stretched -->
<feComposite operator="arithmetic" k2="1" k3="0.9" k4="-0.45"/>
<feComponentTransfer><feFuncA type="discrete" tableValues="0 1"/></feComponentTransfer>
<feFlood flood-color="{palette ink}"/> <feComposite operator="in"/>
```

Two things that went wrong:

- `baseFrequency` 0.5 gave no grain at all. At a sheet drawn at half size, the noise lands on its own lattice points, where it is flat. Use a value off the round number (0.53, 0.55).
- A stronger stretch makes the noise close to on or off, so a gradient starts with a hard edge. For a smooth fade use a gentle stretch (`2 0 0 0 -0.5`, `k3` 1).

resvg (used by `scripts/make-share-image.ts`) draws nothing for a filtered rect with `fill="none"`. Give it a fill; the filter replaces it anyway.
