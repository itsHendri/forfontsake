import { union, FillRule } from 'clipper2-ts'
import {
  normalise,
  ringsToPaths,
  pathsToRings,
  resample,
  simplify,
  dropTinyAreas,
} from '../paths'
import type { Ring } from '../flatten'
import type { Treatment, ParamValues, TreatmentContext } from './types'

/**
 * Growth — the outline is grown rather than drawn.
 *
 * The letter's edge is treated as a living curve. Each step, every point is
 * pushed off every other point near it, pulled back toward the midpoint of its
 * two neighbours, and then yanked back onto a leash tied to where it started.
 * Wherever the pushing has stretched a segment past its rest length a new point
 * is inserted, so the curve genuinely gets longer as it goes.
 *
 * That last part is the effect. A curve that gains length but may not leave its
 * leash has nowhere to put the surplus except into folds, and folds of folds —
 * which is how brain coral gets its shape, and why a few steps read as the
 * wobble of ink soaking into paper while a great many read as coral. Skip the
 * insertion and the whole thing dies: the point count stays fixed, the length
 * stays fixed, and the letter merely trembles.
 *
 * This is differential growth (Anders Hoff's differential line), reached by way
 * of the smooth-versus-relax construction in the Reaction Diffusion Typography
 * sketch. The one concession to being a font rather than a drawing is the point
 * budget: insertion stops at a hard cap per glyph, because every point is bytes
 * in the exported file and unbounded growth would put megabytes into an `m`.
 * Reaching the cap is not a failure — it is the setting where the ruffles are
 * as fine as the glyph can afford, and the tail of the run just deepens them.
 *
 * Amplitude and character are separate dials on purpose. Spread is the leash:
 * no point may ever travel further than that from where it started, which is
 * also what `growth()` reports so the advance widths keep up. Steps is how
 * developed the folding gets within that leash.
 */

interface Node {
  x: number
  y: number
  /** where this point began — the leash is measured from here */
  ox: number
  oy: number
}

/**
 * Pull each point toward the midpoint of its neighbours.
 *
 * This is what stops the repulsion below turning the curve into a starburst:
 * it is a smoothing term, and the dial that drives it is called Calm for that
 * reason. Too much and the folds iron themselves out as fast as they form.
 */
function attract(contours: Node[][], strength: number) {
  if (strength <= 0) return
  for (const c of contours) {
    const n = c.length
    if (n < 5) continue
    const nx = new Float64Array(n)
    const ny = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      const a = c[(i - 1 + n) % n]
      const b = c[(i + 1) % n]
      nx[i] = c[i].x + ((a.x + b.x) / 2 - c[i].x) * strength
      ny[i] = c[i].y + ((a.y + b.y) / 2 - c[i].y) * strength
    }
    for (let i = 0; i < n; i++) {
      c[i].x = nx[i]
      c[i].y = ny[i]
    }
  }
}

/**
 * Push every point off every other point within reach, then pull it back onto
 * its leash.
 *
 * The buckets are rebuilt each step because the points have moved. Every
 * contour of the glyph shares one hash rather than getting its own: a counter
 * has to shove against the stroke around it, and two folds arriving from
 * opposite sides have to stop rather than pass through each other.
 */
const STRIDE = 4096
const OFFSET = 1024

