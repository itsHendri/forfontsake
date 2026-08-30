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
  /** the user's placement of the word; only the word layout reads it */
  wordTransform?: WordTransform
  /** per-character exceptions to the chain, exactly as the workbench has them */
  overrides?: Overrides
}

// Instagram portrait, 4:5 — the sheet is made to be posted.
export const SHEET_W = 1080
export const SHEET_H = 1350
const MARGIN = 76

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
  const small = (x: number, y: number, text: string, fill: string, size = 17, anchor = 'start') =>
    `<text x="${x}" y="${y}" font-family="${mono}" font-size="${size}" letter-spacing="2.4" ` +
    `fill="${fill}" text-anchor="${anchor}">${esc2(text.toUpperCase())}</text>`

  const number = String(req.number).padStart(3, '0')

  const head =
    `<line x1="${MARGIN}" y1="${bandTop - 60}" x2="${SHEET_W - MARGIN}" y2="${bandTop - 60}" ` +
    `stroke="${req.palette.ink}" stroke-width="2"/>` +
    small(MARGIN, bandTop - 80, "For Font's Sake", req.palette.ink) +
    small(SHEET_W - MARGIN, bandTop - 80, `No. ${number}`, req.palette.mark, 17, 'end')

  const foot =
    `<line x1="${MARGIN}" y1="${footTop}" x2="${SHEET_W - MARGIN}" y2="${footTop}" ` +
    `stroke="${req.palette.ink}" stroke-width="2"/>` +
    small(MARGIN, footTop + 38, `${chainName(req.chain)} on ${req.font.label} · Seed ${req.seed}`, req.palette.ink, 15) +
    small(SHEET_W - MARGIN, footTop + 38, 'forfontsake.xyz', req.palette.mark, 15, 'end')

  return { head, foot, small }
}

/** one word, set as large as the sheet will take it */
function bandWord(req: PosterRequest, bandTop: number, bandBottom: number) {
  const word = drawWord(req)

  // The type is set to the sheet rather than the sheet to the type. Fitting to
  // the measure alone would set a three-letter word at a size the sheet cannot
  // hold, so the height of the band caps it, and whatever is left over becomes
  // margin rather than overflow.
  const measure = SHEET_W - MARGIN * 2
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
  let placed = ''
  if (t && (t.dx !== 0 || t.dy !== 0 || t.scale !== 1)) {
    const cx = MARGIN + (word.width * scale) / 2
    const cy = blockTop + capHeight / 2
    placed =
      `translate(${t.dx}, ${t.dy}) translate(${cx}, ${cy}) ` +
      `scale(${t.scale}) translate(${-cx}, ${-cy}) `
  }

  return (
    `<g data-part="word" transform="${placed}translate(${MARGIN}, ${baseline}) scale(${scale}, ${-scale})">` +
    `<path d="${word.d}" fill="${req.palette.ink}" fill-rule="evenodd"/></g>`
  )
}

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

  const measure = SHEET_W - MARGIN * 2
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

export function buildPoster(req: PosterRequest): string {
  const footTop = SHEET_H - MARGIN - 64
  const bandTop = MARGIN + 96
  const bandBottom = footTop - 48

  const layout = LAYOUTS.find((l) => l.id === req.layout) ?? LAYOUTS[0]
  const { head, foot } = chrome(req, bandTop, footTop)
  const band = layout.id === 'chars' ? bandChars(req, bandTop, bandBottom) : bandWord(req, bandTop, bandBottom)

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SHEET_W} ${SHEET_H}" ` +
    `width="${SHEET_W}" height="${SHEET_H}">` +
    `<rect width="${SHEET_W}" height="${SHEET_H}" fill="${req.palette.paper}"/>` +
    head +
    band +
    foot +
    `</svg>`
  )
}
