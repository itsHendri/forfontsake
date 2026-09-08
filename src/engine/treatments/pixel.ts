import { union, FillRule, type Paths64 } from 'clipper2-ts'
import { SCALE, normalise, pathsToRings, simplify, boundsOf, isInside } from '../paths'
import { square, outsideTone, fadeRamp } from '../tone'
import type { Ring } from '../flatten'
import type { Treatment, ParamValues, TreatmentContext } from './types'

/**
 * The 4×4 ordered dither matrix. A cell only half-covered by the letter is
 * kept or dropped depending on where it sits in this matrix, which turns a
 * ragged edge into the checkered fringe of a 1-bit bitmap instead of a
 * threshold's hard staircase.
 */
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map((row) => row.map((v) => (v + 0.5) / 16))

/**
 * Pixel — the letter through a low-resolution grid.
 *
 * The grid is anchored on the pen position and the baseline, never on the
 * glyph's own box: anchor it per-letter and every letter gets its own phase, so
 * the word looks like eight different screens instead of one.
 *
 * What decides a cell is a threshold, and what that threshold is made of is the
 * whole range of the treatment. Flat, and it is a bitmap. Taken from an ordered
 * matrix, and the half-covered cells break into a dithered fringe. Wobbled by
 * noise, and the cells nearest the edge start dropping at random while the core
 * holds — which is a letter dissolving into static, and is the same operation
 * again rather than a treatment of its own.
 */
