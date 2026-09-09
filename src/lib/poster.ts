import {
  getTreatment,
  applyChain,
  resolveChain,
  effectiveSeed,
  type Overrides,
} from '../engine/treatments/registry'
import { mulberry32 } from '../engine/prng'
import { ringsToPathD } from '../engine/svg'
import { toRings, type FontData } from './glyphData'
import { letterGrowth } from './render'
import type { Step } from './urlState'

/**
 * A specimen sheet, as a standalone SVG string.
 *
 * The point of it is that the thing you tuned becomes an object you can hand
 * somebody. A screenshot of a workbench is a picture of software; a numbered
 * sheet with the settings set in the margin is a specimen, which is what a
 * foundry actually publishes. It doubles as the site's share image, so the
 * card people see in Slack is a real output of the tool rather than a mockup
 * of one.
 *
 * Pure and dependency-free on purpose: the same function runs in the page for
 * the download and in a build script for `public/share.png`, and neither may
 * drag in the DOM.
 */

/**
 * What each layer of the sheet is coloured with.
 *
 * `ink` and `paper` are the word and the ground; `mark` is the accent the
 * margins use for the sheet number and the address. `caption` is the rules and
 * the two long label lines, and it defaults to `ink` — which is what it always
 * was, before the caption became a layer you could select and recolour on its
 * own.
 */
export interface PosterPalette {
  ink: string
  paper: string
  mark: string
  caption?: string
}

/**
 * Two-colour combinations only, in the letterpress register the site is built
 * in. A random hue pair would be a colour picker with extra steps; these are
 * chosen so every roll is printable.
 */
export const POSTER_PALETTES: PosterPalette[] = [
  { ink: '#15171b', paper: '#e7e4db', mark: '#be3a22' },
  { ink: '#274a9c', paper: '#f2ede2', mark: '#d8703a' },
  { ink: '#e7e4db', paper: '#15171b', mark: '#e0603f' },
  { ink: '#1d3b32', paper: '#e8e2d0', mark: '#c25a2c' },
  { ink: '#6b1f2a', paper: '#efe8dc', mark: '#2f4a7c' },
  { ink: '#f2ede2', paper: '#2b2440', mark: '#e9a13b' },
]

/**
 * What the sheet is printed on.
 *
 * Everything here is drawn rather than shipped: a gradient, a dot screen and a
 * ruled grid are a few tags each, and an asset would be a download every
 * visitor pays for whether or not they ever open this room. They take their
 * colours from the palette, so changing the ground colour changes the texture
 * with it rather than leaving it stranded on the old one.
 *
 * An uploaded image is the one exception and it is not in this list — it is a
 * property of the sheet, held by the page and embedded when the sheet is drawn.
 */
export interface Ground {
  id: string
  name: string
  draw(w: number, h: number, p: PosterPalette): string
}

const TOOTH_ID = 'ffs-tooth'

