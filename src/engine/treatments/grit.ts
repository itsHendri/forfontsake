import { difference, union, area, FillRule, type Paths64 } from 'clipper2-ts'
import { NoiseField } from '../noise'
import { roughBlob } from '../blob'
import {
  SCALE,
  normalise,
  pathsToRings,
  resample,
  simplify,
  dropTinyAreas,
  boundsOf,
  isInside,
  distanceToEdge,
} from '../paths'
import type { Ring } from '../flatten'
import type { Treatment, ParamValues, TreatmentContext } from './types'

/**
 * Grit — erosion.
 *
 * Two things eat the letter: bites centred **on** the outline, which take
 * chunks out of the silhouette, and holes through the body of the strokes.
 *
 * Piece sizes are drawn log-uniformly rather than from a narrow band. Erosion
 * that comes in one size reads as a texture swatch laid over the letter; real
 * damage has a few big losses, more middling ones and a scatter of small ones,
 * and it is that spread of scales that makes it look bitten rather than
 * printed.
 */

/**
 * Log-uniform size in [base/spread, base*spread].
 *
 * A plain uniform draw clusters everything around the mean, which is what made
 * every piece look the same size. Log-uniform gives equal weight to each octave
 * of scale, so big and small pieces both actually show up.
 */
function scaleSpread(base: number, spread: number, rng: () => number): number {
  if (spread <= 1) return base
  const lo = Math.log(base / spread)
  const hi = Math.log(base * spread)
  return Math.exp(lo + (hi - lo) * rng())
}

