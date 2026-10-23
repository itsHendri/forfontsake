import { getTreatment } from '../engine/treatments/registry'
import { copyFor } from './copyBank'
import { MARGIN, treatRun, inkOf, pathAt, rule, type Run, type TreatInput } from './sheetDraw'
import type { Step } from './urlState'

/**
 * The templates: sheets that say something, drawn from the October gallery round.
 *
 * Hendri pointed at Feliciano Type's Instagram, where nearly every post is type
 * alone on paper and the same few moves recur — words stacked between
 * hairlines, a list of phrases, one big question, a glyph over a paragraph, a
 * book cover, words turned on their side, now and then a picture. Fourteen were
 * drawn in Figma (band 14) and thirteen picked — the picture with three words
 * around it was the one left out — and a waterfall made it fourteen again.
 *
 * Type only, as the poster round decided: hairlines, but no size labels and no
 * address. Each template is half layout and half copy, so each takes lines —
 * from the bank in `copyBank.ts` until you type your own.
 *
 * The fonts here have one cut, where Feliciano steps through weights. The
 * engine's version of a second weight is the headline dial pushed further, so
 * that is what the "two settings" templates and the ramp show.
 */
export interface Template {
  id: string
  name: string
  /** one line for the gallery, saying what the template does */
  note: string
  /** what one line of copy is, for the box you type into; absent means it takes none */
  lines?: string
  /** whether it holds the picture from the Background layer in a box of its own */
  picture?: boolean
}

export const TEMPLATES: Template[] = [
  { id: 'stack', name: 'Stack', note: 'Three or four words, each across the full measure, hairlines between', lines: 'a word per line' },
  { id: 'list', name: 'List', note: 'Six to eight short phrases, centred, hairlines between', lines: 'a phrase per line' },
  { id: 'line', name: 'Big line', note: 'One short line, as large as the sheet allows', lines: 'the line' },
  { id: 'waterfall', name: 'Waterfall', note: 'One word at five sizes, large to small, hairlines between', lines: 'the word' },
  { id: 'struck', name: 'Struck', note: 'Names stacked, all but the first and last crossed out', lines: 'a name per line' },
  { id: 'turned', name: 'Turned', note: 'Words set on their side, side by side', lines: 'a word per line' },
  { id: 'ramp', name: 'Ramp', note: 'Each step one notch further along the headline dial, from the plain font' },
  { id: 'cover', name: 'Cover', note: 'A book cover: title, or, subtitle, author, imprint', lines: 'title, or, subtitle, author, imprint' },
  { id: 'title', name: 'Title + paragraph', note: 'A heading, a hairline, then the face set as text', lines: 'the title, then the paragraph' },
  { id: 'picture', name: 'Picture + word', note: 'Your picture above the word', lines: 'the word', picture: true },
  { id: 'glyphs', name: 'Glyphs + paragraph', note: 'Two glyphs over a paragraph set in the face', lines: 'the glyphs, then the paragraph' },
  { id: 'alphabet', name: 'Alphabet, two settings', note: 'Every letter and numeral, as you made it and pushed further' },
  { id: 'frame', name: 'Frame', note: 'A title inside a border of one repeated glyph', lines: 'the title, then the border glyph' },
  { id: 'testword', name: 'Test word, two settings', note: 'One test word, as you made it and pushed further', lines: 'the word' },
]

export const getTemplate = (id?: string): Template | undefined => TEMPLATES.find((t) => t.id === id)

/** what a template needs from the sheet request */
export interface TemplateRequest extends TreatInput {
  fontId: string
  palette: { ink: string; paper: string }
  /** lines of copy; absent or blank falls back to the bank's first set */
  copy?: string[]
  backdrop?: string | null
}

/** the sheet's size and the band the type is set in */
export interface Frame {
  w: number
  h: number
  top: number
  bottom: number
}

/** a template, drawn: the type, and the picture box under it if it has one */
export interface TemplateDrawing {
  picture: string
  type: string
}