export const GROUNDS: Ground[] = [
  { id: 'flat', name: 'Flat', draw: (w, h, p) => `<rect width="${w}" height="${h}" fill="${p.paper}"/>` },
  {
    id: 'wash',
    name: 'Wash',
    draw: (w, h, p) =>
      `<defs><linearGradient id="ffs-wash" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="${p.paper}"/>` +
      `<stop offset="1" stop-color="${p.caption ?? p.ink}" stop-opacity="0.22"/>` +
      `</linearGradient></defs>` +
      `<rect width="${w}" height="${h}" fill="${p.paper}"/>` +
      `<rect width="${w}" height="${h}" fill="url(#ffs-wash)"/>`,
  },
  {
    id: 'screen',
    name: 'Screen',
    draw: (w, h, p) =>
      `<defs><pattern id="ffs-screen" width="18" height="18" patternUnits="userSpaceOnUse">` +
      `<circle cx="4.5" cy="4.5" r="2.4" fill="${p.caption ?? p.ink}" fill-opacity="0.18"/>` +
      `<circle cx="13.5" cy="13.5" r="2.4" fill="${p.caption ?? p.ink}" fill-opacity="0.18"/>` +
      `</pattern></defs>` +
      `<rect width="${w}" height="${h}" fill="${p.paper}"/>` +
      `<rect width="${w}" height="${h}" fill="url(#ffs-screen)"/>`,
  },
  {
    id: 'grid',
    name: 'Grid',
    draw: (w, h, p) =>
      `<defs><pattern id="ffs-grid" width="48" height="48" patternUnits="userSpaceOnUse">` +
      `<path d="M48 0H0V48" fill="none" stroke="${p.caption ?? p.ink}" stroke-opacity="0.16" stroke-width="1"/>` +
      `</pattern></defs>` +
      `<rect width="${w}" height="${h}" fill="${p.paper}"/>` +
      `<rect width="${w}" height="${h}" fill="url(#ffs-grid)"/>`,
  },
  {
    id: 'tooth',
    name: 'Tooth',
    draw: (w, h, p) =>
      `<defs><filter id="${TOOTH_ID}" x="0" y="0" width="100%" height="100%">` +
      `<feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" stitchTiles="stitch"/>` +
      `<feColorMatrix type="saturate" values="0"/>` +
      `</filter></defs>` +
      `<rect width="${w}" height="${h}" fill="${p.paper}"/>` +
      `<rect width="${w}" height="${h}" filter="url(#${TOOTH_ID})" opacity="0.14"/>`,
  },
]

export const getGround = (id?: string): Ground => GROUNDS.find((g) => g.id === id) ?? GROUNDS[0]

/**
 * Where the user has dragged and resized the word, in sheet pixels.
 *
 * Applied on top of the auto-fit: `scale` multiplies the fitted size about the
 * word's visual centre, then `dx`/`dy` move it. Absent (or identity) means the
 * sheet lays the word out exactly as it always has.
 */
export interface WordTransform {
  dx: number
  dy: number
  scale: number
  /** degrees clockwise, about the word's own centre; absent means none */
  rotate?: number
}

/**
 * The lines the word snaps to, in sheet units.
 *
 * Deliberately here rather than in the room: they are the sheet's own
 * geometry — the centre, the margin the type is set to, and the two rules the
 * head and the foot are drawn on — so if the sheet's layout ever moves, what
 * the word snaps to moves with it instead of drifting out of agreement.
 */
export function snapLines(format?: string): { x: number[]; y: number[] } {
  const { w, h } = getFormat(format)
  const { headRule, footTop } = bandOf(h)
  return {
    x: [MARGIN, w / 2, w - MARGIN],
    y: [headRule, h / 2, footTop],
  }
}

/**
 * A sheet size, named for the thing it is posted as.
 *
 * The size is a property of the sheet, not of the export: every tool in this
 * category — Canva, Adobe Express, Kapwing, Jitter — chooses it on the canvas
 * and keeps the download dialog to file type and scale, because you want to see
 * the composition at the size you are going to post it at. Nothing else in the
 * sheet is measured in absolute pixels; the margin is, and holds at all three.
 */
export interface SheetFormat {
  id: string
  /** what it is posted as, not what shape it is */
  name: string
  ratio: string
  w: number
  h: number
}

export const FORMATS: SheetFormat[] = [
  { id: 'post', name: 'Post', ratio: '4:5', w: 1080, h: 1350 },
  { id: 'square', name: 'Square', ratio: '1:1', w: 1080, h: 1080 },
  { id: 'story', name: 'Story', ratio: '9:16', w: 1080, h: 1920 },
]

/** the format a request is set in; an unknown id falls back to the first */
export function getFormat(id?: string): SheetFormat {
  return FORMATS.find((f) => f.id === id) ?? FORMATS[0]
}

export interface PosterRequest {
  font: FontData
  fontId: string
  chain: Step[]
  seed: number
  /** the word set large; falls back to the treatment's name */
  word: string
  palette: PosterPalette
  /** the sheet's number, shown in the margin */
  number: number
  /** which of LAYOUTS to set it in; out of range falls back to the first */
  layout?: string
  /** which of FORMATS to cut it to; out of range falls back to the first */
  format?: string
  /** the user's placement of the word; only the word layout reads it */
  wordTransform?: WordTransform
  /** which of GROUNDS to print on; an unknown id falls through to flat */
  ground?: string
  /**
   * An uploaded picture, as a data URL, filling the sheet under everything
   * else. It wins over `ground`, because choosing a picture is a louder
   * decision than choosing a texture.
   */
  backdrop?: string | null
  /** per-character exceptions to the chain, exactly as the workbench has them */
  overrides?: Overrides
}

