import { inflatePaths, JoinType, EndType, type Paths64, type Path64 } from 'clipper2-ts'
import { SCALE, isInside } from './paths'

/**
 * Tone, out of geometry.
 *
 * Halftone, dithering, stippling and engraving all size their marks by how dark
 * the source is there. A filled letter has no darkness to read — it is one flat
 * colour. So the tone is invented from the shape instead: how deep inside the
 * stroke a point sits. The middle of a stem is "dark", the edge is "light", and
 * every screen that wants a luminance signal suddenly has one, with no raster
 * anywhere in the pipeline.
 *
 * Cheaply: successive insets of the glyph. Band k is everything deeper than
 * k steps from the edge, so the deepest band containing a point is its tone.
 */
export function insetBands(glyph: Paths64, stepUnits: number, bands: number): Paths64[] {
  const out: Paths64[] = [glyph]
  if (stepUnits <= 0) return out
  let cur = glyph
  for (let k = 1; k < bands; k++) {
    cur = inflatePaths(cur, -stepUnits * SCALE, JoinType.Round, EndType.Polygon, 2, SCALE)
    if (cur.length === 0) break
    out.push(cur)
  }
  return out
}

/** 0 at the edge, 1 in the deepest band. Coordinates are working-scale. */
export function toneAt(bands: Paths64[], x: number, y: number): number {
  if (bands.length <= 1) return 1
  for (let k = bands.length - 1; k >= 0; k--) {
    if (isInside(bands[k], x, y)) return k / (bands.length - 1)
  }
  return 0
}

/** a closed regular polygon, working-scale — the stand-in for a circle */
export function disc(cx: number, cy: number, r: number, sides = 10): Path64 {
  const pts: Path64 = []
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2
    pts.push({ x: Math.round(cx + Math.cos(a) * r), y: Math.round(cy + Math.sin(a) * r) })
  }
  return pts
}

/** an axis-aligned square, working-scale */
export function square(cx: number, cy: number, half: number): Path64 {
  const h = Math.round(half)
  const x = Math.round(cx)
  const y = Math.round(cy)
  return [
    { x: x - h, y: y - h },
    { x: x + h, y: y - h },
    { x: x + h, y: y + h },
    { x: x - h, y: y + h },
  ]
}

/**
 * A stripe: a rectangle of length `len` and width `w`, centred on (cx, cy) and
 * rotated by `angle`. Stripes are how every line-based screen here is drawn —
 * a filled band, never a stroke, because the pipeline only carries closed
 * polygons and a font only carries filled contours.
 */
export function stripe(
  cx: number,
  cy: number,
  len: number,
  w: number,
  angle: number,
): Path64 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const hl = len / 2
  const hw = w / 2
  const corners: [number, number][] = [
    [-hl, -hw],
    [hl, -hw],
    [hl, hw],
    [-hl, hw],
  ]
  return corners.map(([x, y]) => ({
    x: Math.round(cx + x * c - y * s),
    y: Math.round(cy + x * s + y * c),
  }))
}

/**
 * A grid of points covering `bounds`, rotated by `angle` about the origin and
 * phased on absolute x so the screen runs continuously across a word instead of
 * restarting under every letter. That continuity is what `penX` is for.
 */
export function screenGrid(
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  spacing: number,
  angle: number,
  phaseX: number,
): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = []
  if (spacing <= 0) return pts
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  // work in the rotated frame, then rotate the samples back
  const corners = [
    [bounds.minX, bounds.minY],
    [bounds.maxX, bounds.minY],
    [bounds.maxX, bounds.maxY],
    [bounds.minX, bounds.maxY],
  ]
  let minU = Infinity
  let maxU = -Infinity
  let minV = Infinity
  let maxV = -Infinity
  for (const [x, y] of corners) {
    const u = x * c + y * s
    const v = -x * s + y * c
    if (u < minU) minU = u
    if (u > maxU) maxU = u
    if (v < minV) minV = v
    if (v > maxV) maxV = v
  }
  // phase from the pen position, so letter two continues letter one's screen
  const phaseU = ((phaseX * c) % spacing) + spacing
  const startU = Math.floor((minU - phaseU) / spacing) * spacing + phaseU
  const startV = Math.floor(minV / spacing) * spacing
  for (let v = startV; v <= maxV + spacing; v += spacing) {
    for (let u = startU; u <= maxU + spacing; u += spacing) {
      pts.push({ x: u * c - v * s, y: u * s + v * c })
    }
  }
  return pts
}
