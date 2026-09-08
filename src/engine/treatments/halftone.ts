import { intersect, difference, union, FillRule, type Paths64 } from 'clipper2-ts'
import { SCALE, normalise, pathsToRings, simplify, boundsOf, isInside, grow, roundPaths } from '../paths'
import { insetBands, toneAt, disc, square, screenGrid, outsideTone, fadeRamp } from '../tone'
import type { Ring } from '../flatten'
import type { Treatment, ParamValues, TreatmentContext } from './types'

/**
 * Halftone — the letter rebuilt out of marks that sample it.
 *
 * A halftone screen sizes each dot by how dark the artwork beneath it is, and a
 * solid letter has no darkness to read. So the tone is taken from the geometry
 * instead: how deep into the stroke the mark sits, measured by successive
 * insets. The dots swell toward the middle of a stem and thin out at the edges.
 *
 * A print screen and dotwork are the same operation with a different sampler,
 * which is why Scatter is a dial rather than a second treatment: at 0 the marks
 * sit on a rotated grid, and pushed up they wander off it until nothing lines
 * up. Overspray carries them past the edge on a falloff, which is the haze that
 * makes a stencil read as sprayed rather than printed.
 *
 * Past the edge the tone can behave two ways, and Grain is the dial between
 * them: broken up, where each mark survives on a coin toss weighted by how far
 * out it sits, which is spray paint; or smooth, where every mark is there and
 * simply shrinks, which is a letter out of focus. Fade tilts the whole field
 * along a direction, so the word can thin toward one end rather than evenly.
 */