// Instagram portrait, 4:5 — still the default, and what a request with no
// format set means. Kept as named constants because the share-image script and
// the hit-test both want the default sheet without asking for it.
export const SHEET_W = FORMATS[0].w
export const SHEET_H = FORMATS[0].h
const MARGIN = 76

/**
 * The band the type is set in, derived from whatever height the format has —
 * and the two rules that fence it, because the word snaps to those and they
 * must be the same numbers the sheet actually draws.
 */
function bandOf(h: number) {
  const footTop = h - MARGIN - 64
  const bandTop = MARGIN + 96
  return { footTop, bandTop, bandBottom: footTop - 48, headRule: bandTop - 60 }
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * The dial values, written the way a caption would write them. With more than
 * one treatment each is named, because "Amount 55" twice over says nothing about
 * which is which.
 */
export function settingsLine(chain: Step[]): string {
  return chain
    .map((step) => {
      const t = getTreatment(step.id)
      const dials = t.params
        .filter((s) => s.primary)
        .map((s) => `${s.label} ${step.params[s.key]}`)
        .join('   ')
      return chain.length > 1 ? `${t.name}: ${dials}` : dials
    })
    .join('   ·   ')
}

/**
 * Treat the word once and return it as a path plus the box it occupies.
 *
 * Deliberately the first cut of each letter rather than the cycling ones the
 * workbench uses: a specimen is a reference, and a sheet that redrew the same
 * letter differently each time would be showing off the randomness rather than
 * the treatment.
 */
function drawWord(req: PosterRequest) {
  const data = req.font
  // grown advances, as the exported font sets them — see render.ts
  const grow = letterGrowth(data, req.chain, req.seed)
  let d = ''
  let penX = 0
  for (const ch of req.word) {
    const g = data.glyphs[ch]
    if (!g) continue
    const rchain = resolveChain(req.chain, req.overrides, ch)
    if (g.rings.length > 0) {
      // one context across the stack, as everywhere else — see render.ts
      const ctx = {
        rng: mulberry32(effectiveSeed(req.seed, req.overrides, ch) + (ch.codePointAt(0) ?? 0) * 7919),
        unitsPerEm: data.unitsPerEm,
        strokeWidth: data.strokeWidth || data.unitsPerEm * 0.1,
        advanceWidth: g.adv,
        penX,
      }
      d += ringsToPathD(applyChain(toRings(g.rings), rchain, ctx), penX, 0)
    }
    penX += g.adv + (rchain === req.chain ? grow : letterGrowth(data, rchain, req.seed))
  }
  return { d, width: penX, ascender: data.ascender, descender: data.descender }
}

/**
 * Every glyph on its own, for the character-set sheet.
 *
 * Separate from drawWord because a grid needs each letter's own box to centre
 * it in, which a single run of path data cannot give back.
 */
function drawGlyphs(req: PosterRequest, chars: string) {
  const data = req.font
  const grow = letterGrowth(data, req.chain, req.seed)
  const out: { ch: string; d: string; adv: number }[] = []
  for (const ch of chars) {
    const g = data.glyphs[ch]
    if (!g || g.rings.length === 0) continue
    const rchain = resolveChain(req.chain, req.overrides, ch)
    const ctx = {
      rng: mulberry32(effectiveSeed(req.seed, req.overrides, ch) + (ch.codePointAt(0) ?? 0) * 7919),
      unitsPerEm: data.unitsPerEm,
      strokeWidth: data.strokeWidth || data.unitsPerEm * 0.1,
      advanceWidth: g.adv,
      penX: 0,
    }
    const gGrow = rchain === req.chain ? grow : letterGrowth(data, rchain, req.seed)
    out.push({ ch, d: ringsToPathD(applyChain(toRings(g.rings), rchain, ctx), 0, 0), adv: g.adv + gGrow })
  }
  return out
}

/**
 * How hard the next sheet arrives: dissolved into the last one, or in its place.
 *
 * The cross-fade is what makes a rebuild read as a morph rather than a jump,
 * and every rebuild the sound causes wants it — the letters are meant to swell
 * and subside, not cut. Changing the layout or the size is not that. It is a
 * choice the reader just made and is waiting to see, and half a second of the
 * old picture dissolving through the new one reads as the tool being slow to
 * agree. Those two land instantly; everything else still dissolves.
 *
 * Returned as the fade's starting value so it is the same number the shader
 * uniform takes, and so the rule sits in one named place rather than as a
 * condition inside an effect.
 */
export function dissolveFor(
  prev: { layout: string; format: string } | null,
  next: { layout: string; format: string },
): number {
  if (!prev) return 1
  return prev.layout === next.layout && prev.format === next.format ? 1 : 0
}

/** "Grit + Bleed" — what the sheet calls the stack */
export function chainName(chain: Step[]): string {
  return chain.map((s) => getTreatment(s.id).name).join(' + ')
}

/**
 * The sheets this can be set in.
 *
 * Two, and a way to page between them, because one layout makes the sheet a
 * template and several make it a specimen series — which is what a foundry
 * actually publishes and is the difference between an output and an artefact.
 * They share all their furniture and differ only in the band between the rules,
 * so a third is a function and nothing else.
 */
export interface PosterLayout {
  id: string
  name: string
  /** one line for the control, saying what this sheet is for */
  note: string
}

export const LAYOUTS: PosterLayout[] = [
  { id: 'word', name: 'Word', note: 'One word, set as large as the sheet allows' },
  { id: 'chars', name: 'Character set', note: 'The whole alphabet, treated' },
]

const mono = "'Roboto Mono', ui-monospace, monospace"

const esc2 = esc

/**
 * The marks every sheet carries, whatever is set in the band.
 *
 * Deliberately spare: the sheet is a post before it is a datasheet, so it says
 * what it is, which number it is, one caption line, and where it came from —
 * and leaves the rest of the surface to the type. The dial values still travel
 * with the sheet as the URL state, not as furniture.
 */
function chrome(req: PosterRequest, bandTop: number, footTop: number) {
  const { w: sheetW } = getFormat(req.format)
  const caption = req.palette.caption ?? req.palette.ink
  const small = (x: number, y: number, text: string, fill: string, size = 17, anchor = 'start') =>
    `<text x="${x}" y="${y}" font-family="${mono}" font-size="${size}" letter-spacing="2.4" ` +
    `fill="${fill}" text-anchor="${anchor}">${esc2(text.toUpperCase())}</text>`

  const number = String(req.number).padStart(3, '0')

  const rule = bandTop - 60
  const head =
    `<line x1="${MARGIN}" y1="${rule}" x2="${sheetW - MARGIN}" y2="${rule}" ` +
    `stroke="${caption}" stroke-width="2"/>` +
    small(MARGIN, bandTop - 80, "For Font's Sake", caption) +
    small(sheetW - MARGIN, bandTop - 80, `No. ${number}`, req.palette.mark, 17, 'end')

  const foot =
    `<line x1="${MARGIN}" y1="${footTop}" x2="${sheetW - MARGIN}" y2="${footTop}" ` +
    `stroke="${caption}" stroke-width="2"/>` +
    small(MARGIN, footTop + 38, `${chainName(req.chain)} on ${req.font.label} · Seed ${req.seed}`, caption, 15) +
    small(sheetW - MARGIN, footTop + 38, 'forfontsake.xyz', req.palette.mark, 15, 'end')

  return { head, foot, small }
}

/** one word, set as large as the sheet will take it */
/** where the word sits on the sheet, in sheet units, before its drag offset */
export interface WordBox {
  x: number
  y: number
  w: number
  h: number
}

function placeWord(req: PosterRequest, bandTop: number, bandBottom: number) {
  const word = drawWord(req)
  const { w: sheetW } = getFormat(req.format)

  // The type is set to the sheet rather than the sheet to the type. Fitting to
  // the measure alone would set a three-letter word at a size the sheet cannot
  // hold, so the height of the band caps it, and whatever is left over becomes
  // margin rather than overflow.
  const measure = sheetW - MARGIN * 2
  const band = bandBottom - bandTop
  const wordHeight = word.ascender - word.descender
  const scale = Math.min(
    word.width > 0 ? measure / word.width : 1,
    wordHeight > 0 ? band / wordHeight : 1,
  )
  const capHeight = wordHeight * scale
  const blockTop = bandTop + (band - capHeight) / 2
  const baseline = blockTop + word.ascender * scale

  // The user's placement rides on top of the auto-fit. Scaling is about the
  // word's visual centre so growing it does not shove it off the sheet.
  const t = req.wordTransform
  const spin = t?.rotate ?? 0
  let placed = ''
  if (t && (t.dx !== 0 || t.dy !== 0 || t.scale !== 1 || spin !== 0)) {
    const cx = MARGIN + (word.width * scale) / 2
    const cy = blockTop + capHeight / 2
    // Every part of the placement turns about the word's own centre, so
    // growing or spinning it does not also shove it off the sheet.
    placed =
      `translate(${t.dx}, ${t.dy}) translate(${cx}, ${cy}) ` +
      `rotate(${spin}) scale(${t.scale}) translate(${-cx}, ${-cy}) `
  }

  // The same rectangle the transform above puts the word in, minus the drag —
  // the canvas has no DOM to hit-test, so the pointer is tested against this.
  // Scaling is about the word's centre, so the box grows about it too. The box
  // stays *unrotated*: it is the word's own rectangle, and the room turns the
  // pointer back through the angle before testing it rather than growing the
  // box to the bounds of a spun one, which would claim empty corners.
  const grow = t?.scale ?? 1
  const w = word.width * scale
  const cx = MARGIN + w / 2
  const cy = blockTop + capHeight / 2
  const box: WordBox = {
    x: cx - (w * grow) / 2,
    y: cy - (capHeight * grow) / 2,
    w: w * grow,
    h: capHeight * grow,
  }

  const markup =
    `<g data-part="word" transform="${placed}translate(${MARGIN}, ${baseline}) scale(${scale}, ${-scale})">` +
    `<path d="${word.d}" fill="${req.palette.ink}" fill-rule="evenodd"/></g>`
  return { markup, box }
}

const bandWord = (req: PosterRequest, bandTop: number, bandBottom: number) =>
  placeWord(req, bandTop, bandBottom).markup

/**
 * The whole alphabet, on a grid.
 *
 * Every glyph is drawn in its own cell at one size, so the sheet reads as a
 * comparison rather than a composition — which is the point of a character set
 * and is where an uneven treatment shows itself. The columns are chosen to fill
 * the band rather than fixed, so a face with fewer glyphs still fills the sheet.
 */
function bandChars(req: PosterRequest, bandTop: number, bandBottom: number) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,!?&'-"
  const glyphs = drawGlyphs(req, chars)
  if (glyphs.length === 0) return ''

  const measure = getFormat(req.format).w - MARGIN * 2
  const band = bandBottom - bandTop
  // Square-ish cells: pick the column count whose resulting grid comes closest
  // to filling the band without overflowing it.
  let best = { cols: 8, cell: 0 }
  for (let cols = 6; cols <= 12; cols++) {
    const rows = Math.ceil(glyphs.length / cols)
    const cell = Math.min(measure / cols, band / rows)
    if (cell > best.cell) best = { cols, cell }
  }
  const { cols, cell } = best
  const rows = Math.ceil(glyphs.length / cols)
  const gridW = cols * cell
  const gridH = rows * cell
  const originX = MARGIN + (measure - gridW) / 2
  const originY = bandTop + (band - gridH) / 2

  const em = req.font.unitsPerEm
  // 62% of the cell leaves the letters room to breathe and keeps a descender
  // from touching the row beneath it
  const scale = (cell * 0.62) / em
  const asc = req.font.ascender

  return glyphs
    .map((g, i) => {
      const cx = originX + (i % cols) * cell
      const cy = originY + Math.floor(i / cols) * cell
      // centred on its own advance width, so a narrow letter is not left-aligned
      // in a cell it does not fill
      const x = cx + (cell - g.adv * scale) / 2
      const y = cy + cell / 2 + (asc * scale) / 2
      return (
        `<g transform="translate(${x.toFixed(1)}, ${y.toFixed(1)}) scale(${scale.toFixed(5)}, ${(-scale).toFixed(5)})">` +
        `<path d="${g.d}" fill="${req.palette.ink}" fill-rule="evenodd"/></g>`
      )
    })
    .join('')
}

