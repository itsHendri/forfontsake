import { union, FillRule, type Paths64 } from 'clipper2-ts'
import { SCALE, normalise, pathsToRings, simplify, boundsOf, isInside } from '../paths'
import { square } from '../tone'
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
 */
export const pixel: Treatment = {
  id: 'pixel',
  name: 'Pixel',
  family: 'screen',
  deterministic: true,
  blurb: 'Dropped onto a coarse grid, with a dithered fringe where it half-covers.',
  story:
    'Coverage is measured per cell and compared against a threshold — flat, and you get the '+
    'hard staircase of a bitmap font; taken from a 4×4 ordered dither matrix, and the '+
    'half-covered cells break into the checkered fringe of a 1-bit screen. The grid is '+
    'anchored on the pen and the baseline rather than the letter, or every letter in a word '+
    'would land on a different phase.',
  params: [
    { key: 'cell', label: 'Cell size', min: 8, max: 90, step: 1, default: 26, note: 'as % of stroke width', primary: true },
    // calibration rather than expression, so it sits behind "more dials"
    { key: 'threshold', label: 'Threshold', min: 10, max: 90, step: 1, default: 50, note: 'how much of a cell must be covered' },
    { key: 'dither', label: 'Dither', min: 0, max: 100, step: 1, default: 45, note: 'breaks the edge cells into a fringe', primary: true, steady: true },
    { key: 'gap', label: 'Gap', min: 0, max: 60, step: 1, default: 0, note: 'space between cells; 0 fuses them', primary: true, steady: true },
    { key: 'simplify', label: 'Simplify', min: 0, max: 4, step: 0.1, default: 0.3 },
  ],

  presets: [
    { name: 'Bitmap', values: { cell: 26, threshold: 50, dither: 45, gap: 0, simplify: 0.3 } },
    { name: 'Hard threshold', values: { cell: 20, threshold: 50, dither: 0, gap: 0, simplify: 0.3 } },
    { name: 'Heavy dither', values: { cell: 16, threshold: 45, dither: 100, gap: 0, simplify: 0.3 } },
    { name: 'Gridded tiles', values: { cell: 40, threshold: 50, dither: 20, gap: 22, simplify: 0.3 } },
  ],


  apply(rings: Ring[], p: ParamValues, ctx: TreatmentContext): Ring[] {
    if (rings.length === 0) return rings
    const glyph = simplify(normalise(rings), 1.5)
    if (glyph.length === 0) return rings

    const b = boundsOf(glyph)
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
    const half = (cell / 2) * (1 - p.gap / 100)
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
        if (hits === 0) continue
        const coverage = hits / 9
        const bayer = BAYER[((iy % 4) + 4) % 4][((ix % 4) + 4) % 4]
        const threshold = base * (1 - dither) + bayer * dither
        if (coverage <= threshold) continue
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