export const grit: Treatment = {
  id: 'grit',
  name: 'Grit',
  family: 'erosion',
  blurb: 'Erosion — chunks bitten out of the edge, holes eaten through the strokes.',
  story:
    'Two kinds of loss, because damage never comes in one size. Blobs straddling the '+
    'outline take chunks out of the silhouette; blobs inside the strokes eat holes '+
    'through them. The sizes are drawn log-uniformly rather than from a narrow band — '+
    'equal weight to each octave of scale — which is what gives a few big losses, more '+
    'middling ones and a scatter of small ones. Erosion that arrives in one size reads '+
    'as a texture laid over the letter rather than as damage done to it.',
  params: [
    { key: 'amount', label: 'Amount', min: 0, max: 100, step: 1, default: 45, note: 'how much is eaten away', primary: true },
    { key: 'scale', label: 'Piece size', min: 8, max: 250, step: 1, default: 66, note: 'size of a loss, as % of stroke width', primary: true },
    { key: 'variation', label: 'Unevenness', min: 1, max: 6, step: 0.1, default: 3.6, note: 'how far sizes spread apart', primary: true },
    { key: 'balance', label: 'Edge / body', min: 0, max: 100, step: 1, default: 66, note: 'bites off the edge vs holes through the middle', primary: true },
    { key: 'cluster', label: 'Patchiness', min: 0, max: 100, step: 1, default: 45, note: 'damage gathers into patches instead of even speckle' },
    { key: 'protect', label: 'Protect cores', min: 0, max: 100, step: 1, default: 45, note: '0 erodes everywhere' },
    { key: 'roughen', label: 'Edge wander', min: 0, max: 100, step: 1, default: 30 },
    { key: 'simplify', label: 'Simplify', min: 0, max: 4, step: 0.1, default: 0.6 },
  ],

  // Photocopy reads as a light speckle and undersells the treatment; Sandblast
  // is the one that looks like what Grit is for.
  defaultPreset: 'Sandblast',

  presets: [
    { name: 'Photocopy', values: { amount: 45, scale: 35, variation: 3.4, balance: 62, cluster: 20, protect: 30, roughen: 30, simplify: 0.6 } },
    { name: 'Sandblast', values: { amount: 62, scale: 18, variation: 2.2, balance: 55, cluster: 25, protect: 15, roughen: 45, simplify: 0.5 } },
    { name: 'Rust', values: { amount: 42, scale: 73, variation: 4.2, balance: 40, cluster: 75, protect: 45, roughen: 35, simplify: 0.8 } },
    { name: 'Woodcut', values: { amount: 34, scale: 68, variation: 2.6, balance: 12, cluster: 40, protect: 55, roughen: 22, simplify: 0.9 } },
    { name: 'Corroded', values: { amount: 74, scale: 48, variation: 5.2, balance: 50, cluster: 80, protect: 12, roughen: 60, simplify: 0.6 } },
  ],

  apply(rings: Ring[], p: ParamValues, ctx: TreatmentContext): Ring[] {
    if (rings.length === 0) return rings
    const glyph = normalise(rings)
    if (glyph.length === 0) return rings

    const amount = p.amount / 100
    if (amount <= 0) return rings

    const rng = ctx.rng
    const noise = new NoiseField(rng)
    // Sized against the stroke, not the em: 100 means one stem width, so the
    // same setting bites the same proportion out of a hairline and a heavy face.
    const piece = (p.scale / 100) * ctx.strokeWidth * SCALE
    const spread = p.variation

    // Damage that lands with even probability everywhere reads as a texture
    // sprayed over the letter — the speckle that made the default look messy.
    // Real wear gathers: one corner is gone, the next inch is untouched. A
    // coherent field gates where losses are allowed at all, at a correlation
    // length of a few pieces, so the letter keeps clean stretches to be damaged
    // *against*.
    const cluster = (p.cluster ?? 0) / 100
    const corr = piece * 3
    const patch = (x: number, y: number): number => {
      if (cluster <= 0) return 1
      const f = (noise.fractal((x + 5501) / corr, (y - 3307) / corr, 2) + 1) / 2
      const eased = f * f * (3 - 2 * f)
      return 1 - cluster + cluster * eased
    }

    // --- outline roughening ------------------------------------------------
    // Low amplitude on purpose: this is the wander in an inked edge, not the
    // erosion. The bites below do the visible damage.
    let result = glyph
    const roughen = (p.roughen / 100) * amount
    if (roughen > 0) {
      const dense = resample(glyph, Math.max(piece / (SCALE * 4), 3))
      const shift = roughen * piece * 0.12
      const wandered: Paths64 = dense.map((ring) =>
        ring.map((pt) => ({
          x: Math.round(pt.x + noise.fractal(pt.x / piece, pt.y / piece, 2) * shift),
          y: Math.round(pt.y + noise.fractal((pt.x + 9173) / piece, (pt.y - 4271) / piece, 2) * shift),
        })),
      )
      const merged = union(wandered, FillRule.NonZero)
      if (merged.length > 0) result = merged
    }

    const cutters: Paths64 = []

    // --- bites, centred on the outline -------------------------------------
    // Centring on the boundary is the whole point: a blob straddling the edge
    // removes a chunk of the silhouette. Placed inside it would only carve a
    // groove parallel to the edge, which reads as a pinstripe rather than
    // erosion.
    // one dial slides between eating the edge and holing the middle; at the
    // midpoint both run at full strength
    const balance = p.balance / 100
    const biteMix = 1 - Math.max(0, (balance - 0.5) * 2)
    const speckleMix = 1 - Math.max(0, (0.5 - balance) * 2)

    const bite = biteMix * amount
    if (bite > 0) {
      const baseSpacing = piece * (1.1 - bite * 0.55)
      // Evenly spaced bites betray the algorithm however irregular each one is,
      // so the gap itself is redrawn every time.
      const nextGap = () => baseSpacing * (0.35 + rng() * 1.5)
      for (const ring of result) {
        let spacing = nextGap()
        let carried = rng() * spacing
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i]
          const b = ring[(i + 1) % ring.length]
          const segLen = Math.hypot(b.x - a.x, b.y - a.y)
          if (segLen < 1e-6) continue
          let walked = 0
          while (carried + segLen - walked >= spacing) {
            walked += spacing - carried
            carried = 0
            const f = walked / segLen
            const px = a.x + (b.x - a.x) * f
            const py = a.y + (b.y - a.y) * f
            if (rng() > (0.25 + bite * 0.7) * patch(px, py)) {
              spacing = nextGap()
              continue
            }
            // A bite wider than half the stroke can sever it outright, and the
            // unevenness multiplier alone can reach six times the base size —
            // so the draw is capped rather than trusted.
            const maxBite = ctx.strokeWidth * 0.5 * SCALE
            const r = Math.min(scaleSpread(piece * 0.5 * bite, spread, rng), maxBite)
            if (r < SCALE * 1.5) {
              spacing = nextGap()
              continue
            }
            // nudge the centre across the boundary so some bites cut deep and
            // others only nick the edge
            const off = (rng() - 0.35) * r * 0.8
            const nx = -(b.y - a.y) / segLen
            const ny = (b.x - a.x) / segLen
            cutters.push(roughBlob(px + nx * off, py + ny * off, r, noise, rng))
            spacing = nextGap()
          }
          carried += segLen - walked
        }
      }
    }

    // --- holes through the strokes -----------------------------------------
    const speckle = speckleMix * amount
    if (speckle > 0) {
      const bounds = boundsOf(result)
      const step = piece * (1.2 - speckle * 0.6)
      const jitter = step * 0.8
      // `protect` biases holes toward the edge rather than banning them from
      // the middle — at 0 the whole stroke is fair game
      const protect = p.protect / 100
      for (let y = bounds.minY - step; y <= bounds.maxY + step; y += step) {
        for (let x = bounds.minX - step; x <= bounds.maxX + step; x += step) {
          const px = x + (rng() - 0.5) * jitter
          const py = y + (rng() - 0.5) * jitter
          if (!isInside(result, px, py)) continue
          let chance = speckle * 0.85
          if (protect > 0) {
            // deeper inside a stroke is less likely to be holed, but never immune
            const d = distanceToEdge(result, px, py)
            const depth = Math.min(1, d / (piece * 1.6))
            chance *= 1 - protect * depth * 0.85
          }
          chance *= patch(px, py)
          if (rng() > chance) continue
          const r = scaleSpread(piece * 0.3 * speckle, spread, rng)
          if (r < SCALE) continue
          cutters.push(roughBlob(px, py, r, noise, rng))
        }
      }
    }

    if (cutters.length > 0) {
      const merged = union(cutters, FillRule.NonZero)
      const eaten = difference(result, merged, FillRule.NonZero)
      // if a glyph is small enough that the grit would consume it, keep it
      if (eaten.length > 0 && Math.abs(eaten.reduce((s, r) => s + area(r), 0)) > 0) {
        result = eaten
      }
    }

    result = dropTinyAreas(result, (piece / SCALE) * (piece / SCALE) * 0.01)
    result = simplify(result, p.simplify)
    return pathsToRings(result)
  },
}
