import { area, type Paths64 } from 'clipper2-ts'
import { SCALE, normalise, boundsOf } from './paths'
import type { Ring } from './flatten'

/**
 * Measuring how thick a font's strokes are.
 *
 * Treatments were sized against the em, which meant one setting behaved
 * completely differently on a hairline face and on a heavy one — a spread that
 * reads as damp ink on Pirata One closes every counter in Anton. Sizing against
 * the stroke instead makes a preset mean the same thing everywhere: "half a
 * stem wide" is a description that travels, "38 units" is not.
 */

/** widths of the ink runs where a horizontal line crosses the shape */
function inkRuns(paths: Paths64, y: number, out: number[]) {
  const crossings: number[] = []
  for (const ring of paths) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      // half-open test, so a vertex exactly on the line is counted once
      if (a.y === b.y) continue
      const lo = Math.min(a.y, b.y)
      const hi = Math.max(a.y, b.y)
      if (y < lo || y >= hi) continue
      crossings.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x))
    }
  }
  if (crossings.length < 2) return
  crossings.sort((p, q) => p - q)
  // after a NonZero union the crossings alternate entering and leaving ink
  for (let i = 0; i + 1 < crossings.length; i += 2) {
    const w = crossings[i + 1] - crossings[i]
    if (w > 0) out.push(w)
  }
}

/**
 * Median stem width across a sample of glyphs, in font units.
 *
 * The median rather than the mean because a glyph's widest run is usually a
 * horizontal bar or a serif rather than a stem, and those outliers would drag
 * an average well past what the eye reads as the stroke.
 */
export function medianStrokeWidth(samples: Ring[][], fallback: number): number {
  const runs: number[] = []

  for (const rings of samples) {
    if (rings.length === 0) continue
    const paths = normalise(rings)
    if (paths.length === 0) continue
    const filled = paths.reduce((s, r) => s + Math.abs(area(r)), 0)
    if (filled <= 0) continue

    const b = boundsOf(paths)
    const height = b.maxY - b.minY
    if (height <= 0) continue

    // scan the middle band; the very top and bottom of a glyph are curves and
    // terminals, which are not representative of the stem
    for (let i = 2; i <= 8; i++) {
      inkRuns(paths, b.minY + (height * i) / 10, runs)
    }
  }

  if (runs.length === 0) return fallback
  runs.sort((a, b) => a - b)
  return runs[Math.floor(runs.length / 2)] / SCALE
}

/** the glyphs worth measuring — plain stems and bowls, no diagonals or serifs */
export const STROKE_SAMPLE_CHARS = 'nomiulHEIT'
