import { getTreatment, applyChain } from '../engine/treatments/registry'
import { mulberry32 } from '../engine/prng'
import { ringsToPathD } from '../engine/svg'
import { toRings, type FontData } from './glyphData'
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
}

const SHEET_W = 1200
const SHEET_H = 1600
const MARGIN = 92

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
  let d = ''
  let penX = 0
  for (const ch of req.word) {
    const g = data.glyphs[ch]
    if (!g) continue
    if (g.rings.length > 0) {
      // one context across the stack, as everywhere else — see render.ts
      const ctx = {
        rng: mulberry32(req.seed + (ch.codePointAt(0) ?? 0) * 7919),
        unitsPerEm: data.unitsPerEm,
        strokeWidth: data.strokeWidth || data.unitsPerEm * 0.1,
        advanceWidth: g.adv,
        penX,
      }
      d += ringsToPathD(applyChain(toRings(g.rings), req.chain, ctx), penX, 0)
    }
    penX += g.adv
  }
  return { d, width: penX, ascender: data.ascender, descender: data.descender }
}

/** "Grit + Bleed" — what the sheet calls the stack */
export function chainName(chain: Step[]): string {
  return chain.map((s) => getTreatment(s.id).name).join(' + ')
}

export function buildPoster(req: PosterRequest): string {
  const word = drawWord(req)

  const mono = "'Roboto Mono', ui-monospace, monospace"
  const footTop = SHEET_H - MARGIN - 300
  const bandTop = MARGIN + 114
  const bandBottom = footTop - 60

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

  const small = (x: number, y: number, text: string, fill: string, size = 19, anchor = 'start') =>
    `<text x="${x}" y="${y}" font-family="${mono}" font-size="${size}" letter-spacing="2.4" ` +
    `fill="${fill}" text-anchor="${anchor}">${esc(text.toUpperCase())}</text>`

  const number = String(req.number).padStart(3, '0')

  // The story, wrapped by hand — SVG will not do it, and a foreignObject would
  // not survive being rasterised by every tool people drop an SVG into. Cut to
  // whole sentences rather than to a line count: a caption that stops mid-
  // clause reads as a rendering bug, which on a specimen sheet is worse than
  // saying less.
  // With a stack there is no single story to tell, so the sheet carries the
  // last step's — it is the one that shaped what you are looking at.
  const last = getTreatment(req.chain[req.chain.length - 1].id)
  const lines = wrap(firstSentences(last.story ?? last.blurb, 300), 76)

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SHEET_W} ${SHEET_H}" ` +
    `width="${SHEET_W}" height="${SHEET_H}">` +
    `<rect width="${SHEET_W}" height="${SHEET_H}" fill="${req.palette.paper}"/>` +
    // top rule and the foundry line
    `<line x1="${MARGIN}" y1="${MARGIN + 54}" x2="${SHEET_W - MARGIN}" y2="${MARGIN + 54}" ` +
    `stroke="${req.palette.ink}" stroke-width="2"/>` +
    small(MARGIN, MARGIN + 34, "For Font's Sake", req.palette.ink) +
    small(SHEET_W - MARGIN, MARGIN + 34, `No. ${number}`, req.palette.mark, 19, 'end') +
    // the specimen
    `<g transform="translate(${MARGIN}, ${baseline}) scale(${scale}, ${-scale})">` +
    `<path d="${word.d}" fill="${req.palette.ink}" fill-rule="evenodd"/></g>` +
    // caption block
    `<line x1="${MARGIN}" y1="${footTop}" x2="${SHEET_W - MARGIN}" y2="${footTop}" ` +
    `stroke="${req.palette.ink}" stroke-width="2"/>` +
    small(MARGIN, footTop + 40, `${chainName(req.chain)} on ${req.font.label}`, req.palette.ink, 23) +
    small(MARGIN, footTop + 74, settingsLine(req.chain), req.palette.mark, 17) +
    small(MARGIN, footTop + 104, `Seed ${req.seed}`, req.palette.mark, 17) +
    lines
      .map((line, i) =>
        `<text x="${MARGIN}" y="${footTop + 146 + i * 26}" font-family="${mono}" ` +
        `font-size="16" fill="${req.palette.ink}" opacity="0.62">${esc(line)}</text>`,
      )
      .join('') +
    small(
      SHEET_W - MARGIN,
      SHEET_H - MARGIN,
      'forfontsake.xyz',
      req.palette.ink,
      17,
      'end',
    ) +
    small(MARGIN, SHEET_H - MARGIN, 'Built in the browser · OFL source', req.palette.ink, 17) +
    // the cap-height mark: a foundry sheet says how big the thing on it is
    `<line x1="${SHEET_W - MARGIN + 22}" y1="${blockTop}" x2="${SHEET_W - MARGIN + 22}" ` +
    `y2="${blockTop + capHeight}" stroke="${req.palette.mark}" stroke-width="2"/>` +
    `</svg>`
  )
}

/** as many whole sentences as fit the budget, and never fewer than one */
function firstSentences(text: string, budget: number): string {
  const parts = text.split(/(?<=\.)\s+/)
  let out = ''
  for (const part of parts) {
    if (out && out.length + part.length + 1 > budget) break
    out = out ? `${out} ${part}` : part
  }
  return out
}

/** greedy wrap, because SVG text does not do it and the paragraph is short */
function wrap(text: string, cols: number): string[] {
  const out: string[] = []
  let line = ''
  for (const word of text.split(/\s+/)) {
    if (line.length + word.length + 1 > cols) {
      out.push(line)
      line = word
    } else {
      line = line ? `${line} ${word}` : word
    }
  }
  if (line) out.push(line)
  return out
}
