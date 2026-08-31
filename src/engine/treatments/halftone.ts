import { intersect, difference, union, FillRule, type Paths64 } from 'clipper2-ts'
import { SCALE, normalise, pathsToRings, simplify, boundsOf, isInside } from '../paths'
import { insetBands, toneAt, disc, square, screenGrid } from '../tone'
import type { Ring } from '../flatten'
import type { Treatment, ParamValues, TreatmentContext } from './types'

/** the most-asked-for look on the board, and the one every halftone tool sells */
export const halftone: Treatment = {
  id: 'halftone',
  name: 'Halftone',
  family: 'screen',
  deterministic: true,
  blurb: 'A printer’s screen: the letter rebuilt out of dots on a rotated grid.',
  story:
    'A halftone screen sizes each dot by how dark the artwork is beneath it, and a solid '+
    'letter has no darkness to read. So the tone is taken from the geometry instead — how '+
    'deep into the stroke the dot sits, measured by successive insets — which makes the '+
    'dots swell toward the middle of a stem and thin out at the edges. The grid is phased '+
    'on the pen position rather than the letter, so the screen runs unbroken across a word.',
  params: [
    { key: 'spacing', label: 'Screen', min: 12, max: 120, step: 1, default: 30, note: 'dot pitch, as % of stroke', primary: true },
    { key: 'size', label: 'Dot size', min: 20, max: 160, step: 1, default: 105, note: '100 just touches at full tone', primary: true },
    { key: 'angle', label: 'Angle', min: 0, max: 90, step: 1, default: 45, note: 'the classic screen sits at 45°', primary: true },
    { key: 'falloff', label: 'Falloff', min: 0, max: 100, step: 1, default: 60, note: 'how much smaller the dots get at the edge', primary: true },
    { key: 'shape', label: 'Shape', min: 0, max: 1, step: 1, default: 0, note: '0 round · 1 square' },
    { key: 'invert', label: 'Invert', min: 0, max: 1, step: 1, default: 0, note: 'punch the dots out instead' },
    { key: 'simplify', label: 'Simplify', min: 0, max: 4, step: 0.1, default: 0.4 },
  ],

  presets: [
    { name: 'Classic 45°', values: { spacing: 30, size: 105, angle: 45, falloff: 60, shape: 0, invert: 0, simplify: 0.4 } },
    { name: 'Coarse dots', values: { spacing: 55, size: 120, angle: 45, falloff: 15, shape: 0, invert: 0, simplify: 0.4 } },
    { name: 'Fine square screen', values: { spacing: 18, size: 105, angle: 0, falloff: 80, shape: 1, invert: 0, simplify: 0.4 } },
    { name: 'Punched out', values: { spacing: 38, size: 80, angle: 45, falloff: 70, shape: 0, invert: 1, simplify: 0.4 } },
  ],


  apply(rings: Ring[], p: ParamValues, ctx: TreatmentContext): Ring[] {
    if (rings.length === 0) return rings
    const glyph = simplify(normalise(rings), 1.5)
    if (glyph.length === 0) return rings

    const stem = ctx.strokeWidth
    let spacing = (p.spacing / 100) * stem * SCALE
    const bounds = boundsOf(glyph)
    // A screen finer than the glyph can carry costs contours a font cannot
    // show. Coarsen rather than refuse: the look degrades, the export survives.
    const area = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY)
    const cap = 350
    if (area / (spacing * spacing) > cap) spacing = Math.sqrt(area / cap)

    const angle = (p.angle * Math.PI) / 180
    const bands = insetBands(glyph, (spacing / SCALE) * 0.6, 5)
    const falloff = p.falloff / 100
    const maxR = (spacing / 2) * (p.size / 100)
    const rounded = p.shape < 0.5

    const dots: Paths64 = []
    for (const pt of screenGrid(bounds, spacing, angle, ctx.penX * SCALE)) {
      if (!isInside(glyph, pt.x, pt.y)) continue
      const tone = toneAt(bands, pt.x, pt.y)
      const r = maxR * (1 - falloff + falloff * tone)
      if (r < SCALE * 0.8) continue
      // a small dot needs fewer sides than a big one to still read as round
      dots.push(rounded ? disc(pt.x, pt.y, r, r > spacing * 0.35 ? 10 : 7) : square(pt.x, pt.y, r))
    }
    if (dots.length === 0) return pathsToRings(glyph)

    const merged = union(dots, FillRule.NonZero)
    const result =
      p.invert >= 0.5
        ? difference(glyph, merged, FillRule.NonZero)
        : intersect(merged, glyph, FillRule.NonZero)
    if (result.length === 0) return pathsToRings(glyph)
    return pathsToRings(simplify(result, p.simplify))
  },
}
