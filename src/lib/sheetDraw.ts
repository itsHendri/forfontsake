import { applyChain, resolveChain, effectiveSeed, type Overrides } from '../engine/treatments/registry'
import { mulberry32 } from '../engine/prng'
import { ringsToPathD } from '../engine/svg'
import { toRings, type FontData } from './glyphData'
import { letterGrowth } from './render'
import type { Step } from './urlState'

/**
 * The drawing every sheet is made of: treated runs of letters, the ink they
 * reach, and where they go.
 *
 * Its own module so the four sheets in `poster.ts` and the templates in
 * `templates.ts` set type the same way, from one place, rather than each
 * keeping a copy that drifts.
 */

/** the sheet's margin all round, in sheet pixels, at every format */
export const MARGIN = 76

/** what treating a run of text depends on — a sheet request has all of it */
export interface TreatInput {
  font: FontData
  chain: Step[]
  seed: number
  overrides?: Overrides
}

/**
 * Treat the word once and return it as a path plus the box it occupies.
 *
 * Deliberately the first cut of each letter rather than the cycling ones the
 * workbench uses: a specimen is a reference, and a sheet that redrew the same
 * letter differently each time would be showing off the randomness rather than
 * the treatment.
 */
export function treatRun(req: TreatInput, text: string) {
  const data = req.font
  // grown advances, as the exported font sets them — see render.ts
  const grow = letterGrowth(data, req.chain, req.seed)
  let d = ''
  let penX = 0
  for (const ch of text) {
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

/** a run of treated letters: one path, its advance and the font's box */
export type Run = ReturnType<typeof treatRun>

/**
 * Every glyph on its own, for the character-set sheet.
 *
 * Separate from drawWord because a grid needs each letter's own box to centre
 * it in, which a single run of path data cannot give back.
 */
export function treatGlyphs(req: TreatInput, chars: string) {
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

/** the box a path's points actually reach, in its own units — the ink, not the font's box */
export function inkOf(d: string) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const nums = d.match(/-?\d+(?:\.\d+)?/g) ?? []
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = Number(nums[i]), y = Number(nums[i + 1])
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 } : null
}

export const pathAt = (d: string, x: number, baseline: number, scale: number, fill: string) =>
  `<g transform="translate(${x.toFixed(1)}, ${baseline.toFixed(1)}) scale(${scale.toFixed(5)}, ${(-scale).toFixed(5)})">` +
  `<path d="${d}" fill="${fill}" fill-rule="evenodd"/></g>`

/** a hairline in the ink, at a weight that survives being shown at a third of its size */
export const rule = (x: number, y: number, w: number, ink: string) =>
  `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="2" fill="${ink}"/>`