/** the lines a request sets: its own unless every one is blank, the bank's first set if so */
export function linesFor(id: string, copy?: string[]): string[] {
  const own = (copy ?? []).map((l) => l.trim())
  return own.some((l) => l.length > 0) ? own.filter((l) => l.length > 0) : copyFor(id, 0)
}

/**
 * The chain with its headline dial somewhere else.
 *
 * `to` puts the first primary dial of the first step at a share of its range —
 * the ramp's steps. `by` moves it from where it is set by a share of its range
 * — the second setting. Only the first step moves, because on a stack the first
 * layer is the one the name of the treatment belongs to.
 */
export function dialAt(chain: Step[], move: { to?: number; by?: number }): Step[] {
  return chain.map((step, i) => {
    if (i > 0) return step
    const spec = getTreatment(step.id).params.find((p) => p.primary)
    if (!spec) return step
    const from = step.params[spec.key] ?? spec.default
    const raw = move.to !== undefined ? spec.min + move.to * (spec.max - spec.min) : from + (move.by ?? 0) * (spec.max - spec.min)
    return { id: step.id, params: { ...step.params, [spec.key]: Math.min(spec.max, Math.max(spec.min, raw)) } }
  })
}

/** how far the "two settings" templates push the headline dial */
export const SECOND_SETTING = 0.3

/**
 * Treated runs, kept.
 *
 * A template is many short runs rather than one word, and a gallery draws
 * thirteen of them, so the same line in the same font and chain is treated
 * once. The key is exactly what a run depends on.
 */
const runs = new Map<string, Run>()
const RUNS_KEPT = 600

function run(req: TemplateRequest, text: string, chain: Step[] = req.chain): Run {
  const key = [req.fontId, req.seed, JSON.stringify(chain), JSON.stringify(req.overrides ?? null), text].join('|')
  const hit = runs.get(key)
  if (hit) {
    runs.delete(key)
    runs.set(key, hit)
    return hit
  }
  const made = treatRun({ ...req, chain }, text)
  runs.set(key, made)
  if (runs.size > RUNS_KEPT) runs.delete(runs.keys().next().value!)
  return made
}

const NO_INK = { x0: 0, y0: 0, x1: 0, y1: 0, w: 0, h: 0 }
const ink = (r: Run) => inkOf(r.d) ?? NO_INK

/** a run placed by its ink: left edge at x, top of the ink at top */
function placeInk(req: TemplateRequest, r: Run, x: number, top: number, k: number) {
  const b = ink(r)
  return pathAt(r.d, x - b.x0 * k, top + b.y1 * k, k, req.palette.ink)
}

/** the largest scale at which a box fits, never more than `cap` */
function fit(w: number, h: number, maxW: number, maxH: number, cap = Infinity) {
  if (w <= 0 || h <= 0) return 0
  return Math.min(maxW / w, maxH / h, cap)
}

/**
 * Lines between hairlines, each fitted to the measure and capped by its row.
 *
 * Stack, List and Struck are all this, aligned differently. Each line is as
 * wide as the measure unless that would make it taller than its row, in which
 * case the row's height wins and the line is set narrower.
 */
function ruledRows(req: TemplateRequest, f: Frame, lines: string[], align: 'left' | 'center', struck?: (i: number) => boolean) {
  const measure = f.w - MARGIN * 2
  const rowH = (f.bottom - f.top) / lines.length
  let out = rule(MARGIN, f.top, measure, req.palette.ink)
  lines.forEach((line, i) => {
    const r = run(req, line)
    const b = ink(r)
    const k = fit(b.w, b.h, measure, rowH * 0.72)
    const x = align === 'left' ? MARGIN : MARGIN + (measure - b.w * k) / 2
    const top = f.top + i * rowH + (rowH - b.h * k) / 2
    if (k > 0) out += placeInk(req, r, x, top, k)
    if (k > 0 && struck?.(i)) {
      // a bar through the middle of the ink, past both ends
      const t = Math.max(6, b.h * k * 0.07)
      const over = 16
      out +=
        `<rect x="${(x - over).toFixed(1)}" y="${(top + b.h * k * 0.52 - t / 2).toFixed(1)}" ` +
        `width="${(b.w * k + 2 * over).toFixed(1)}" height="${t.toFixed(1)}" fill="${req.palette.ink}"/>`
    }
    out += rule(MARGIN, f.top + (i + 1) * rowH, measure, req.palette.ink)
  })
  return out
}

