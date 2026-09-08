import { union, FillRule, type Paths64, type Path64 } from 'clipper2-ts'
import { SCALE, normalise, pathsToRings, simplify, growStrict } from '../paths'
import { NoiseField } from '../noise'
import type { Ring } from '../flatten'
import type { Treatment, ParamValues, TreatmentContext } from './types'

/**
 * Fur — hairs standing off the edge.
 *
 * Every other treatment here works on the letter: it eats it, swells it,
 * samples it or rebuilds it. This one emits geometry *from* it, along the
 * outward normal of the outline, which is the one thing none of the others can
 * be dialled into doing. That is the whole reason it survived a consolidation
 * that folded four other candidates into styles that already existed.
 *
 * A hair is a triangle: three points, so a letter can wear hundreds and still
 * be a font. Wander leans and lengthens them from a coherent field, so the coat
 * lies in drifts rather than standing evenly on end; taken to zero with a wide
 * root it stops being fur and becomes a sawtooth.
 */

/**
 * A hair, as a triangle from a root on the outline to a tip along `d`.
 *
 * Wound positive whichever way the root faces, because the union that puts the
 * coat together is NonZero and a triangle wound the other way would punch a
 * hole through the letter instead of adding to it.
 */
function spike(x: number, y: number, dx: number, dy: number, len: number, w: number): Path64 {
  const ux = (-dy * w) / 2
  const uy = (dx * w) / 2
  const tri: Path64 = [
    { x: Math.round(x + ux), y: Math.round(y + uy) },
    { x: Math.round(x + dx * len), y: Math.round(y + dy * len) },
    { x: Math.round(x - ux), y: Math.round(y - uy) },
  ]
  const area =
    (tri[1].x - tri[0].x) * (tri[2].y - tri[0].y) - (tri[2].x - tri[0].x) * (tri[1].y - tri[0].y)
  return area < 0 ? (tri.reverse() as Path64) : tri
}

export const fur: Treatment = {
  id: 'fur',
  name: 'Fur',
  family: 'ink',
  deterministic: false,
  blurb: 'Hairs standing off the edge — fuzz, bristle, or a sawtooth of spikes.',
  story:
    'A root is walked around the outline at an even spacing and a triangle is thrown out '+
    'along the outward normal there. Which way is out comes from the winding: after the '+
    'outlines are unioned the outer ones run one way and the counters the other, so the '+
    'same rule grows hair off the outside of a stem and into the hole of an `o` without '+
    'being told which is which. Wander leans and lengthens each hair from a coherent noise '+
    'field, so the coat falls in drifts; at zero, with a wide root, the same hairs close up '+
    'into a sawtooth.',
  params: [
    { key: 'length', label: 'Length', min: 5, max: 250, step: 1, default: 55, note: 'hair length, % of stroke', primary: true },
    { key: 'density', label: 'Density', min: 6, max: 80, step: 1, default: 14, note: 'root spacing, % of stroke', primary: true },
    { key: 'width', label: 'Root width', min: 2, max: 60, step: 1, default: 7, note: '% of stroke', primary: true },
    { key: 'wander', label: 'Wander', min: 0, max: 100, step: 1, default: 55, note: 'how far the hairs lean and vary in length', primary: true },
    { key: 'lean', label: 'Lean', min: -90, max: 90, step: 1, default: 0, note: 'tilt every hair one way, in degrees' },
    { key: 'core', label: 'Keep the letter', min: 0, max: 100, step: 1, default: 100, note: 'the letter under the coat; low leaves hairs almost alone' },
    { key: 'simplify', label: 'Simplify', min: 0, max: 4, step: 0.1, default: 0.4 },
  ],

  presets: [
    { name: 'Fuzz', values: { length: 55, density: 14, width: 7, wander: 55, lean: 0, core: 100, simplify: 0.4 } },
    { name: 'Bristle', values: { length: 130, density: 22, width: 6, wander: 75, lean: 0, core: 100, simplify: 0.4 } },
    { name: 'Spikes', values: { length: 60, density: 30, width: 30, wander: 0, lean: 0, core: 100, simplify: 0.4 } },
    { name: 'Windswept', values: { length: 150, density: 20, width: 7, wander: 30, lean: 60, core: 100, simplify: 0.4 } },
    { name: 'Hairs alone', values: { length: 90, density: 16, width: 7, wander: 60, lean: 0, core: 35, simplify: 0.4 } },
  ],

  growth(p, ctx) {
    // the longest a hair gets once wander has had its say, both sides
    const reach = (p.length / 100) * ctx.strokeWidth * (1 + (0.6 * p.wander) / 100)
    return reach * 2
  },

  apply(rings: Ring[], p: ParamValues, ctx: TreatmentContext): Ring[] {
    if (rings.length === 0) return rings
    const glyph = simplify(normalise(rings), 1.5)
    if (glyph.length === 0) return rings

    const rng = ctx.rng
    const noise = new NoiseField(rng, 64)
    const stem = ctx.strokeWidth
    const len = (p.length / 100) * stem * SCALE
    const w = (p.width / 100) * stem * SCALE
    const wander = p.wander / 100
    const lean = (p.lean * Math.PI) / 180

    // Every hair is a contour until it merges with the body, and a font pays
    // for each one. Coarsen the spacing rather than refuse: the coat thins, the
    // export survives.
    let spacing = (p.density / 100) * stem * SCALE
    let perimeter = 0
    for (const ring of glyph) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]
        const b = ring[(i + 1) % ring.length]
        perimeter += Math.hypot(b.x - a.x, b.y - a.y)
      }
    }
    const cap = 220
    if (perimeter / spacing > cap) spacing = perimeter / cap

    const hairs: Paths64 = []
    for (const ring of glyph) {
      let carry = 0
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]
        const b = ring[(i + 1) % ring.length]
        const segLen = Math.hypot(b.x - a.x, b.y - a.y)
        if (segLen <= 0) continue
        const tx = (b.x - a.x) / segLen
        const ty = (b.y - a.y) / segLen
        // outward is to the right of the tangent: normalise() leaves the outer
        // contours wound one way and the counters the other, so this points out
        // of a stem and into the hole of an `o` with no test for which it is
        const nx = ty
        const ny = -tx
        for (let t = carry; t < segLen; t += spacing) {
          const rx = a.x + tx * t
          const ry = a.y + ty * t
          const bend =
            lean +
            (wander > 0
              ? noise.fractal(rx / 4000, ry / 4000, 2) * wander * 1.1 + (rng() - 0.5) * wander * 0.6
              : 0)
          const c = Math.cos(bend)
          const s = Math.sin(bend)
          const l = len * (1 - wander * 0.5 + (wander > 0 ? rng() * wander : 0))
          const rootW = w * (0.7 + rng() * 0.6)
          // sunk a little into the body, so the hair joins it rather than
          // balancing on the outline
          hairs.push(
            spike(
              rx - nx * rootW * 0.3,
              ry - ny * rootW * 0.3,
              nx * c - ny * s,
              nx * s + ny * c,
              l,
              rootW,
            ),
          )
        }
        carry = spacing - ((segLen - carry) % spacing)
        if (carry >= spacing) carry -= spacing
      }
    }
    if (hairs.length === 0) return pathsToRings(glyph)

    let base = glyph
    if (p.core < 100) {
      const shrunk = growStrict(glyph, -((1 - p.core / 100) * stem * 0.45))
      if (shrunk.length > 0) base = shrunk
    }
    const result = union([...base, ...hairs], FillRule.NonZero)
    if (result.length === 0) return pathsToRings(glyph)
    return pathsToRings(simplify(result, p.simplify))
  },
}
