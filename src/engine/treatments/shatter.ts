import { intersect, union, FillRule, type Paths64 } from 'clipper2-ts'
import { normalise, pathsToRings, simplify, boundsOf, dropTinyAreas } from '../paths'
import type { Ring } from '../flatten'
import type { Treatment, ParamValues, TreatmentContext } from './types'

/** the half-plane on one side of a line through (px, py) at `angle`, as a big box */
function halfPlane(
  px: number,
  py: number,
  angle: number,
  reach: number,
  side: 1 | -1,
): Paths64 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  // along the line, and outward on the chosen side
  const nx = -s * side
  const ny = c * side
  const corners: [number, number][] = [
    [-reach, 0],
    [reach, 0],
    [reach, reach * 2],
    [-reach, reach * 2],
  ]
  return [
    corners.map(([u, v]) => ({
      x: Math.round(px + u * c + v * nx),
      y: Math.round(py + u * s + v * ny),
    })),
  ]
}

function centroid(paths: Paths64) {
  let x = 0
  let y = 0
  let n = 0
  for (const r of paths)
    for (const p of r) {
      x += p.x
      y += p.y
      n++
    }
  return n > 0 ? { x: x / n, y: y / n } : { x: 0, y: 0 }
}

/**
 * Shatter — cut the letter up and knock the pieces out of true.
 *
 * After mekkablue's Cut and Shake: slice with a few random lines, then give
 * every resulting piece its own small translation and rotation. The letter stays
 * legible because the pieces stay near where they were; it stops being a font's
 * idea of a letter because none of them are quite in place.
 */
export const shatter: Treatment = {
  id: 'shatter',
  name: 'Shatter',
  family: 'structure',
  deterministic: false,
  blurb: 'Sliced apart and knocked out of true, each piece drifting on its own.',
  story:
    'After mekkablue’s Cut and Shake for Glyphs: slice the letter with a handful of random '+
    'lines, then translate and rotate each piece a little on its own. Legibility survives '+
    'because nothing travels far; the typographic composure does not, because nothing is '+
    'quite where it was set.',
  params: [
    { key: 'cuts', label: 'Cuts', min: 1, max: 5, step: 1, default: 3, note: 'each one doubles the pieces', primary: true },
    { key: 'scatter', label: 'Scatter', min: 0, max: 60, step: 1, default: 12, note: 'how far a piece drifts, as % of stroke', primary: true },
    { key: 'rotate', label: 'Rotate', min: 0, max: 20, step: 0.5, default: 3, note: 'degrees a piece may turn', primary: true },
    { key: 'bias', label: 'Cut angle', min: 0, max: 180, step: 1, default: 0, note: '0 cuts every which way', primary: true },
    { key: 'simplify', label: 'Simplify', min: 0, max: 4, step: 0.1, default: 0.4 },
  ],

  presets: [
    { name: 'Knocked askew', values: { cuts: 3, scatter: 12, rotate: 3, bias: 0, simplify: 0.4 } },
    { name: 'Sliced level', values: { cuts: 5, scatter: 20, rotate: 0, bias: 90, simplify: 0.4 } },
    { name: 'Barely off', values: { cuts: 2, scatter: 5, rotate: 1.5, bias: 0, simplify: 0.4 } },
    { name: 'Thrown', values: { cuts: 5, scatter: 34, rotate: 12, bias: 0, simplify: 0.4 } },
  ],


  growth(p, ctx) {
    return (p.scatter / 100) * ctx.strokeWidth * 1.5
  },

  apply(rings: Ring[], p: ParamValues, ctx: TreatmentContext): Ring[] {
    if (rings.length === 0) return rings
    const glyph = simplify(normalise(rings), 1.5)
    if (glyph.length === 0) return rings

    const rng = ctx.rng
    const b = boundsOf(glyph)
    const reach = Math.hypot(b.maxX - b.minX, b.maxY - b.minY) * 1.5

    let pieces: Paths64[] = [glyph]
    const cuts = Math.max(1, Math.round(p.cuts))
    for (let c = 0; c < cuts; c++) {
      // one line per pass, cutting every piece it crosses
      const px = b.minX + rng() * (b.maxX - b.minX)
      const py = b.minY + rng() * (b.maxY - b.minY)
      const angle = p.bias > 0 ? (p.bias * Math.PI) / 180 : rng() * Math.PI
      const above = halfPlane(px, py, angle, reach, 1)
      const below = halfPlane(px, py, angle, reach, -1)
      const next: Paths64[] = []
      for (const piece of pieces) {
        const a = intersect(piece, above, FillRule.NonZero)
        const bl = intersect(piece, below, FillRule.NonZero)
        if (a.length > 0) next.push(a)
        if (bl.length > 0) next.push(bl)
        if (a.length === 0 && bl.length === 0) next.push(piece)
      }
      pieces = next
    }

    const scatter = (p.scatter / 100) * ctx.strokeWidth * 100
    const maxRot = (p.rotate * Math.PI) / 180
    const moved: Paths64 = []
    for (const piece of pieces) {
      const dx = (rng() - 0.5) * 2 * scatter
      const dy = (rng() - 0.5) * 2 * scatter
      const rot = (rng() - 0.5) * 2 * maxRot
      const o = centroid(piece)
      const cs = Math.cos(rot)
      const sn = Math.sin(rot)
      for (const ring of piece) {
        moved.push(
          ring.map((pt) => {
            const x = pt.x - o.x
            const y = pt.y - o.y
            return {
              x: Math.round(o.x + x * cs - y * sn + dx),
              y: Math.round(o.y + x * sn + y * cs + dy),
            }
          }),
        )
      }
    }

    let result = union(moved, FillRule.NonZero)
    if (result.length === 0) result = glyph
    result = dropTinyAreas(result, ctx.strokeWidth * ctx.strokeWidth * 0.01)
    return pathsToRings(simplify(result, p.simplify))
  },
}