/**
 * Text set at the largest size that fits a box, broken into lines by word.
 *
 * Lines are spaced by the ink the words reach rather than the font's box, for
 * the reason the sentence sheet gives: Anton's box is half again its caps.
 * Returns the height it took so a caller can centre it.
 */
function textBlock(
  req: TemplateRequest,
  text: string,
  box: { x: number; y: number; w: number; h: number },
  opts: { lead?: number; align?: 'left' | 'center' } = {},
) {
  const words = text.split(/\s+/).filter(Boolean).map((w) => run(req, w))
  if (words.length === 0) return { svg: '', height: 0 }
  const inks = words.map((w) => inkOf(w.d)).filter((b) => b !== null)
  const inkTop = inks.length ? Math.max(...inks.map((b) => b.y1)) : req.font.ascender
  const inkBottom = inks.length ? Math.min(...inks.map((b) => b.y0)) : req.font.descender
  const lineH = (inkTop - inkBottom) * (opts.lead ?? 1.18)
  const space = req.font.glyphs[' ']?.adv ?? req.font.unitsPerEm * 0.25

  const lay = (k: number) => {
    const lines: { run: Run; x: number }[][] = []
    let line: { run: Run; x: number }[] = []
    let x = 0
    for (const r of words) {
      const w = r.width * k
      if (line.length > 0 && x + w > box.w) {
        lines.push(line)
        line = []
        x = 0
      }
      line.push({ run: r, x })
      x += w + space * k
    }
    if (line.length > 0) lines.push(line)
    return lines
  }
  const widest = Math.max(...words.map((w) => w.width))
  // the largest scale whose lines fit the box, by halving the difference
  let lo = 0
  let hi = Math.min(box.w / widest, box.h / lineH)
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (lay(mid).length * lineH * mid <= box.h) lo = mid
    else hi = mid
  }
  const k = lo
  if (k <= 0) return { svg: '', height: 0 }
  const lines = lay(k)
  let svg = ''
  lines.forEach((line, li) => {
    const baseline = box.y + inkTop * k + li * lineH * k
    const last = line[line.length - 1]
    const used = last.x + last.run.width * k
    const shift = opts.align === 'center' ? (box.w - used) / 2 : 0
    for (const { run: r, x } of line) svg += pathAt(r.d, box.x + x + shift, baseline, k, req.palette.ink)
  })
  return { svg, height: lines.length * lineH * k - (lineH - (inkTop - inkBottom)) * k }
}

/** one run, centred across the measure at the largest size that fits a share of it */
function centred(req: TemplateRequest, f: Frame, text: string, top: number, maxW: number, maxH: number, chain?: Step[]) {
  const r = run(req, text, chain)
  const b = ink(r)
  const k = fit(b.w, b.h, maxW, maxH)
  if (k <= 0) return { svg: '', h: 0 }
  return { svg: placeInk(req, r, (f.w - b.w * k) / 2, top, k), h: b.h * k }
}

/** the set the alphabet template shows, as the character-set sheet does */
const SET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
/** the waterfall's sizes, as shares of the largest */
export const WATERFALL_SIZES = [1, 0.62, 0.4, 0.26, 0.17]

/** the ramp's rows and the share of the dial's range each column sits at */
const RAMP_GLYPHS = ['A', 'a', '&', '2', 'R']
const RAMP_STEPS = [0, 0.18, 0.36, 0.54, 0.72, 0.9]

