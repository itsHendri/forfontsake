import { intersect, union, FillRule, type Paths64, type Path64 } from 'clipper2-ts'
import { NoiseField } from '../noise'
import { SCALE, normalise, pathsToRings, simplify, boundsOf } from '../paths'
import type { Ring } from '../flatten'
import type { Treatment, ParamValues, TreatmentContext } from './types'

/**
 * A wobbling line, as a filled ribbon.
 *
 * The pipeline carries no strokes, so a drawn line has to be a closed shape: a
 * polyline is walked, and a quad is emitted either side of each segment, thick
 * by `w`. Unioned, they are one continuous band that bends.
 */
function ribbon(
  x0: number,
  y0: number,
  dx: number,
  dy: number,
  len: number,
  w: number,
  wobble: number,
  noise: NoiseField,
  scale: number,
): Paths64 {
  // A straight line needs two points; every extra one is paid for in the
  // exported font, and a hatch is hundreds of lines. Only bending earns them.
  const steps = wobble <= 0 ? 1 : Math.max(2, Math.min(16, Math.round(len / (scale * 1.6))))
  const nx = -dy
  const ny = dx
  const pts: { x: number; y: number }[] = []
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * len
    const px = x0 + dx * t
    const py = y0 + dy * t
    const off = wobble > 0 ? noise.fractal(px / scale, py / scale, 2) * wobble : 0
    pts.push({ x: px + nx * off, y: py + ny * off })
  }
  const quads: Paths64 = []
  const h = w / 2
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const sx = b.x - a.x
    const sy = b.y - a.y
    const l = Math.hypot(sx, sy)
    if (l < 1e-6) continue
    const ux = (-sy / l) * h
    const uy = (sx / l) * h
    quads.push([
      { x: Math.round(a.x + ux), y: Math.round(a.y + uy) },
      { x: Math.round(b.x + ux), y: Math.round(b.y + uy) },
      { x: Math.round(b.x - ux), y: Math.round(b.y - uy) },
      { x: Math.round(a.x - ux), y: Math.round(a.y - uy) },
    ] as Path64)
  }
  return quads
}

/** Hatch — engraving, by the pen-plotter recipe: rule lines, clip to the shape. */
export const hatch: Treatment = {
  id: 'hatch',
  name: 'Hatch',
  family: 'screen',
  deterministic: false,
  blurb: 'Engraved: ruled lines through the letter, crossed if you want the tone.',
  story:
    'The pen-plotter hatch fill — rule parallel lines at the pen spacing, clip them to the '+
    'shape, and run a second set across for the darker tone. Nothing here is a stroke: each '+
    'line is a filled ribbon, because a font can only carry closed contours. Wander bends '+
    'the lines through a noise field, which is the difference between an engraving and a '+
    'screen print of an engraving.',
  params: [
    { key: 'spacing', label: 'Spacing', min: 6, max: 80, step: 1, default: 20, note: 'gap between lines, as % of stroke', primary: true },
    { key: 'weight', label: 'Line weight', min: 8, max: 90, step: 1, default: 34, note: '% of the spacing that is ink', primary: true },
    { key: 'angle', label: 'Angle', min: 0, max: 180, step: 1, default: 45, primary: true },
    { key: 'cross', label: 'Cross-hatch', min: 0, max: 90, step: 1, default: 0, note: 'angle of the second pass; 0 is off', primary: true },
    { key: 'wander', label: 'Wander', min: 0, max: 100, step: 1, default: 20, note: 'lines bend, the way a cut one does' },
    { key: 'simplify', label: 'Simplify', min: 0, max: 4, step: 0.1, default: 0.4 },
  ],

  presets: [
    { name: 'Single pass', values: { spacing: 20, weight: 34, angle: 45, cross: 0, wander: 20, simplify: 0.4 } },
    { name: 'Cross-hatched', values: { spacing: 24, weight: 30, angle: 45, cross: 90, wander: 20, simplify: 0.4 } },
    { name: 'Fine engraving', values: { spacing: 10, weight: 40, angle: 20, cross: 0, wander: 45, simplify: 0.4 } },
    { name: 'Coarse mesh', values: { spacing: 40, weight: 26, angle: 45, cross: 70, wander: 60, simplify: 0.4 } },
  ],


  apply(rings: Ring[], p: ParamValues, ctx: TreatmentContext): Ring[] {
    if (rings.length === 0) return rings
    const glyph = simplify(normalise(rings), 1.5)
    if (glyph.length === 0) return rings

    const stem = ctx.strokeWidth
    const b = boundsOf(glyph)
    const span = Math.hypot(b.maxX - b.minX, b.maxY - b.minY)
    let pitch = (p.spacing / 100) * stem * SCALE
    const passes = p.cross > 0 ? 2 : 1
    if (span / pitch > 70 / passes) pitch = (span * passes) / 70

    const noise = new NoiseField(ctx.rng)
    const wobble = (p.wander / 100) * pitch * 0.45
    const w = pitch * (p.weight / 100)
    const cx = (b.minX + b.maxX) / 2
    const cy = (b.minY + b.maxY) / 2
    const len = span * 1.5
    const half = span * 0.75

    const lines: Paths64 = []
    const rule = (deg: number) => {
      const a = (deg * Math.PI) / 180
      const dx = Math.cos(a)
      const dy = Math.sin(a)
      for (let d = -half; d <= half; d += pitch) {
        const px = cx - dy * d - dx * (len / 2)
        const py = cy + dx * d - dy * (len / 2)
        lines.push(...ribbon(px, py, dx, dy, len, w, wobble, noise, pitch * 2))
      }
    }
    rule(p.angle)
    if (p.cross > 0) rule(p.angle + p.cross)
    if (lines.length === 0) return pathsToRings(glyph)

    const result = intersect(union(lines, FillRule.NonZero), glyph, FillRule.NonZero)
    if (result.length === 0) return pathsToRings(glyph)
    return pathsToRings(simplify(result, p.simplify))
  },
}
