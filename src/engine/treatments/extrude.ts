import { union, difference, intersect, FillRule, type Paths64 } from 'clipper2-ts'
import { SCALE, normalise, pathsToRings, shift, simplify, grow, growStrict, boundsOf } from '../paths'
import { disc, stripe, screenGrid } from '../tone'
import type { Ring } from '../flatten'
import type { Treatment, ParamValues, TreatmentContext } from './types'

/**
 * Extrude — the letter offset from itself, and everything that lives in the gap.
 *
 * The solid is the letter swept along a direction: copies translated in small
 * steps and unioned. Stepping rather than offsetting matters — an offset grows
 * the shape in every direction, where a sweep only fills the corridor the
 * letter travels through, which is what gives the flat-sided look.
 *
 * Three pictures come out of that one corridor, and they were three treatments
 * until it was clear they were the same loop. Left solid it is a sign-painter's
 * block shadow. Thinned as it goes, it is a letter dragged across the paper.
 * Screened, it is the second impression of a plate out of register — grey where
 * a boolean fringe would have been hard, which is what a misprint actually
 * looks like.
 *
 * Everything here is one colour, so depth is faked the way a one-colour print
 * fakes it: the face is drawn as an outline over a solid shadow and the eye
 * supplies the rest. That only holds while the shadow *is* solid; once it is
 * screened down to a grey, a solid face reads better than a hollow one, which
 * is what Layer 3 is for.
 */
