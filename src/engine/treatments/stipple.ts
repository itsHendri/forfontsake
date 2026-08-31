import { union, intersect, FillRule, type Paths64 } from 'clipper2-ts'
import PoissonDiskSampling from 'poisson-disk-sampling'
import { SCALE, normalise, pathsToRings, simplify, boundsOf, isInside, distanceToEdge, grow } from '../paths'
import { insetBands, toneAt, disc } from '../tone'
import type { Ring } from '../flatten'
import type { Treatment, ParamValues, TreatmentContext } from './types'

/**
 * Stipple — dotwork, and the spray can.
 *
 * Points are laid down by Poisson-disk sampling rather than on a grid, so they
 * are evenly spaced without ever lining up — the difference between dotwork and
 * a screen. Dots inside the letter grow toward the middle of a stroke; dots
 * beyond the edge survive with a probability that falls off with distance,
 * which is the overspray that makes a stencil look sprayed rather than printed.
 */
export const stipple: Treatment = {
  id: 'stipple',
  name: 'Stipple',
  family: 'screen',
  deterministic: false,
  blurb: 'Dotwork — evenly scattered, never aligned, hazing out past the edge.',
  story:
    'Poisson-disk sampling puts the dots an even distance apart without ever letting them '+
    'line up, which is what separates dotwork from a halftone screen. Size comes from depth '+
    'into the stroke. Past the edge the dots keep coming, thinning on an exponential falloff '+
    '— the overspray of a stencil, and the reason it reads as sprayed rather than printed.',
  params: [
    { key: 'density', label: 'Density', min: 8, max: 90, step: 1, default: 19, note: 'dot spacing, as % of stroke', primary: true },
    { key: 'size', label: 'Dot size', min: 15, max: 130, step: 1, default: 78, note: '% of the spacing', primary: true },
    { key: 'spray', label: 'Overspray', min: 0, max: 120, step: 1, default: 45, note: 'how far the haze carries past the edge', primary: true },
    { key: 'falloff', label: 'Falloff', min: 0, max: 100, step: 1, default: 40, note: 'dots shrink toward the edge', primary: true },
    // dots alone are a fine look, but they are a look you go and find; the
    // opening hand is the stencil, where the letter is still a letter
    { key: 'solid', label: 'Keep the letter', min: 0, max: 100, step: 1, default: 55, note: 'ink left under the dots — 0 is dots alone' },
    { key: 'simplify', label: 'Simplify', min: 0, max: 4, step: 0.1, default: 0.4 },
  ],

  presets: [
    { name: 'Sprayed stencil', values: { density: 19, size: 78, spray: 45, falloff: 40, solid: 55, simplify: 0.4 } },
    { name: 'Dots alone', values: { density: 16, size: 95, spray: 0, falloff: 30, solid: 0, simplify: 0.4 } },
    { name: 'Heavy overspray', values: { density: 15, size: 60, spray: 110, falloff: 40, solid: 70, simplify: 0.4 } },
    { name: 'Coarse dotwork', values: { density: 42, size: 100, spray: 0, falloff: 25, solid: 0, simplify: 0.4 } },
  ],


  growth(p, ctx) {
    return (p.spray / 100) * ctx.strokeWidth
  },

  apply(rings: Ring[], p: ParamValues, ctx: TreatmentContext): Ring[] {
    if (rings.length === 0) return rings
    const glyph = simplify(normalise(rings), 1.5)
    if (glyph.length === 0) return rings

    const stem = ctx.strokeWidth
    const reach = (p.spray / 100) * stem * SCALE
    const b = boundsOf(glyph)
    let spacing = (p.density / 100) * stem * SCALE
    const w = b.maxX - b.minX + reach * 2
    const h = b.maxY - b.minY + reach * 2
    // dots are contours, and a font pays for every one
    const cap = 420
    if ((w * h) / (spacing * spacing) > cap) spacing = Math.sqrt((w * h) / cap)

    const rng = ctx.rng
    const pds = new PoissonDiskSampling(
      { shape: [w, h], minDistance: spacing, tries: 12 },
      rng as unknown as () => number,
    )
    const bands = insetBands(glyph, (spacing / SCALE) * 0.8, 5)
    const falloff = p.falloff / 100
    const maxR = (spacing / 2) * (p.size / 100)

    const dots: Paths64 = []
    for (const [sx, sy] of pds.fill()) {
      const x = b.minX - reach + sx
      const y = b.minY - reach + sy
      const inside = isInside(glyph, x, y)
      let r: number
      if (inside) {
        r = maxR * (1 - falloff + falloff * toneAt(bands, x, y))
      } else {
        if (reach <= 0) continue
        const d = distanceToEdge(glyph, x, y)
        if (d > reach) continue
        // exponential haze: thick against the edge, gone well before the limit
        if (rng() > Math.exp((-3 * d) / reach)) continue
        r = maxR * 0.75 * (1 - d / reach)
      }
      if (r < SCALE * 0.7) continue
      dots.push(disc(x, y, r, 8))
    }
    if (dots.length === 0) return pathsToRings(glyph)

    const merged = union(dots, FillRule.NonZero)
    let result = merged
    if (p.solid > 0) {
      // a core of the letter kept under the dots, shrunk by the dial
      const core = grow(glyph, -(1 - p.solid / 100) * stem * 0.5)
      result = union([...merged, ...core], FillRule.NonZero)
    } else if (reach <= 0) {
      result = intersect(merged, glyph, FillRule.NonZero)
    }
    if (result.length === 0) return pathsToRings(glyph)
    return pathsToRings(simplify(result, p.simplify))
  },
}