export const halftone: Treatment = {
  id: 'halftone',
  name: 'Halftone',
  family: 'screen',
  // Scatter and Overspray both draw on the seeded stream. At zero they take
  // nothing and a reroll changes nothing, the same way Grit's does at amount 0.
  deterministic: false,
  blurb: 'A printer’s screen, or dotwork — marks that scatter, haze past the edge and fade away.',
  story:
    'A halftone screen sizes each dot by how dark the artwork is beneath it, and a solid '+
    'letter has no darkness to read. So the tone is taken from the geometry instead — how '+
    'deep into the stroke the dot sits, measured by successive insets — which makes the '+
    'dots swell toward the middle of a stem and thin out at the edges. The grid is phased '+
    'on the pen position rather than the letter, so the screen runs unbroken across a word. '+
    'Loosen Scatter and the same dots stop lining up, which is the whole difference between '+
    'a screen and dotwork; add Overspray and they carry past the edge on an exponential '+
    'falloff, thick against the letter and gone well before the limit.',
  params: [
    { key: 'spacing', label: 'Screen', group: 'Grid', min: 8, max: 120, step: 1, default: 30, note: 'mark pitch, as % of stroke', primary: true },
    { key: 'scatter', label: 'Scatter', group: 'Grid', min: 0, max: 100, step: 1, default: 0, note: 'how far the marks wander off the grid', primary: true },
    { key: 'angle', label: 'Angle', group: 'Grid', min: 0, max: 90, step: 1, default: 45, note: 'the classic screen sits at 45°' },
    { key: 'size', label: 'Dot size', group: 'Mark', min: 15, max: 160, step: 1, default: 105, note: '100 just touches at full tone' },
    { key: 'fuse', label: 'Fuse', group: 'Mark', min: 0, max: 100, step: 1, default: 0, note: 'melt touching marks into blobs' },
    { key: 'shape', label: 'Shape', group: 'Mark', min: 0, max: 1, step: 1, default: 0, note: '0 round · 1 square' },
    { key: 'spray', label: 'Overspray', group: 'Tone', min: 0, max: 120, step: 1, default: 0, note: 'how far the haze carries past the edge', primary: true },
    { key: 'fade', label: 'Fade', group: 'Tone', min: 0, max: 100, step: 1, default: 0, note: 'thin the marks toward one end', primary: true },
    { key: 'fadeAngle', label: 'Fade direction', group: 'Tone', min: 0, max: 359, step: 1, default: 90, note: '90 fades toward the top' },
    { key: 'grain', label: 'Grain', group: 'Tone', min: 0, max: 100, step: 1, default: 100, note: 'the haze broken up, or smooth' },
    { key: 'falloff', label: 'Falloff', group: 'Tone', min: 0, max: 100, step: 1, default: 60, note: 'how much smaller the dots get at the edge' },
    { key: 'solid', label: 'Keep the letter', group: 'Body', min: 0, max: 100, step: 1, default: 0, note: 'ink left under the dots — 0 is dots alone' },
    { key: 'invert', label: 'Invert', group: 'Body', min: 0, max: 1, step: 1, default: 0, note: 'punch the dots out instead' },
    { key: 'simplify', label: 'Simplify', min: 0, max: 4, step: 0.1, default: 0.4 },
  ],

  // Classic 45° is the textbook screen but leaves 0.27 of the letter's ink, so
  // it opens grey and is gone by 16px. Coarse dots is still unmistakably a dot
  // screen at more than twice the coverage, and survives down the size ladder.
  defaultPreset: 'Classic 45°',

  presets: [
    { name: 'Classic 45°', values: { spacing: 30, size: 105, scatter: 0, spray: 0, angle: 45, falloff: 60, solid: 0, shape: 0, invert: 0, simplify: 0.4, fade: 0, fadeAngle: 90, grain: 100, fuse: 0 } },
    { name: 'Coarse dots', values: { spacing: 55, size: 120, scatter: 0, spray: 0, angle: 45, falloff: 15, solid: 0, shape: 0, invert: 0, simplify: 0.4, fade: 0, fadeAngle: 90, grain: 100, fuse: 0 } },
    { name: 'Fine square screen', values: { spacing: 18, size: 105, scatter: 0, spray: 0, angle: 0, falloff: 80, solid: 0, shape: 1, invert: 0, simplify: 0.4, fade: 0, fadeAngle: 90, grain: 100, fuse: 0 } },
    { name: 'Punched out', values: { spacing: 38, size: 80, scatter: 0, spray: 0, angle: 45, falloff: 70, solid: 0, shape: 0, invert: 1, simplify: 0.4, fade: 0, fadeAngle: 90, grain: 100, fuse: 0 } },
    { name: 'Sprayed stencil', values: { spacing: 19, size: 78, scatter: 100, spray: 45, angle: 45, falloff: 40, solid: 55, shape: 0, invert: 0, simplify: 0.4, fade: 0, fadeAngle: 90, grain: 100, fuse: 0 } },
    { name: 'Dots alone', values: { spacing: 16, size: 95, scatter: 100, spray: 0, angle: 45, falloff: 30, solid: 0, shape: 0, invert: 0, simplify: 0.4, fade: 0, fadeAngle: 90, grain: 100, fuse: 0 } },
    { name: 'Heavy overspray', values: { spacing: 15, size: 60, scatter: 100, spray: 110, angle: 45, falloff: 40, solid: 70, shape: 0, invert: 0, simplify: 0.4, fade: 0, fadeAngle: 90, grain: 100, fuse: 0 } },
    { name: 'Coarse dotwork', values: { spacing: 42, size: 100, scatter: 100, spray: 0, angle: 45, falloff: 25, solid: 0, shape: 0, invert: 0, simplify: 0.4, fade: 0, fadeAngle: 90, grain: 100, fuse: 0 } },
    // the smooth side of the haze: every mark present, shrinking away, over a
    // core that keeps the word readable
    { name: 'Soft focus', values: { spacing: 36, size: 140, scatter: 0, spray: 90, angle: 45, falloff: 60, solid: 85, shape: 0, invert: 0, simplify: 0.4, fade: 0, fadeAngle: 90, grain: 0, fuse: 0 } },
    { name: 'Evaporating', values: { spacing: 34, size: 150, scatter: 0, spray: 80, angle: 45, falloff: 60, solid: 60, shape: 0, invert: 0, simplify: 0.4, fade: 80, fadeAngle: 90, grain: 0, fuse: 0 } },
    { name: 'Blob halftone', values: { spacing: 45, size: 170, scatter: 0, spray: 25, angle: 45, falloff: 60, solid: 75, shape: 0, invert: 0, simplify: 0.4, fade: 0, fadeAngle: 90, grain: 0, fuse: 50 } },
  ],

  growth(p, ctx) {
    return (p.spray / 100) * ctx.strokeWidth
  },

  apply(rings: Ring[], p: ParamValues, ctx: TreatmentContext): Ring[] {
    if (rings.length === 0) return rings
    const glyph = simplify(normalise(rings), 1.5)
    if (glyph.length === 0) return rings

    const rng = ctx.rng
    const stem = ctx.strokeWidth
    const reach = (p.spray / 100) * stem * SCALE
    let spacing = (p.spacing / 100) * stem * SCALE

    // the haze needs room outside the letter, and the mark count is measured
    // over everything the screen has to cover
    const b = boundsOf(glyph)
    const bounds =
      reach > 0
        ? { minX: b.minX - reach, minY: b.minY - reach, maxX: b.maxX + reach, maxY: b.maxY + reach }
        : b
    // A screen finer than the glyph can carry costs contours a font cannot
    // show. Coarsen rather than refuse: the look degrades, the export survives.
    const area = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY)
    const cap = 400
    if (area / (spacing * spacing) > cap) spacing = Math.sqrt(area / cap)

    const angle = (p.angle * Math.PI) / 180
    const bands = insetBands(glyph, (spacing / SCALE) * 0.6, 5)
    const falloff = p.falloff / 100
    const maxR = (spacing / 2) * (p.size / 100)
    const rounded = p.shape < 0.5
    const ramp = fadeRamp(bounds, p.fadeAngle, p.fade / 100)
    const grain = p.grain / 100
    // at full scatter a mark can sit most of a pitch off its grid point, which
    // is enough that no two of them line up
    const jitter = (p.scatter / 100) * spacing * 0.7

    const dots: Paths64 = []
    for (const pt of screenGrid(bounds, spacing, angle, ctx.penX * SCALE)) {
      const x = jitter > 0 ? pt.x + (rng() * 2 - 1) * jitter : pt.x
      const y = jitter > 0 ? pt.y + (rng() * 2 - 1) * jitter : pt.y
      let r: number
      if (isInside(glyph, x, y)) {
        r = maxR * (1 - falloff + falloff * toneAt(bands, x, y))
      } else {
        if (reach <= 0) continue
        const t = outsideTone(glyph, x, y, reach)
        if (t <= 0) continue
        // Grain decides what the haze is made of. At 1 each mark survives on
        // the exponential coin toss that makes spray paint read as spray; at 0
        // every mark stays and only shrinks, which is a letter out of focus.
        if (grain > 0 && rng() > Math.exp(-3 * (1 - t)) ** grain) continue
        r = maxR * 0.75 * t
      }
      r *= ramp(x, y)
      if (r < SCALE * 0.8) continue
      // a small dot needs fewer sides than a big one to still read as round
      dots.push(rounded ? disc(x, y, r, r > spacing * 0.35 ? 10 : 7) : square(x, y, r))
    }
    if (dots.length === 0) return pathsToRings(glyph)

    let merged = union(dots, FillRule.NonZero)
    // rounding the union closes the gaps between marks that already touch, so
    // a dense screen reads as blobs rather than as dots with cusps between them
    if (p.fuse > 0) merged = roundPaths(merged, (p.fuse / 100) * (spacing / SCALE) * 0.5)
    let result: Paths64
    if (p.invert >= 0.5) {
      result = difference(glyph, merged, FillRule.NonZero)
    } else if (p.solid > 0) {
      // a core of the letter kept under the dots, shrunk by the dial
      const core = grow(glyph, -(1 - p.solid / 100) * stem * 0.5)
      result = union([...merged, ...core], FillRule.NonZero)
    } else if (reach > 0) {
      // the haze lives outside the letter; clipping to it would erase the point
      result = merged
    } else {
      result = intersect(merged, glyph, FillRule.NonZero)
    }
    if (result.length === 0) return pathsToRings(glyph)
    return pathsToRings(simplify(result, p.simplify))
  },
}