export const extrude: Treatment = {
  id: 'extrude',
  name: 'Extrude',
  family: 'press',
  // the screen consumes randomness only through its own dials; the sweep is
  // exact, so at screen 0 nothing here is rolled
  deterministic: true,
  blurb: 'The letter offset from itself — a block shadow, a drag, or a second impression out of register.',
  story:
    'The shadow is the letter swept along a direction: copies translated in small steps '+
    'and unioned. Sweeping rather than offsetting is what matters — an offset grows the '+
    'shape every way at once, where a sweep only fills the corridor the letter travels '+
    'through, and that is where the flat sides of a sign-painted block shadow come from. '+
    'Taper shrinks each copy as it goes, which turns the corridor into a trail; Screen '+
    'takes the shadow down to a grey with dots or with lines running along the throw, '+
    'which is a plate that printed twice and missed. Face and shade can also be built '+
    'separately, so the two-colour version is two exports stacked.',
  params: [
    { key: 'depth', label: 'Depth', min: 0, max: 400, step: 1, default: 150, note: '% of stroke width', primary: true },
    { key: 'angle', label: 'Angle', min: 0, max: 359, step: 1, default: 315, note: 'degrees, 315 throws it down-right', primary: true },
    { key: 'taper', label: 'Taper', min: 0, max: 100, step: 1, default: 0, note: 'thins the shadow as it goes, into a trail', primary: true },
    { key: 'screen', label: 'Screen', min: 0, max: 100, step: 1, default: 0, note: 'take the shadow down to a grey; 0 leaves it solid', primary: true },
    { key: 'pattern', label: 'Screen shape', min: 0, max: 1, step: 1, default: 0, note: '0 dots · 1 lines along the throw', steady: true },
    { key: 'pitch', label: 'Screen pitch', min: 8, max: 80, step: 1, default: 30, note: '% of stroke width' },
    { key: 'layer', label: 'Layer', min: 0, max: 3, step: 1, default: 0, note: '0 outline + shade · 1 shade only · 2 face only · 3 solid letter + shade', steady: true },
    { key: 'line', label: 'Line weight', min: 4, max: 80, step: 1, default: 20, note: 'the face outline, % of stroke width' },
    { key: 'simplify', label: 'Simplify', min: 0, max: 4, step: 0.1, default: 0.5 },
  ],

  presets: [
    { name: 'Block', values: { depth: 150, angle: 315, taper: 0, screen: 0, pattern: 0, pitch: 30, layer: 0, line: 20, simplify: 0.5 } },
    { name: 'Long throw', values: { depth: 280, angle: 315, taper: 0, screen: 0, pattern: 0, pitch: 30, layer: 0, line: 20, simplify: 0.6 } },
    { name: 'Drop', values: { depth: 110, angle: 270, taper: 0, screen: 0, pattern: 0, pitch: 30, layer: 0, line: 24, simplify: 0.5 } },
    { name: 'Shade only', values: { depth: 150, angle: 315, taper: 0, screen: 0, pattern: 0, pitch: 30, layer: 1, line: 20, simplify: 0.5 } },
    // dragged across the paper: the corridor thinned to a trail, and cut into
    // lines running the way it travelled
    { name: 'Dragged', values: { depth: 220, angle: 0, taper: 70, screen: 55, pattern: 1, pitch: 26, layer: 3, line: 20, simplify: 0.5 } },
    { name: 'Motion', values: { depth: 300, angle: 0, taper: 90, screen: 0, pattern: 1, pitch: 26, layer: 3, line: 20, simplify: 0.5 } },
    // the plate that printed twice and missed — grey, never a hard fringe
    { name: 'Grey ghost', values: { depth: 60, angle: 315, taper: 0, screen: 55, pattern: 0, pitch: 40, layer: 3, line: 20, simplify: 0.4 } },
    { name: 'Lined echo', values: { depth: 70, angle: 0, taper: 0, screen: 50, pattern: 1, pitch: 24, layer: 3, line: 20, simplify: 0.4 } },
  ],

  growth(p, ctx) {
    const stem = ctx.strokeWidth / 100
    const mode = Math.round(p.layer)
    if (mode === 2) return 0
    // the shadow's throw, plus (with an outlined face) the band past the edge
    const band = mode === 0 ? (p.line ?? 20) * stem : 0
    return Math.round(p.depth * stem + band)
  },

  apply(rings: Ring[], p: ParamValues, ctx: TreatmentContext): Ring[] {
    if (rings.length === 0) return rings
    const glyph = simplify(normalise(rings), 1.5)
    if (glyph.length === 0) return rings
    const mode = Math.round(p.layer)
    if (mode === 2) return pathsToRings(glyph)

    const stem = ctx.strokeWidth
    // the face as a band about its own edge, same construction as Onion
    const half = ((p.line ?? 20) / 100) * stem / 2
    const face = () => {
      const band = difference(grow(glyph, +half), grow(glyph, -half), FillRule.NonZero)
      return band.length > 0 ? band : glyph
    }
    // what sits in front: hollow over a solid shadow, solid over a screened one
    const front = () => (mode === 3 ? glyph : face())

    if (p.depth <= 0) return pathsToRings(mode === 1 ? glyph : front())

    // the throw is a multiple of the stroke, so the shadow stays in proportion
    // to the letter's weight rather than to the em
    const depth = (p.depth / 100) * stem
    const rad = (p.angle * Math.PI) / 180
    const dx = Math.cos(rad) * depth
    const dy = Math.sin(rad) * depth

    // enough steps that consecutive copies overlap rather than leaving gaps;
    // step length is capped so a deep extrude does not cost hundreds of unions
    const stepLen = Math.max(4, depth / 40)
    const steps = Math.max(2, Math.ceil(depth / stepLen))
    // How far the trail is allowed to close. Half a stroke is the point where
    // the far end is a hairline; past it the copies collapse and the trail
    // simply ends, which is what a drag running out of ink does anyway.
    const pinch = (p.taper / 100) * stem * 0.5

    const copies: Paths64 = []
    for (let i = 0; i <= steps; i++) {
      const f = i / steps
      // eased, so the trail holds its weight and then lets go rather than
      // narrowing evenly the whole way
      const thin = pinch > 0 ? pinch * Math.pow(f, 1.3) : 0
      const copy = thin > 0 ? growStrict(glyph, -thin) : glyph
      if (copy.length === 0) break
      copies.push(...shift(copy, dx * f, dy * f))
    }
    const swept = union(copies, FillRule.NonZero)
    if (swept.length === 0) return pathsToRings(glyph)

    // the shade alone: everything the sweep covers that the letter does not
    let shade = difference(swept, glyph, FillRule.NonZero)

    // Screened, the shadow reads as a lighter ink rather than a second solid.
    // One colour cannot print grey, so the grey is holes: the more the dial
    // asks for, the less of each mark survives.
    if (p.screen > 0 && shade.length > 0) {
      const tone = 1 - p.screen / 100
      let pitch = (p.pitch / 100) * stem * SCALE
      const b = boundsOf(shade)
      const area = (b.maxX - b.minX) * (b.maxY - b.minY)
      const cap = 320
      if (area / (pitch * pitch) > cap) pitch = Math.sqrt(area / cap)
      const marks: Paths64 = []
      if (p.pattern < 0.5) {
        // dots on a 45° screen, phased on the pen so a word shares one grid
        const r = (pitch / 2) * Math.sqrt(Math.max(tone, 0.02)) * 1.15
        for (const pt of screenGrid(b, pitch, Math.PI / 4, ctx.penX * SCALE)) {
          marks.push(disc(pt.x, pt.y, r, 7))
        }
      } else {
        // lines running the way the shadow was thrown, so a drag streaks
        const span = Math.hypot(b.maxX - b.minX, b.maxY - b.minY) + pitch * 2
        const cx = (b.minX + b.maxX) / 2
        const cy = (b.minY + b.maxY) / 2
        const px = -Math.sin(rad)
        const py = Math.cos(rad)
        const phase = (((ctx.penX * SCALE * py) % pitch) + pitch) % pitch
        const n = Math.ceil(span / pitch / 2)
        for (let k = -n; k <= n; k++) {
          const off = k * pitch + phase
          marks.push(stripe(cx + px * off, cy + py * off, span, pitch * Math.max(tone, 0.05), rad))
        }
      }
      const screened = intersect(shade, union(marks, FillRule.NonZero), FillRule.NonZero)
      // a screen fine enough to erase the shadow entirely leaves it solid
      // rather than leaving nothing where a shadow was asked for
      if (screened.length > 0) shade = screened
    }

    let result: Paths64
    if (mode === 1) {
      result = shade.length > 0 ? shade : swept
    } else {
      result = union([...shade, ...front()], FillRule.NonZero)
      if (result.length === 0) result = swept
    }

    result = simplify(result, p.simplify)
    return pathsToRings(result)
  },
}
