import { union, difference, FillRule, type Paths64 } from 'clipper2-ts'
import { normalise, pathsToRings, shift, simplify, grow } from '../paths'
import type { Ring } from '../flatten'
import type { Treatment, ParamValues, TreatmentContext } from './types'

/**
 * Extrude — the block shadow under sign-painted and graffiti lettering.
 *
 * The solid is the letter swept along a direction: copies translated in small
 * steps and unioned. Stepping rather than offsetting matters — an offset grows
 * the shape in every direction, where a sweep only fills the corridor the
 * letter travels through, which is what gives the flat-sided look.
 *
 * Everything here is one colour, so the classic look is faked the way a
 * one-colour print fakes it: the face is drawn as an outline and the shadow as
 * a solid, and the eye supplies the rest. A merged face-plus-shadow silhouette
 * — what this treatment used to produce — just reads as a slightly bolder
 * letter, which is no shadow at all.
 *
 * `layer` picks what comes out. Shade and face alone are kept for the true
 * two-colour version: build the font twice, stack the results.
 */
export const extrude: Treatment = {
  id: 'extrude',
  name: 'Extrude',
  family: 'structure',
  deterministic: true,
  blurb: 'An outlined face over a solid block shadow.',
  story:
    'The shadow is the letter swept along a direction: copies translated in small steps '+
    'and unioned. Sweeping rather than offsetting is what matters — an offset grows the '+
    'shape every way at once, where a sweep only fills the corridor the letter travels '+
    'through, and that is where the flat sides of a sign-painted block shadow come from. '+
    'In one colour the face is drawn hollow so the shadow reads as behind it; face and '+
    'shade can also be built separately, so the two-colour version is two exports stacked.',
  params: [
    { key: 'depth', label: 'Depth', min: 0, max: 400, step: 1, default: 150, note: '% of stroke width', primary: true },
    { key: 'angle', label: 'Angle', min: 0, max: 359, step: 1, default: 315, note: 'degrees, 315 throws it down-right', primary: true },
    { key: 'layer', label: 'Layer', min: 0, max: 2, step: 1, default: 0, note: '0 outline + shade · 1 shade only · 2 face only', primary: true },
    { key: 'line', label: 'Line weight', min: 4, max: 80, step: 1, default: 20, note: 'the face outline, % of stroke width' },
    { key: 'simplify', label: 'Simplify', min: 0, max: 4, step: 0.1, default: 0.5 },
  ],

  presets: [
    { name: 'Block', values: { depth: 150, angle: 315, layer: 0, line: 20, simplify: 0.5 } },
    { name: 'Long throw', values: { depth: 280, angle: 315, layer: 0, line: 20, simplify: 0.6 } },
    { name: 'Drop', values: { depth: 110, angle: 270, layer: 0, line: 24, simplify: 0.5 } },
    { name: 'Shade only', values: { depth: 150, angle: 315, layer: 1, line: 20, simplify: 0.5 } },
  ],

  growth(p, ctx) {
    const stem = ctx.strokeWidth / 100
    const mode = Math.round(p.layer)
    if (mode === 2) return 0
    // the shadow's throw, plus (with a face) the outline band past the edge
    const band = mode === 0 ? (p.line ?? 20) * stem : 0
    return Math.round(p.depth * stem + band)
  },

  apply(rings: Ring[], p: ParamValues, ctx: TreatmentContext): Ring[] {
    if (rings.length === 0) return rings
    const glyph = simplify(normalise(rings), 1.5)
    if (glyph.length === 0) return rings
    const mode = Math.round(p.layer)
    if (mode === 2) return pathsToRings(glyph)

    // the face as a band about its own edge, same construction as Outline
    const half = ((p.line ?? 20) / 100) * ctx.strokeWidth / 2
    const face = () => {
      const band = difference(grow(glyph, +half), grow(glyph, -half), FillRule.NonZero)
      return band.length > 0 ? band : glyph
    }

    if (p.depth <= 0) return pathsToRings(mode === 0 ? face() : glyph)

    // the throw is a multiple of the stroke, so the shadow stays in proportion
    // to the letter's weight rather than to the em
    const depth = (p.depth / 100) * ctx.strokeWidth
    const rad = (p.angle * Math.PI) / 180
    const dx = Math.cos(rad) * depth
    const dy = Math.sin(rad) * depth

    // enough steps that consecutive copies overlap rather than leaving gaps;
    // step length is capped so a deep extrude does not cost hundreds of unions
    const stepLen = Math.max(4, depth / 40)
    const steps = Math.max(2, Math.ceil(depth / stepLen))

    const copies: Paths64 = []
    for (let i = 0; i <= steps; i++) {
      const f = i / steps
      copies.push(...shift(glyph, dx * f, dy * f))
    }
    const swept = union(copies, FillRule.NonZero)
    if (swept.length === 0) return pathsToRings(glyph)

    // the shade alone: everything the sweep covers that the letter does not
    const shade = difference(swept, glyph, FillRule.NonZero)

    let result: Paths64
    if (mode === 1) {
      result = shade.length > 0 ? shade : swept
    } else {
      // hollow face over solid shadow — reads as depth even in one colour
      result = union([...shade, ...face()], FillRule.NonZero)
      if (result.length === 0) result = swept
    }

    result = simplify(result, p.simplify)
    return pathsToRings(result)
  },
}