function repel(contours: Node[][], reach: number, push: number, leash: number) {
  const cell = reach
  const reach2 = reach * reach
  const buckets = new Map<number, Node[]>()

  for (const c of contours)
    for (const p of c) {
      const key = (Math.floor(p.x / cell) + OFFSET) * STRIDE + (Math.floor(p.y / cell) + OFFSET)
      let b = buckets.get(key)
      if (!b) {
        b = []
        buckets.set(key, b)
      }
      b.push(p)
    }

  for (const c of contours)
    for (const p of c) {
      let fx = 0
      let fy = 0
      const cx = Math.floor(p.x / cell)
      const cy = Math.floor(p.y / cell)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const b = buckets.get((cx + dx + OFFSET) * STRIDE + (cy + dy + OFFSET))
          if (!b) continue
          for (const q of b) {
            if (q === p) continue
            const ddx = p.x - q.x
            const ddy = p.y - q.y
            const d2 = ddx * ddx + ddy * ddy
            if (d2 < 1e-6 || d2 > reach2) continue
            const d = Math.sqrt(d2)
            const f = (push * (reach - d)) / reach
            fx += (ddx / d) * f
            fy += (ddy / d) * f
          }
        }
      p.x += fx
      p.y += fy

      const ex = p.x - p.ox
      const ey = p.y - p.oy
      const e2 = ex * ex + ey * ey
      if (e2 > leash * leash) {
        const s = leash / Math.sqrt(e2)
        p.x = p.ox + ex * s
        p.y = p.oy + ey * s
      }
    }
}

/**
 * Insert a point wherever the curve has stretched, drop one wherever it has
 * bunched, and stop inserting once the glyph has spent its budget.
 *
 * A new point inherits its origin from the edge it splits, so it arrives on a
 * leash of its own rather than free to wander from a position it never held.
 */
function resupply(contours: Node[][], maxEdge: number, minEdge: number, budget: number) {
  let total = 0
  for (const c of contours) total += c.length

  for (let ci = 0; ci < contours.length; ci++) {
    const c = contours[ci]
    const n = c.length
    if (n < 5) continue
    const out: Node[] = []
    for (let i = 0; i < n; i++) {
      const a = c[i]
      const b = c[(i + 1) % n]
      const d = Math.hypot(b.x - a.x, b.y - a.y)
      // bunched: drop the far end, but never below the minimum a closed
      // contour needs to stay a shape
      if (d < minEdge && out.length + (n - i - 1) > 5) continue
      out.push(a)
      if (d > maxEdge && total < budget) {
        out.push({
          x: (a.x + b.x) / 2,
          y: (a.y + b.y) / 2,
          ox: (a.ox + b.ox) / 2,
          oy: (a.oy + b.oy) / 2,
        })
        total++
      }
    }
    if (out.length >= 5) contours[ci] = out
  }
}