/** a halftone that stands in for a picture until one is uploaded */
function standIn(req: TemplateRequest, x: number, y: number, w: number, h: number) {
  const step = 18
  let out = ''
  for (let yy = y + step / 2; yy < y + h; yy += step)
    for (let xx = x + step / 2; xx < x + w; xx += step) {
      const u = (xx - x) / w
      const v = (yy - y) / h
      const tone = 0.5 + 0.35 * Math.sin(u * 5.2 + v * 2.1) * Math.cos(v * 4.3 - u * 1.4) + 0.15 * (v - 0.5)
      const r = Math.max(0, Math.min(1, tone)) * step * 0.55
      if (r > 0.6) out += `<circle cx="${xx.toFixed(1)}" cy="${yy.toFixed(1)}" r="${r.toFixed(2)}" fill="${req.palette.ink}"/>`
    }
  return out
}

/** the picture in its box, cropped to fill it, or the stand-in if there is none */
function pictureBox(req: TemplateRequest, x: number, y: number, w: number, h: number) {
  if (!req.backdrop) return standIn(req, x, y, w, h)
  // a nested viewport clips what it holds, which is all a crop needs
  return (
    `<svg x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}">` +
    `<image href="${req.backdrop}" width="100%" height="100%" preserveAspectRatio="xMidYMid slice"/></svg>`
  )
}

/** where a picture template puts the picture, in sheet pixels; null for every other template */
export function pictureRect(id: string, f: Frame): { x: number; y: number; w: number; h: number } | null {
  if (!getTemplate(id)?.picture) return null
  return { x: MARGIN, y: f.top, w: f.w - MARGIN * 2, h: (f.bottom - f.top) * PICTURE_SHARE }
}

/** how much of the band the picture takes, above the word */
const PICTURE_SHARE = 0.56