export const pixel: Treatment = {
  id: 'pixel',
  name: 'Pixel',
  family: 'screen',
  // Noise draws on the seeded stream; at 0 it takes nothing and a reroll
  // changes nothing, the same way Grit's does at amount 0.
  deterministic: false,
  blurb: 'Dropped onto a coarse grid — a dithered fringe, or the letter dissolving into static.',
  story:
    'Coverage is measured per cell and compared against a threshold — flat, and you get the '+
    'hard staircase of a bitmap font; taken from a 4×4 ordered dither matrix, and the '+
    'half-covered cells break into the checkered fringe of a 1-bit screen. The grid is '+
    'anchored on the pen and the baseline rather than the letter, or every letter in a word '+
    'would land on a different phase. Wobble the threshold with Noise instead and the edge '+
    'cells go first while the deep ones hold, because a cell the letter fills completely '+
    'beats any threshold — the letter dissolves from the outside in without needing to be '+
    'told where its edges are.',
  params: [
    { key: 'cell', label: 'Cell size', group: 'Grid', min: 8, max: 90, step: 1, default: 26, note: 'as % of stroke width', primary: true },
    { key: 'gap', label: 'Gap', group: 'Grid', min: 0, max: 60, step: 1, default: 0, note: 'space between cells; 0 fuses them', steady: true },
    // calibration rather than expression, so it sits behind "more dials"
    { key: 'threshold', label: 'Threshold', group: 'Threshold', min: 10, max: 90, step: 1, default: 50, note: 'how much of a cell must be covered' },
    { key: 'noise', label: 'Noise', group: 'Threshold', min: 0, max: 100, step: 1, default: 0, note: 'wobbles the threshold, so edge cells drop at random', primary: true },
    { key: 'dither', label: 'Dither', group: 'Threshold', min: 0, max: 100, step: 1, default: 45, note: 'breaks the edge cells into a fringe', steady: true },
    { key: 'spread', label: 'Spread', group: 'Past the edge', min: 0, max: 150, step: 1, default: 0, note: 'how far the cells carry past the edge', primary: true },
    { key: 'fade', label: 'Fade', group: 'Past the edge', min: 0, max: 100, step: 1, default: 0, note: 'dissolve more toward one end', primary: true },
    { key: 'fadeAngle', label: 'Fade direction', group: 'Past the edge', min: 0, max: 359, step: 1, default: 90, note: '90 fades toward the top' },
    { key: 'simplify', label: 'Simplify', min: 0, max: 4, step: 0.1, default: 0.3 },
  ],

  presets: [
    { name: 'Bitmap', values: { cell: 26, threshold: 50, dither: 45, gap: 0, noise: 0, spread: 0, fade: 0, fadeAngle: 90, simplify: 0.3 } },
    { name: 'Hard threshold', values: { cell: 20, threshold: 50, dither: 0, gap: 0, noise: 0, spread: 0, fade: 0, fadeAngle: 90, simplify: 0.3 } },
    { name: 'Heavy dither', values: { cell: 16, threshold: 45, dither: 100, gap: 0, noise: 0, spread: 0, fade: 0, fadeAngle: 90, simplify: 0.3 } },
    { name: 'Gridded tiles', values: { cell: 40, threshold: 50, dither: 20, gap: 22, noise: 0, spread: 0, fade: 0, fadeAngle: 90, simplify: 0.3 } },
    // the letter coming apart rather than being screened
    { name: 'Photocopied twice', values: { cell: 16, threshold: 50, dither: 30, gap: 0, noise: 55, spread: 50, fade: 0, fadeAngle: 90, simplify: 0.3 } },
    { name: 'Dissolving', values: { cell: 14, threshold: 45, dither: 20, gap: 0, noise: 80, spread: 90, fade: 0, fadeAngle: 90, simplify: 0.3 } },
    { name: 'Rising smoke', values: { cell: 14, threshold: 45, dither: 20, gap: 0, noise: 60, spread: 80, fade: 85, fadeAngle: 90, simplify: 0.3 } },
  ],

  growth(p, ctx) {
    // A cell the edge runs through is drawn whole, so the grid already reached
    // half a cell past the letter before Spread existed — it just never said
    // so, and the advances were that much too narrow.
    return ((p.spread / 100) + p.cell / 200) * ctx.strokeWidth
  },


  apply(rings: Ring[], p: ParamValues, ctx: TreatmentContext): Ring[] {
    if (rings.length === 0) return rings
    const glyph = simplify(normalise(rings), 1.5)
    if (glyph.length === 0) return rings

    const g = boundsOf(glyph)
    const reach = (p.spread / 100) * ctx.strokeWidth * SCALE
    // the spread needs cells outside the letter, and the count is measured over
    // everything the grid has to cover
    const b =
      reach > 0
        ? { minX: g.minX - reach, minY: g.minY - reach, maxX: g.maxX + reach, maxY: g.maxY + reach }
        : g
    let cell = (p.cell / 100) * ctx.strokeWidth * SCALE
    const cap = 900
    const w = b.maxX - b.minX
    const h = b.maxY - b.minY
    if ((w * h) / (cell * cell) > cap) cell = Math.sqrt((w * h) / cap)

    // anchored on the pen and the baseline, so a word lands on one grid
    const originX = ctx.penX * SCALE
    const ix0 = Math.floor((b.minX - originX) / cell)
    const ix1 = Math.ceil((b.maxX - originX) / cell)
    const iy0 = Math.floor(b.minY / cell)
    const iy1 = Math.ceil(b.maxY / cell)

    const dither = p.dither / 100
    const base = p.threshold / 100
    const noise = p.noise / 100
    const half = (cell / 2) * (1 - p.gap / 100)
    const ramp = fadeRamp(b, p.fadeAngle, p.fade / 100)
    const rng = ctx.rng
    const cells: Paths64 = []

    for (let iy = iy0; iy <= iy1; iy++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const cx = originX + (ix + 0.5) * cell
        const cy = (iy + 0.5) * cell
        // 3×3 subsample: enough to tell a corner from a face
        let hits = 0
        for (let sy = 0; sy < 3; sy++) {
          for (let sx = 0; sx < 3; sx++) {
            const px = originX + (ix + (sx + 0.5) / 3) * cell
            const py = (iy + (sy + 0.5) / 3) * cell
            if (isInside(glyph, px, py)) hits++
          }
        }
        let coverage = hits / 9
        if (hits === 0) {
          // past the edge there is no coverage to measure, so distance stands
          // in for it: full against the outline, nothing at the end of the reach
          if (reach <= 0) continue
          coverage = outsideTone(glyph, cx, cy, reach)
          if (coverage <= 0) continue
        }
        const bayer = BAYER[((iy % 4) + 4) % 4][((ix % 4) + 4) % 4]
        // Ordered dither moves the threshold by where the cell sits; noise moves
        // it by nothing at all. A cell the letter fills completely survives
        // either, which is why the core holds while the edge comes apart.
        const threshold =
          base * (1 - dither) + bayer * dither + (noise > 0 ? (rng() - 0.5) * noise : 0)
        if (coverage * ramp(cx, cy) <= threshold) continue
        cells.push(square(cx, cy, half))
      }
    }
    if (cells.length === 0) return pathsToRings(glyph)

    // union always: adjacent cells fuse into one contour, which is most of the
    // point budget back
    const result = union(cells, FillRule.NonZero)
    if (result.length === 0) return pathsToRings(glyph)
    return pathsToRings(simplify(result, p.simplify))
  },
}
