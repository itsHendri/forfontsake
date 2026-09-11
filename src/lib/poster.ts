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
    id: 'screen',
    name: 'Screen',
    draw: (w, h, p) =>
      // Half the pitch it had. At 18 units a dot was nearly 4px on a sheet
      // shown at 852, which reads as spots on the paper rather than as a
      // screen; finer dots also carry more ink for the same weight, so the
      // opacity comes up as the radius comes down.
      `<defs><pattern id="ffs-screen" width="9" height="9" patternUnits="userSpaceOnUse">` +
      `<circle cx="2.25" cy="2.25" r="1.15" fill="${p.caption ?? p.ink}" fill-opacity="0.22"/>` +
      `<circle cx="6.75" cy="6.75" r="1.15" fill="${p.caption ?? p.ink}" fill-opacity="0.22"/>` +
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
     * is flooded with the caption ink so the tooth belongs to the sheet's own
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
      `<feFlood flood-color="${p.caption ?? p.ink}" result="ink"/>` +
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
function treatWord(req: PosterRequest) {
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
function treatGlyphs(req: PosterRequest, chars: string) {
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

/** the character set the second layout shows, in the order it shows them */
const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,!?&'-"

/** the outlines a sheet is made of, before anything has been said about colour */
export interface SheetGeometry {
  readonly word: ReturnType<typeof treatWord>
  readonly chars: ReturnType<typeof treatGlyphs>
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
  let word: SheetGeometry['word'] | null = null
  let chars: SheetGeometry['chars'] | null = null
  const geo: SheetGeometry = {
    get word() {
      return (word ??= treatWord(req))
    },
    get chars() {
      return (chars ??= treatGlyphs(req, CHARS))
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

/**
 * The six marks the caption is made of, as rectangles on the sheet.
 *
 * The sheet is a canvas, so there is nothing in the document to click: a part
 * is found by asking which of these the pointer is inside. They are derived
 * from the same numbers `chrome` draws with — one `bandOf` between them — so
 * the thing you click and the thing you see cannot drift apart.
 *
 * The mono face the captions are set in is 0.6em wide per character, near
 * enough for a hit box, and the letter-spacing is added because it is a fifth
 * of the width again over a long line.
 */
export interface SheetPart {
  id: 'head-rule' | 'head-label' | 'number' | 'foot-rule' | 'foot-caption' | 'address'
  /** which layer owns it, and therefore which rail a click opens */
  layer: 'caption'
  x: number
  y: number
  w: number
  h: number
}

/** what a run of the caption's mono face measures, near enough to click */
function monoBox(text: string, size: number) {
  return { w: text.length * (size * 0.6 + 2.4), h: size * 1.25 }
}

export function sheetParts(req: Pick<PosterRequest, 'format' | 'number' | 'chain' | 'font' | 'seed'>): SheetPart[] {
  const { w, h } = getFormat(req.format)
  const { footTop, bandTop, headRule } = bandOf(h)
  const right = w - MARGIN
  // a rule is two units tall and impossible to hit, so it is clickable over a
  // band around itself — the same allowance a hairline gets in any editor
  const RULE_GRAB = 12
  const label = monoBox("For Font's Sake", 17)
  const number = monoBox(`No. ${String(req.number).padStart(3, '0')}`, 17)
  const caption = monoBox(`${chainName(req.chain)} on ${req.font.label} · Seed ${req.seed}`, 15)
  const address = monoBox('forfontsake.xyz', 15)
  return [
    { id: 'head-rule', layer: 'caption', x: MARGIN, y: headRule - RULE_GRAB / 2, w: right - MARGIN, h: RULE_GRAB },
    { id: 'head-label', layer: 'caption', x: MARGIN, y: bandTop - 80 - label.h, w: label.w, h: label.h },
    { id: 'number', layer: 'caption', x: right - number.w, y: bandTop - 80 - number.h, w: number.w, h: number.h },
    { id: 'foot-rule', layer: 'caption', x: MARGIN, y: footTop - RULE_GRAB / 2, w: right - MARGIN, h: RULE_GRAB },
    { id: 'foot-caption', layer: 'caption', x: MARGIN, y: footTop + 38 - caption.h, w: Math.min(caption.w, right - MARGIN), h: caption.h },
    { id: 'address', layer: 'caption', x: right - address.w, y: footTop + 38 - address.h, w: address.w, h: address.h },
  ]
}

/** what the rail calls the part you just clicked */
export const PART_NAMES: Record<SheetPart['id'], string> = {
  'head-rule': 'the head rule',
  'head-label': 'the name',
  number: 'the number',
  'foot-rule': 'the foot rule',
  'foot-caption': 'the chain',
  address: 'the address',
}

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
 * The whole alphabet, on a grid.
 *
 * Every glyph is drawn in its own cell at one size, so the sheet reads as a
 * comparison rather than a composition — which is the point of a character set
 * and is where an uneven treatment shows itself. The columns are chosen to fill
 * the band rather than fixed, so a face with fewer glyphs still fills the sheet.
 */
function bandChars(req: PosterRequest, bandTop: number, bandBottom: number) {
  const glyphs = sheetGeometry(req).chars
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