/**
 * The ground, whatever it is: a picture if one has been uploaded, otherwise
 * the chosen texture, otherwise flat paper.
 *
 * The paper rect is drawn under a picture as well, because a transparent PNG
 * and a picture that does not cover the sheet both leave gaps, and a gap
 * should be the sheet's own colour rather than whatever the canvas was.
 */
function ground(req: PosterRequest, w: number, h: number): string {
  if (req.backdrop) {
    return (
      `<rect width="${w}" height="${h}" fill="${req.palette.paper}"/>` +
      `<image href="${req.backdrop}" x="0" y="0" width="${w}" height="${h}" ` +
      `preserveAspectRatio="xMidYMid slice"/>`
    )
  }
  return getGround(req.ground).draw(w, h, req.palette)
}

/** the sheet's own frame, so every layer is cut to the same size */
const wrap = (body: string, w: number, h: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" ` +
  `width="${w}" height="${h}">${body}</svg>`

export function buildPoster(req: PosterRequest): string {
  const { w, h } = getFormat(req.format)
  const { footTop, bandTop, bandBottom } = bandOf(h)

  const layout = LAYOUTS.find((l) => l.id === req.layout) ?? LAYOUTS[0]
  const { head, foot } = chrome(req, bandTop, footTop)
  const band = layout.id === 'chars' ? bandChars(req, bandTop, bandBottom) : bandWord(req, bandTop, bandBottom)

  return wrap(ground(req, w, h) + head + band + foot, w, h)
}

/**
 * The same sheet, cut into two images the size of the sheet.
 *
 * The live view composites these on the GPU rather than drawing one SVG,
 * because dragging the word can then be an offset on a texture instead of a
 * rebuild — and a rebuild re-runs the whole treatment chain, which is tens of
 * milliseconds on the heavy ones. The word layer is drawn with its placement
 * *offset removed* for exactly that reason: the offset becomes the uniform.
 * Scale stays baked, because resizing is debounced and can afford a rebuild.
 *
 * `buildPoster` remains the one composed sheet, and is still what the SVG
 * download and the clipboard hand over. A test pins the two against each
 * other, because two ways of drawing the same sheet is precisely the sort of
 * pair that drifts.
 */
export function buildPosterLayers(req: PosterRequest): {
  ground: string
  word: string | null
  wordBox: WordBox | null
} {
  const { w, h } = getFormat(req.format)
  const { footTop, bandTop, bandBottom } = bandOf(h)

  const layout = LAYOUTS.find((l) => l.id === req.layout) ?? LAYOUTS[0]
  const { head, foot } = chrome(req, bandTop, footTop)
  // the same order the composed sheet uses: ground, head, band, foot
  const paper = ground(req, w, h)

  if (layout.id === 'chars') {
    return {
      ground: wrap(paper + head + bandChars(req, bandTop, bandBottom) + foot, w, h),
      word: null,
      wordBox: null,
    }
  }
  const anchored: PosterRequest = {
    ...req,
    wordTransform: req.wordTransform ? { ...req.wordTransform, dx: 0, dy: 0 } : undefined,
  }
  const { markup, box } = placeWord(anchored, bandTop, bandBottom)
  return { ground: wrap(paper + head + foot, w, h), word: wrap(markup, w, h), wordBox: box }
}