export const growth: Treatment = {
  // The id stays 'growth' forever — it lives in URL hashes and saved styles.
  id: 'growth',
  name: 'Organic',
  blurb: 'The edge buckles as it grows — wet ink at a few steps, coral at many.',
  story:
    'Differential growth, after Anders Hoff\u2019s differential line. Every point on the '+
    'outline pushes off its neighbours, is pulled back toward the midpoint of the two '+
    'beside it, and is held on a leash tied to where it started; wherever the pushing '+
    'stretches a segment, a new point is inserted. A curve that gains length but may not '+
    'leave its leash has nowhere to put the surplus except into folds, which is how brain '+
    'coral gets its shape. The insertion is the whole effect — without it the letter can '+
    'only tremble.',
  params: [
    { key: 'spread', label: 'Spread', min: 0, max: 120, step: 1, default: 30, note: 'how far the edge may travel, as % of stroke', primary: true },
    { key: 'steps', label: 'Steps', min: 0, max: 60, step: 1, default: 8, note: 'a few wobble, many grow coral', primary: true },
    { key: 'reach', label: 'Reach', min: 10, max: 160, step: 1, default: 60, note: 'how far points feel each other, as % of stroke', primary: true },
    { key: 'calm', label: 'Calm', min: 0, max: 100, step: 1, default: 60, note: 'smoothing — low is thorny, high is fleshy', primary: true },
    { key: 'detail', label: 'Detail', min: 4, max: 40, step: 1, default: 16, note: 'point spacing as % of stroke; finer folds cost points' },
    { key: 'simplify', label: 'Simplify', min: 0, max: 4, step: 0.1, default: 0.6 },
  ],

  // Every one of these was cut back until the word still read as the word.
  // The dials go far past all of them — a letter dissolved into brain coral is
  // a fine thing to arrive at, but it is not a thing to hand somebody as a
  // starting point.
  presets: [
    { name: 'Wet ink', values: { spread: 14, steps: 5, reach: 42, calm: 62, detail: 16, simplify: 0.6 } },
    { name: 'Swell', values: { spread: 46, steps: 10, reach: 78, calm: 70, detail: 18, simplify: 0.7 } },
    { name: 'Coral', values: { spread: 42, steps: 20, reach: 40, calm: 44, detail: 12, simplify: 0.5 } },
    { name: 'Thorn', values: { spread: 50, steps: 18, reach: 34, calm: 28, detail: 14, simplify: 0.5 } },
  ],

  growth(p, ctx) {
    return (p.spread / 100) * ctx.strokeWidth
  },

  apply(rings: Ring[], p: ParamValues, ctx: TreatmentContext): Ring[] {
    if (rings.length === 0) return rings
    const steps = Math.round(p.steps)
    const leash = (p.spread / 100) * ctx.strokeWidth
    if (steps <= 0 || leash <= 0) return rings

    // Thin before densifying: the flattened outline carries curve points the
    // resample would only duplicate, and every one of them is paid for in the
    // step loop below.
    const glyph = simplify(normalise(rings), 1.5)
    if (glyph.length === 0) return rings

    const spacing = Math.max((p.detail / 100) * ctx.strokeWidth, ctx.unitsPerEm / 400)
    const contours: Node[][] = pathsToRings(resample(glyph, spacing))
      .filter((r) => r.length >= 5)
      .map((r) => r.map((pt) => ({ x: pt.x, y: pt.y, ox: pt.x, oy: pt.y })))
    if (contours.length === 0) return rings

    // A resampled straight edge is perfectly symmetric, and symmetric forces
    // cancel: without this nudge a stem would sit there while a round letter
    // buckled, and the same word would come out half-grown. The jitter is far
    // below the leash — it decides where the buckling starts, not how big it
    // gets.
    const jitter = spacing * 0.18
    for (const c of contours)
      for (const pt of c) {
        pt.x += (ctx.rng() - 0.5) * jitter
        pt.y += (ctx.rng() - 0.5) * jitter
      }

    const reach = Math.max((p.reach / 100) * ctx.strokeWidth, spacing * 1.2)
    // Sized against the spacing rather than the em so one setting behaves the
    // same on a hairline and a heavy face. The leash does the limiting, so this
    // only has to be big enough that the folds arrive within the step count
    // somebody is willing to wait for.
    const push = spacing * 0.5
    const calm = p.calm / 100

    // Every point is bytes in the exported font, and folding is unbounded —
    // this is the line between a treatment and a glyph nobody can install. An
    // untreated glyph runs to a couple of hundred points; a few times that buys
    // all the folding the eye can read at text size, and the ceiling stops a
    // heavy face from turning a whole alphabet into megabytes.
    const budget = Math.min(700, contours.reduce((n, c) => n + c.length, 0) * 5 + 120)

    for (let i = 0; i < steps; i++) {
      repel(contours, reach, push, leash)
      attract(contours, calm)
      resupply(contours, spacing * 1.5, spacing * 0.5, budget)
    }

    // Growth crosses the outline over itself — that is what a ruffle is once it
    // is deep enough. Non-zero union resolves the crossings into one clean
    // region and keeps the counters, which still wind the other way.
    const grown = union(
      ringsToPaths(contours.map((c) => c.map((pt) => ({ x: pt.x, y: pt.y })))),
      FillRule.NonZero,
    )
    if (grown.length === 0) return rings

    let result = dropTinyAreas(grown, spacing * spacing * 0.25)
    result = simplify(result, p.simplify)
    return result.length > 0 ? pathsToRings(result) : rings
  },
}
