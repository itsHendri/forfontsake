import { getTreatment, type Overrides } from '../engine/treatments/registry'
import type { FontData } from './glyphData'
import type { Step } from './urlState'
import { MARGIN, treatRun, treatGlyphs, inkOf, pathAt, rule, type Run } from './sheetDraw'
import { TEMPLATES, drawTemplate, getTemplate, pictureRect } from './templates'

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
 * `ink` and `paper` are the word and the ground. `mark` is the accent: it was
 * the sheet number and the address in the margins, which are gone, and it is
 * kept because the share image still uses it and the text templates that
 * replace the margins will want an accent of their own.
 */
export interface PosterPalette {
  ink: string
  paper: string
  mark: string
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
    id: 'screen',
    name: 'Screen',
    draw: (w, h, p) =>
      // Half the pitch it had. At 18 units a dot was nearly 4px on a sheet
      // shown at 852, which reads as spots on the paper rather than as a
      // screen; finer dots also carry more ink for the same weight, so the
      // opacity comes up as the radius comes down.
      `<defs><pattern id="ffs-screen" width="9" height="9" patternUnits="userSpaceOnUse">` +
      `<circle cx="2.25" cy="2.25" r="1.15" fill="${p.ink}" fill-opacity="0.22"/>` +
      `<circle cx="6.75" cy="6.75" r="1.15" fill="${p.ink}" fill-opacity="0.22"/>` +
      `</pattern></defs>` +
      `<rect width="${w}" height="${h}" fill="${p.paper}"/>` +
      `<rect width="${w}" height="${h}" fill="url(#ffs-screen)"/>`,
  },
  {
    id: 'grid',
    name: 'Grid',
    draw: (w, h, p) =>
      `<defs><pattern id="ffs-grid" width="48" height="48" patternUnits="userSpaceOnUse">` +
      `<path d="M48 0H0V48" fill="none" stroke="${p.ink}" stroke-opacity="0.16" stroke-width="1"/>` +
      `</pattern></defs>` +
      `<rect width="${w}" height="${h}" fill="${p.paper}"/>` +
      `<rect width="${w}" height="${h}" fill="url(#ffs-grid)"/>`,
  },
  {
    /*
     * Paper with a grain in it, which is what it always claimed to be.
     *
     * What it drew before was flat paper very slightly darker, for three
     * reasons at once. The frequency was 0.85, a period of about a pixel and a
     * fifth on a 1080 sheet, so it averaged to grey at any size anyone looks at
     * it. feTurbulence also writes a random *alpha*, and saturate does not
     * touch alpha, so the whole thing came out as a uniform half-opaque veil at
     * 14% — a dimmer, not a texture. And it never took the palette, so it was
     * the one ground that did not recolour with the sheet.
     *
     * Now: a coarse fractal noise, its alpha pushed into a narrow band so most
     * of the sheet stays paper and the grain is a sparse speckle rather than
     * fog — only the tail of the noise takes any ink at all — and the speckle
     * is flooded with the ink so the tooth belongs to the sheet's own
     * colours.
     */
    id: 'tooth',
    name: 'Tooth',
    draw: (w, h, p) =>
      `<defs><filter id="${TOOTH_ID}" x="0" y="0" width="100%" height="100%">` +
      `<feTurbulence type="fractalNoise" baseFrequency="0.22" numOctaves="3" seed="7" stitchTiles="stitch" result="n"/>` +
      `<feColorMatrix in="n" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0" result="a"/>` +
      `<feComponentTransfer in="a" result="band">` +
      `<feFuncA type="table" tableValues="0.6 0.12 0 0 0"/>` +
      `</feComponentTransfer>` +
      `<feFlood flood-color="${p.ink}" result="ink"/>` +
      `<feComposite in="ink" in2="band" operator="in"/>` +
      `</filter></defs>` +
      `<rect width="${w}" height="${h}" fill="${p.paper}"/>` +
      `<rect width="${w}" height="${h}" fill="none" filter="url(#${TOOTH_ID})"/>`,
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
 * geometry — the centre and the margin all round — so if the sheet's layout
 * ever moves, what the word snaps to moves with it instead of drifting out of
 * agreement.
 */
export function snapLines(format?: string): { x: number[]; y: number[] } {
  const { w, h } = getFormat(format)
  return {
    x: [MARGIN, w / 2, w - MARGIN],
    y: [MARGIN, h / 2, h - MARGIN],
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
  /** what the Sentence sheet sets; falls back to a pangram */
  sentence?: string
  palette: PosterPalette
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
  /** the lines a template sets; absent or blank means the copy bank's first set */
  copy?: string[]
}

// Instagram portrait, 4:5 — still the default, and what a request with no
// format set means. Kept as named constants because the share-image script and
// the hit-test both want the default sheet without asking for it.
export const SHEET_W = FORMATS[0].w
export const SHEET_H = FORMATS[0].h

/**
 * The band the type is set in: the sheet inside its margin.
 *
 * It sat between a head and a foot rule while the sheet carried a caption —
 * name, number, the chain, the address. Those had no real value on a post and
 * are gone; the text templates that replace them will say where text goes.
 */
function bandOf(h: number) {
  return { bandTop: MARGIN, bandBottom: h - MARGIN }
}



/**
 * The character set the grids show, in the order they show it.
 *
 * Letters and numerals only. The punctuation was there because the glyph data
 * has it, not because anybody wanted to look at a treated comma; on a grid it
 * was seven cells of specks at the end of the alphabet.
 */
export const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/** what the Sentence sheet sets when there is no sentence of your own */
export const PANGRAM = 'Sphinx of black quartz, judge my vow.'

/** the outlines a sheet is made of, before anything has been said about colour */
export interface SheetGeometry {
  readonly word: Run
  readonly chars: ReturnType<typeof treatGlyphs>
  /** "Aa", for the specimen */
  readonly pair: Run
  /** the sentence, a word at a time, so it can be broken into lines */
  readonly words: Run[]
}

/**
 * The treated outlines, kept for as long as the things they are made of stay
 * the same.
 *
 * Everything expensive about a sheet is here — the chain runs over every
 * letter — and almost nothing that changes about a sheet touches it. Picking a
 * colour, a texture, a size or a layout re-runs `buildPoster`, which without
 * this re-treated the word and, through the layout thumbnails, all sixty-nine
 * glyphs of the character set: on a stacked chain that is over a second, for a
 * change that alters some strings. The key is exactly what the geometry
 * depends on, so anything not in it is free.
 *
 * `chars` is a getter, so the character set is treated only if something
 * actually asks to see it — which the word layout never does until its
 * thumbnail is on screen.
 */
const geoCache = new Map<string, SheetGeometry>()
/** four is a layout switch, a seed roll and a step back, without holding much */
const GEO_KEPT = 4

export function sheetGeometry(req: PosterRequest): SheetGeometry {
  const key = [
    req.fontId,
    req.seed,
    req.word,
    req.sentence ?? '',
    JSON.stringify(req.chain),
    JSON.stringify(req.overrides ?? null),
  ].join('|')
  const hit = geoCache.get(key)
  if (hit) {
    // touched, so the least recently wanted is the one that goes
    geoCache.delete(key)
    geoCache.set(key, hit)
    return hit
  }
  let word: Run | null = null
  let chars: SheetGeometry['chars'] | null = null
  let pair: Run | null = null
  let words: Run[] | null = null
  const geo: SheetGeometry = {
    get word() {
      return (word ??= treatRun(req, req.word))
    },
    get chars() {
      return (chars ??= treatGlyphs(req, CHARS))
    },
    get pair() {
      return (pair ??= treatRun(req, 'Aa'))
    },
    get words() {
      return (words ??= sentenceOf(req).split(/\s+/).filter(Boolean).map((w) => treatRun(req, w)))
    },
  }
  geoCache.set(key, geo)
  if (geoCache.size > GEO_KEPT) geoCache.delete(geoCache.keys().next().value!)
  return geo
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

/** the sentence a request sets: its own if it has one, the pangram if not */
export function sentenceOf(req: Pick<PosterRequest, 'sentence'>): string {
  const own = req.sentence?.trim()
  return own && /\s/.test(own) ? own : PANGRAM
}

/** "Grit + Bleed" — what the sheet calls the stack */
export function chainName(chain: Step[]): string {
  return chain.map((s) => getTreatment(s.id).name).join(' + ')
}

/**
 * The sheets this can be set in.
 *
 * Several, because one layout makes the sheet a template and several make it
 * a specimen series — which is what a foundry actually publishes. They share
 * the ground and the margin and differ only in what is set inside it, so each
 * is a function and nothing else. The four were picked from the October
 * poster round (L1, L6, L7 and L8 in the Figma file): the word, every letter
 * and numeral on a drawn grid, a sentence at three sizes, and a specimen that
 * holds all of it. None of them carries any text of its own.
 */
export interface PosterLayout {
  id: string
  name: string
  /** one line for the control, saying what this sheet is for */
  note: string
  /** one of the four sheets, or a template from `templates.ts` that sets copy of its own */
  kind: 'sheet' | 'template'
}

export const LAYOUTS: PosterLayout[] = [
  { id: 'word', name: 'Word', note: 'One word, set as large as the sheet allows', kind: 'sheet' },
  { id: 'chars', name: 'Character set', note: 'Every letter and numeral, each in its own cell', kind: 'sheet' },
  { id: 'sentence', name: 'Sentence', note: 'A line at three sizes, so it reads as a face you could set text in', kind: 'sheet' },
  { id: 'specimen', name: 'Specimen', note: 'Aa, the word, and every letter and numeral on one sheet', kind: 'sheet' },
  ...TEMPLATES.map((t) => ({ id: t.id, name: t.name, note: t.note, kind: 'template' as const })),
]

/** the layout a request is set in; an unknown id falls back to the first */
export const getLayout = (id?: string): PosterLayout => LAYOUTS.find((l) => l.id === id) ?? LAYOUTS[0]

/**
 * Where a turn settles.
 *
 * Snapping is on by default here, which is the opposite of Figma and Canva:
 * they turn freely and hold Shift to snap. This sheet is one word on a page
 * with two rules on it, and a word that is a degree and a half off level is a
 * mistake rather than a choice, so the tool should be the one holding it
 * straight. Shift lets go, for the turn somebody actually means.
 *
 * Konva's transformer is the model for the shape of it: a snap is a pull
 * towards a value when you are already near it, not a coarser scale — so a
 * turn passing 43° lands on 45 and one at 37 stays where it is.
 *
 * The square angles get a wider pull than the fifteens, because upright,
 * sideways and upside down are the ones worth landing exactly on.
 */
export function snapAngle(deg: number, free = false): number {
  const at = ((deg % 360) + 360) % 360
  if (free) return at
  const square = Math.round(at / 90) * 90
  if (Math.abs(at - square) <= 6) return square % 360
  const step = Math.round(at / 15) * 15
  return Math.abs(at - step) <= 4 ? step % 360 : at
}

/** one word, set as large as the sheet will take it */
/** where the word sits on the sheet, in sheet units, before its drag offset */
export interface WordBox {
  x: number
  y: number
  w: number
  h: number
}

/**
 * The word's box as it looks mid-gesture, before the outlines have caught up.
 *
 * Resizing is shown on the GPU while the hand is down and baked into the
 * geometry on release, so between those two moments the box the sheet was
 * built with is the wrong size for the frame drawn over it. It grows about its
 * own centre, exactly as the placement does.
 */
export function liveBox(box: WordBox, ratio: number): WordBox {
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  return { x: cx - (box.w * ratio) / 2, y: cy - (box.h * ratio) / 2, w: box.w * ratio, h: box.h * ratio }
}

function placeWord(req: PosterRequest, bandTop: number, bandBottom: number) {
  const word = sheetGeometry(req).word
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
 * Glyphs in cells, one each, centred on their own advance.
 *
 * Shared by the character set and the specimen's foot. With `lines`, the grid
 * is drawn — every cell of the rectangle, the empty ones at the end included,
 * so the grid reads as a grid rather than as boxes round some letters.
 */
function glyphGrid(
  req: PosterRequest,
  glyphs: SheetGeometry['chars'],
  x0: number,
  y0: number,
  cols: number,
  cell: number,
  lines: boolean,
) {
  const rows = Math.ceil(glyphs.length / cols)
  const em = req.font.unitsPerEm
  // 62% of the cell leaves the letters room to breathe and keeps a descender
  // from touching the row beneath it
  const scale = (cell * 0.62) / em
  const asc = req.font.ascender
  let out = ''
  if (lines) {
    const ink = req.palette.ink
    const stroke = `stroke="${ink}" stroke-opacity="0.22" stroke-width="1.5"`
    const gw = cols * cell
    const gh = rows * cell
    let d = ''
    for (let c = 0; c <= cols; c++) d += `M${(x0 + c * cell).toFixed(1)} ${y0.toFixed(1)}V${(y0 + gh).toFixed(1)}`
    for (let r = 0; r <= rows; r++) d += `M${x0.toFixed(1)} ${(y0 + r * cell).toFixed(1)}H${(x0 + gw).toFixed(1)}`
    out += `<path d="${d}" fill="none" ${stroke}/>`
  }
  glyphs.forEach((g, i) => {
    const cx = x0 + (i % cols) * cell
    const cy = y0 + Math.floor(i / cols) * cell
    out += pathAt(g.d, cx + (cell - g.adv * scale) / 2, cy + cell / 2 + (asc * scale) / 2, scale, req.palette.ink)
  })
  return out
}

/**
 * Every letter and numeral, each in its own cell, the grid drawn.
 *
 * Every glyph is drawn at one size, so the sheet reads as a comparison rather
 * than a composition — which is the point of a character set and is where an
 * uneven treatment shows itself. The columns are chosen to fill the band, so
 * a story gets six across and a square eight.
 */
function bandChars(req: PosterRequest, bandTop: number, bandBottom: number) {
  const glyphs = sheetGeometry(req).chars
  if (glyphs.length === 0) return ''

  const measure = getFormat(req.format).w - MARGIN * 2
  const band = bandBottom - bandTop
  // Square cells: pick the column count whose grid comes closest to filling
  // the band without overflowing it.
  let best = { cols: 8, cell: 0 }
  for (let cols = 6; cols <= 12; cols++) {
    const rows = Math.ceil(glyphs.length / cols)
    const cell = Math.min(measure / cols, band / rows)
    if (cell > best.cell) best = { cols, cell }
  }
  const { cols, cell } = best
  const rows = Math.ceil(glyphs.length / cols)
  const originX = MARGIN + (measure - cols * cell) / 2
  const originY = bandTop + (band - rows * cell) / 2
  return glyphGrid(req, glyphs, originX, originY, cols, cell, true)
}

/**
 * Words broken into lines at a scale, greedily, never splitting a word.
 *
 * A word wider than the measure gets a line to itself rather than being
 * broken; `layoutSentence` sizes the type so that does not happen.
 */
function breakLines(words: Run[], space: number, measure: number, scale: number) {
  const lines: { run: Run; x: number }[][] = []
  let line: { run: Run; x: number }[] = []
  let x = 0
  for (const run of words) {
    const w = run.width * scale
    if (line.length > 0 && x + w > measure) {
      lines.push(line)
      line = []
      x = 0
    }
    line.push({ run, x })
    x += w + space * scale
  }
  if (line.length > 0) lines.push(line)
  return lines
}

/** the three sizes the sentence is set at, as shares of the largest */
export const SENTENCE_SIZES = [1, 0.6, 0.36]

/**
 * The sentence, three times, large to small, ragged right.
 *
 * The largest size starts at a seventh of the measure per em and comes down
 * until the longest word fits a line and all three blocks fit the band. Set
 * from the top, as a page of text is, rather than centred.
 */
function bandSentence(req: PosterRequest, bandTop: number, bandBottom: number) {
  const { words } = sheetGeometry(req)
  if (words.length === 0) return ''
  const data = req.font
  const measure = getFormat(req.format).w - MARGIN * 2
  const band = bandBottom - bandTop
  const em = data.unitsPerEm
  // Lines are spaced by the ink the words actually reach, not by the font's
  // box: Anton's box is half again its caps, which set its lines a third of a
  // line apart. Ascender to descender of what is there, with a little air.
  const inks = words.map((w) => inkOf(w.d)).filter((b) => b !== null)
  const inkTop = inks.length ? Math.max(...inks.map((b) => b.y1)) : data.ascender
  const inkBottom = inks.length ? Math.min(...inks.map((b) => b.y0)) : data.descender
  const lineH = (inkTop - inkBottom) * 1.06
  const space = data.glyphs[' ']?.adv ?? em * 0.25
  const widest = Math.max(...words.map((w) => w.width))

  let top = Math.min((measure * 0.15) / em, measure / widest)
  const blocks = (k: number) => SENTENCE_SIZES.map((f) => breakLines(words, space, measure, k * f))
  const heightAt = (k: number) =>
    SENTENCE_SIZES.reduce((h, f, i) => h + blocks(k)[i].length * lineH * k * f, 0) + 2 * lineH * k * 0.45
  for (let i = 0; i < 12 && heightAt(top) > band; i++) top *= Math.max(0.5, (band / heightAt(top)) * 0.99)

  let y = bandTop
  let out = ''
  blocks(top).forEach((lines, i) => {
    const k = top * SENTENCE_SIZES[i]
    for (const line of lines) {
      const baseline = y + inkTop * k
      for (const { run, x } of line) out += pathAt(run.d, MARGIN + x, baseline, k, req.palette.ink)
      y += lineH * k
    }
    y += lineH * top * 0.45
  })
  return out
}

/**
 * A foundry specimen: Aa, the word, and every letter and numeral.
 *
 * Built from the foot up. The set takes thirteen columns across the measure
 * and sits on the bottom margin; the word sits between two rules above it at
 * up to two-fifths of what is left; Aa takes the rest, standing on the upper
 * rule. Placed by the ink, not by the font's box, because a face with a tall
 * box — Anton's is half again its caps — would otherwise float in air.
 */
function bandSpecimen(req: PosterRequest, bandTop: number, bandBottom: number) {
  const geo = sheetGeometry(req)
  const measure = getFormat(req.format).w - MARGIN * 2
  const ink = req.palette.ink
  const cols = 13
  const cell = measure / cols
  const rows = Math.ceil(geo.chars.length / cols)
  const gridTop = bandBottom - rows * cell
  const gap = cell * 0.45
  let out = glyphGrid(req, geo.chars, MARGIN, gridTop, cols, cell, false)

  const lower = gridTop - gap
  out += rule(MARGIN, lower, measure, ink)

  const word = inkOf(geo.word.d)
  const pair = inkOf(geo.pair.d)
  const avail = lower - gap - bandTop
  let wordTop = lower
  if (word) {
    const k = Math.min(measure / word.w, (avail * 0.4) / word.h)
    const bottom = lower - gap
    wordTop = bottom - word.h * k
    out += pathAt(geo.word.d, MARGIN - word.x0 * k, bottom + word.y0 * k, k, ink)
  }
  const upper = wordTop - gap
  out += rule(MARGIN, upper, measure, ink)
  if (pair) {
    const room = upper - gap - bandTop
    const k = Math.min((measure * 0.85) / pair.w, room / pair.h)
    const bottom = upper - gap
    out += pathAt(geo.pair.d, MARGIN - pair.x0 * k, bottom + pair.y0 * k, k, ink)
  }
  return out
}

/**
 * What a layout sets in the band, for every layout but the word.
 *
 * In two parts because a template with a picture box keeps its picture on the
 * ground and its type above it: the picture effects run on the ground layer,
 * and the type should stay letterforms over a screened photograph rather than
 * being screened with it. Everything else has no picture of its own.
 */
function bandFor(
  id: string,
  req: PosterRequest,
  bandTop: number,
  bandBottom: number,
): { picture: string; type: string } | null {
  if (id === 'chars') return { picture: '', type: bandChars(req, bandTop, bandBottom) }
  if (id === 'sentence') return { picture: '', type: bandSentence(req, bandTop, bandBottom) }
  if (id === 'specimen') return { picture: '', type: bandSpecimen(req, bandTop, bandBottom) }
  const { w, h } = getFormat(req.format)
  return drawTemplate(id, req, { w, h, top: bandTop, bottom: bandBottom })
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
  // a template with a box of its own holds the picture there, not under everything
  if (req.backdrop && !getTemplate(req.layout)?.picture) {
    return (
      `<rect width="${w}" height="${h}" fill="${req.palette.paper}"/>` +
      `<image href="${req.backdrop}" x="0" y="0" width="${w}" height="${h}" ` +
      `preserveAspectRatio="xMidYMid slice"/>`
    )
  }
  return getGround(req.ground).draw(w, h, req.palette)
}

/**
 * Where the picture sits when a template holds it in a box, in sheet pixels.
 *
 * The room hands this to the GPU view so the picture effects stop at the
 * box's edge; null means the picture, if there is one, fills the sheet.
 */
export function pictureBoxOf(req: Pick<PosterRequest, 'layout' | 'format'>) {
  const { w, h } = getFormat(req.format)
  const { bandTop, bandBottom } = bandOf(h)
  return pictureRect(req.layout ?? '', { w, h, top: bandTop, bottom: bandBottom })
}

/** the sheet's own frame, so every layer is cut to the same size */
const wrap = (body: string, w: number, h: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" ` +
  `width="${w}" height="${h}">${body}</svg>`

export function buildPoster(req: PosterRequest): string {
  const { w, h } = getFormat(req.format)
  const { bandTop, bandBottom } = bandOf(h)

  const layout = getLayout(req.layout)
  const band = bandFor(layout.id, req, bandTop, bandBottom)
  const body = band ? band.picture + band.type : bandWord(req, bandTop, bandBottom)

  return wrap(ground(req, w, h) + body, w, h)
}

/**
 * The same sheet, cut into two images the size of the sheet.
 *
 * The live view composites these on the GPU rather than drawing one SVG,
 * because dragging the word can then be an offset on a texture instead of a
 * rebuild — and a rebuild re-runs the whole treatment chain, which is tens of
 * milliseconds on the heavy ones. The word layer is drawn with its placement
 * *offset removed* for exactly that reason: the offset becomes the uniform.
 * Scale and rotation stay baked, because a resampled word is a picture of
 * letters rather than letters — but they ride a uniform while the hand is
 * down and bake when it lets go, so a gesture costs one rebuild, not sixty.
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
  const { bandTop, bandBottom } = bandOf(h)

  const layout = getLayout(req.layout)
  // the same order the composed sheet uses: ground, then the band
  const paper = ground(req, w, h)

  // Only the word is an object; every other sheet is one picture on the
  // ground — except a template's picture box, whose type rides the word layer
  // so the picture effects screen the picture and not the letters. It is not
  // an object: there is no box, so nothing on it can be taken hold of.
  const whole = bandFor(layout.id, req, bandTop, bandBottom)
  if (whole !== null && whole.picture) {
    return { ground: wrap(paper + whole.picture, w, h), word: wrap(whole.type, w, h), wordBox: null }
  }
  if (whole !== null) return { ground: wrap(paper + whole.type, w, h), word: null, wordBox: null }
  const anchored: PosterRequest = {
    ...req,
    wordTransform: req.wordTransform ? { ...req.wordTransform, dx: 0, dy: 0 } : undefined,
  }
  const { markup, box } = placeWord(anchored, bandTop, bandBottom)
  return { ground: wrap(paper, w, h), word: wrap(markup, w, h), wordBox: box }
}