/** a template's drawing, or null for an id that is not a template */
export function drawTemplate(id: string, req: TemplateRequest, f: Frame): TemplateDrawing | null {
  const t = getTemplate(id)
  if (!t) return null
  const lines = linesFor(id, req.copy)
  const measure = f.w - MARGIN * 2
  const band = f.bottom - f.top
  const say = (type: string, picture = ''): TemplateDrawing => ({ picture, type })

  switch (id) {
    case 'stack':
      return say(ruledRows(req, f, lines, 'left'))
    case 'list':
      return say(ruledRows(req, f, lines, 'center'))
    case 'struck':
      return say(ruledRows(req, f, lines, 'center', (i) => i > 0 && i < lines.length - 1))

    case 'line':
      return say(textBlock(req, lines.join(' '), { x: MARGIN, y: f.top, w: measure, h: band }, { lead: 1.0 }).svg)

    case 'waterfall': {
      // The word at the measure, then smaller and smaller, each on its own row
      // between hairlines. Set by the ink, so the rows are as tall as the
      // letters actually reach; whatever height is left becomes air in the
      // rows rather than a gap at the foot.
      const r = run(req, lines[0] ?? '')
      const b = ink(r)
      const n = WATERFALL_SIZES.length
      const total = WATERFALL_SIZES.reduce((a, v) => a + v, 0)
      const minGap = 24
      const k = fit(b.w, b.h * total, measure, band - minGap * 2 * n)
      if (k <= 0) return say('')
      const gap = Math.max(minGap, (band - b.h * k * total) / (2 * n))
      let y = f.top
      let out = rule(MARGIN, y, measure, req.palette.ink)
      for (const size of WATERFALL_SIZES) {
        y += gap
        out += placeInk(req, r, MARGIN, y, k * size)
        y += b.h * k * size + gap
        out += rule(MARGIN, y, measure, req.palette.ink)
      }
      return say(out)
    }

    case 'turned': {
      // read bottom to top, every word at the one size the longest allows
      const words = lines.map((l) => run(req, l))
      const inks = words.map(ink)
      const col = measure / words.length
      const capTop = Math.max(...inks.map((b) => b.y1))
      const capBottom = Math.min(...inks.map((b) => b.y0))
      const k = Math.min(...inks.map((b) => (b.w > 0 ? band / b.w : Infinity)), (col * 0.96) / (capTop - capBottom))
      if (!Number.isFinite(k) || k <= 0) return say('')
      let out = ''
      words.forEach((r, i) => {
        const x = MARGIN + i * col + (col + (capTop - capBottom) * k) / 2 + capBottom * k
        const y = f.bottom + inks[i].x0 * k
        out +=
          `<g transform="translate(${x.toFixed(1)}, ${y.toFixed(1)}) rotate(-90) scale(${k.toFixed(5)}, ${(-k).toFixed(5)})">` +
          `<path d="${r.d}" fill="${req.palette.ink}" fill-rule="evenodd"/></g>`
      })
      return say(out)
    }

    case 'ramp': {
      const cellW = measure / RAMP_STEPS.length
      const cellH = band / RAMP_GLYPHS.length
      const cells = RAMP_GLYPHS.map((g) => RAMP_STEPS.map((to) => run(req, g, dialAt(req.chain, { to }))))
      const inks = cells.flat().map(ink)
      const maxW = Math.max(...inks.map((b) => b.w))
      const top = Math.max(...inks.map((b) => b.y1))
      const bottom = Math.min(...inks.map((b) => b.y0))
      const k = fit(maxW, top - bottom, cellW * 0.9, cellH * 0.8)
      if (k <= 0) return say('')
      let out = ''
      cells.forEach((row, ri) =>
        row.forEach((r, ci) => {
          const b = ink(r)
          const cx = MARGIN + ci * cellW + cellW / 2
          const baseline = f.top + ri * cellH + (cellH - (top - bottom) * k) / 2 + top * k
          out += pathAt(r.d, cx - (b.x0 + b.w / 2) * k, baseline, k, req.palette.ink)
        }),
      )
      return say(out)
    }

    case 'cover': {
      const [title = '', or = '', sub = '', by = '', imprint = ''] = lines
      let y = f.top + band * 0.16
      let out = ''
      for (const [text, w, h, gap] of [
        [title, 1, 0.26, 30],
        [or, 1, 0.035, 30],
        [sub, 0.9, 0.1, 40],
        [by, 0.5, 0.045, 0],
      ] as const) {
        if (!text) continue
        const c = centred(req, f, text, y, measure * w, band * h)
        out += c.svg
        y += c.h + gap
      }
      if (imprint) out += centred(req, f, imprint, f.bottom - band * 0.06, measure * 0.34, band * 0.03).svg
      return say(out)
    }

    case 'title': {
      const [head = '', ...rest] = lines
      const r = run(req, head)
      const b = ink(r)
      const k = fit(b.w, b.h, measure * 0.8, band * 0.11)
      let out = k > 0 ? placeInk(req, r, MARGIN, f.top, k) : ''
      const y = f.top + b.h * k + 34
      out += rule(MARGIN, y, measure, req.palette.ink)
      out += textBlock(req, rest.join(' '), { x: MARGIN, y: y + 30, w: measure, h: f.bottom - y - 30 }, { lead: 1.32 }).svg
      return say(out)
    }

    case 'glyphs': {
      const [pair = '', ...rest] = lines
      const r = run(req, pair)
      const b = ink(r)
      const k = fit(b.w, b.h, measure, band * 0.44)
      let out = k > 0 ? placeInk(req, r, MARGIN + (measure - b.w * k) / 2, f.top, k) : ''
      const y = f.top + band * 0.5
      out += rule(MARGIN, y, measure, req.palette.ink)
      out += textBlock(req, rest.join(' '), { x: MARGIN, y: y + 28, w: measure, h: f.bottom - y - 28 }, { lead: 1.32 }).svg
      return say(out)
    }

    case 'alphabet': {
      // the set twice, flush and broken at the measure: as made, then pushed
      const half = (band - 40) / 2
      const setAt = (chain: Step[], top: number) => {
        const glyphs = [...SET].map((c) => run(req, c, chain))
        const inks = glyphs.map(ink)
        const capTop = Math.max(...inks.map((b) => b.y1))
        const capBottom = Math.min(...inks.map((b) => b.y0))
        const lineH = (capTop - capBottom) * 1.08
        const lay = (k: number) => {
          const rows: Run[][] = []
          let row: Run[] = []
          let x = 0
          for (const g of glyphs) {
            if (row.length > 0 && x + g.width * k > measure) {
              rows.push(row)
              row = []
              x = 0
            }
            row.push(g)
            x += g.width * k
          }
          if (row.length > 0) rows.push(row)
          return rows
        }
        let lo = 0
        let hi = half / lineH
        for (let i = 0; i < 24; i++) {
          const mid = (lo + hi) / 2
          if (lay(mid).length * lineH * mid <= half) lo = mid
          else hi = mid
        }
        let out = ''
        lay(lo).forEach((row, ri) => {
          let x = MARGIN
          const baseline = top + capTop * lo + ri * lineH * lo
          for (const g of row) {
            out += pathAt(g.d, x, baseline, lo, req.palette.ink)
            x += g.width * lo
          }
        })
        return out
      }
      return say(
        setAt(req.chain, f.top) +
          rule(MARGIN, f.top + half + 20, measure, req.palette.ink) +
          setAt(dialAt(req.chain, { by: SECOND_SETTING }), f.top + half + 40),
      )
    }

    case 'frame': {
      const [passage = '', border = '&'] = lines
      const g = run(req, [...border][0] ?? '&')
      const b = ink(g)
      const cell = 64
      const n = Math.floor(measure / cell)
      const m = Math.floor(band / cell)
      const gx = MARGIN + (measure - n * cell) / 2
      const gy = f.top + (band - m * cell) / 2
      let out = ''
      if (b.w > 0 && b.h > 0) {
        const k = (cell * 0.78) / Math.max(b.w, b.h)
        const put = (cx: number, cy: number) => {
          out += pathAt(g.d, cx - (b.x0 + b.w / 2) * k, cy + (b.y0 + b.h / 2) * k, k, req.palette.ink)
        }
        for (let i = 0; i < n; i++) {
          put(gx + i * cell + cell / 2, gy + cell / 2)
          put(gx + i * cell + cell / 2, gy + (m - 0.5) * cell)
        }
        for (let j = 1; j < m - 1; j++) {
          put(gx + cell / 2, gy + j * cell + cell / 2)
          put(gx + (n - 0.5) * cell, gy + j * cell + cell / 2)
        }
      }
      const inner = measure - 2 * cell - 120
      const room = Math.min(band * 0.5, m * cell - 2 * cell - 80)
      const x = MARGIN + (measure - inner) / 2
      const sized = textBlock(req, passage, { x, y: 0, w: inner, h: room }, { lead: 1.1, align: 'center' })
      out += textBlock(req, passage, { x, y: f.top + (band - sized.height) / 2, w: inner, h: room }, { lead: 1.1, align: 'center' }).svg
      return say(out)
    }

    case 'testword': {
      const word = lines[0] ?? ''
      let out = ''
      ;[req.chain, dialAt(req.chain, { by: SECOND_SETTING })].forEach((chain, i) => {
        out += centred(req, f, word, f.top + band * (i === 0 ? 0.14 : 0.56), measure * 0.78, band * 0.3, chain).svg
      })
      return say(out)
    }

    case 'picture': {
      const box = pictureRect(id, f)!
      const ph = box.h
      const picture = pictureBox(req, box.x, box.y, box.w, box.h)
      const r = run(req, lines[0] ?? '')
      const b = ink(r)
      const room = band - ph - 60
      const k = fit(b.w, b.h, measure, room)
      const type = k > 0 ? placeInk(req, r, MARGIN + (measure - b.w * k) / 2, f.top + ph + 40 + (room - b.h * k) / 2, k) : ''
      return say(type, picture)
    }
  }
  return null
}
