import { intersect, union, FillRule, type Paths64 } from 'clipper2-ts'
import { SCALE, normalise, pathsToRings, simplify, boundsOf } from '../paths'
import { insetBands, toneAt, stripe } from '../tone'
import type { Ring } from '../flatten'
import type { Treatment, ParamValues, TreatmentContext } from './types'

/**
 * Scanline — the letter read back off a bad scan.
 *
 * Stripes clipped to the glyph. The line weight can ride the tone, which makes
 * the bands fatten through the middle of a stroke the way a line screen does;
 * and each band can be shoved sideways, which is the fax-machine skip.
 */
export const scanline: Treatment = {
  id: 'scanline',
  name: 'Scanline',
  family: 'screen',
  deterministic: false,
  blurb: 'Read back off a bad scan — stripes across the letter, some slipping sideways.',
  story:
    'Bands clipped out of the letter rather than drawn over it, so the result is still one '+
    'colour and still a font. Phase comes from the pen position, which is why the lines run '+
    'level across a whole word instead of restarting under each letter. Slip shoves each '+
    'band sideways by a seeded amount: the row displacement of a scanner losing sync.',
  params: [
    { key: 'spacing', label: 'Pitch', min: 6, max: 90, step: 1, default: 22, note: 'gap between lines, as % of stroke', primary: true },
    { key: 'weight', label: 'Line weight', min: 10, max: 95, step: 1, default: 55, note: '% of the pitch that is ink', primary: true },
    { key: 'angle', label: 'Angle', min: 0, max: 180, step: 1, default: 0, note: '0 is level', primary: true },
    { key: 'slip', label: 'Slip', min: 0, max: 100, step: 1, default: 0, note: 'bands shoved sideways, the scanner losing sync', primary: true },
    { key: 'taper', label: 'Taper', min: 0, max: 100, step: 1, default: 0, note: 'lines thin toward the edge of the stroke' },
    { key: 'simplify', label: 'Simplify', min: 0, max: 4, step: 0.1, default: 0.4 },
  ],

  presets: [
    { name: 'Level lines', values: { spacing: 22, weight: 55, angle: 0, slip: 0, taper: 0, simplify: 0.4 } },
    { name: 'Fine and tapered', values: { spacing: 11, weight: 45, angle: 0, slip: 0, taper: 80, simplify: 0.4 } },
    { name: 'Losing sync', values: { spacing: 26, weight: 62, angle: 0, slip: 55, taper: 0, simplify: 0.4 } },
    { name: 'Diagonal', values: { spacing: 18, weight: 50, angle: 62, slip: 0, taper: 0, simplify: 0.4 } },
  ],


  apply(rings: Ring[], p: ParamValues, ctx: TreatmentContext): Ring[] {
    if (rings.length === 0) return rings
    const glyph = simplify(normalise(rings), 1.5)
    if (glyph.length === 0) return rings

    const stem = ctx.strokeWidth
    let pitch = (p.spacing / 100) * stem * SCALE
    const b = boundsOf(glyph)
    const span = Math.hypot(b.maxX - b.minX, b.maxY - b.minY)
    // a band per line, and a font cannot carry hundreds of them
    if (span / pitch > 90) pitch = span / 90

    const angle = (p.angle * Math.PI) / 180
    const cx = (b.minX + b.maxX) / 2
    const cy = (b.minY + b.maxY) / 2
    const len = span * 1.5
    const taper = p.taper / 100
    const bands = taper > 0 ? insetBands(glyph, (pitch / SCALE) * 0.8, 4) : []
    const slip = (p.slip / 100) * stem * SCALE * 0.6
    const rng = ctx.rng

    // phase off the pen so a word's lines are one continuous set
    const phase = ((-ctx.penX * SCALE * Math.sin(angle)) % pitch) + pitch
    const half = span * 0.75
    const bandsOut: Paths64 = []
    for (let d = -half + ((phase % pitch) - pitch); d <= half; d += pitch) {
      // the band's centre, offset perpendicular to the line direction
      const px = cx - Math.sin(angle) * d
      const py = cy + Math.cos(angle) * d
      let w = pitch * (p.weight / 100)
      if (taper > 0) w *= 1 - taper + taper * toneAt(bands, px, py)
      if (w < SCALE * 0.5) continue

      // Each band is clipped on its own and only then shoved, because sliding
      // the *stripe* along its own length moves nothing — a long band looks the
      // same wherever it sits on its line. What has to move is the ink the band
      // cut out. That is the row displacement of a scanner losing sync.
      const cut = intersect(
        [stripe(px, py, len, w, angle)],
        glyph,
        FillRule.NonZero,
      )
      if (cut.length === 0) continue
      if (slip <= 0) {
        bandsOut.push(...cut)
        continue
      }
      const shove = (rng() - 0.5) * 2 * slip
      const dx = Math.cos(angle) * shove
      const dy = Math.sin(angle) * shove
      for (const ring of cut)
        bandsOut.push(ring.map((pt) => ({ x: Math.round(pt.x + dx), y: Math.round(pt.y + dy) })))
    }
    if (bandsOut.length === 0) return pathsToRings(glyph)

    const result = union(bandsOut, FillRule.NonZero)
    if (result.length === 0) return pathsToRings(glyph)
    return pathsToRings(simplify(result, p.simplify))
  },
}
