import type { ParamValues } from './types'

/**
 * Treatments that were folded into another one, and how a step written before
 * the merge becomes a step the current registry can run.
 *
 * Treatment ids are permanent, because they live in shared links and on the
 * shelf. Merging one away breaks that promise unless the id keeps opening on
 * the thing it described — so it is translated here rather than dropped, and
 * its dials are converted with it: the numbers meant different things in the
 * treatment that has gone, and carrying them across unchanged would open the
 * link on a picture nobody chose.
 *
 * A link older than this file has no way to know it; keeping the translation in
 * one place is what stops the URL reader, the shelf and the font writer each
 * inventing their own.
 *
 * A treatment that was cut rather than merged has no honest translation — there
 * is nothing left that draws what it drew. Those steps are dropped, and the
 * link opens on the rest of the stack it described rather than on a lie.
 */

interface Step {
  id: string
  params: ParamValues
}

/** a dial that never travelled, or arrived mangled, falls back rather than NaN */
function num(p: ParamValues, key: string, fallback: number): number {
  const v = p[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

const MERGED: Record<string, (p: ParamValues) => Step> = {
  // Soak was grow, round, put the counters back — which is what Bubble does.
  // Its Melt was a share of a third of the stem where Bubble's Rounding is the
  // share itself, so the number carries that factor across.
  soak: (p) => ({
    id: 'bubble',
    params: {
      weight: num(p, 'swell', 14),
      rounding: Math.round(num(p, 'melt', 55) * 0.35),
      squeeze: num(p, 'counters', 65),
      simplify: num(p, 'simplify', 0.5),
    },
  }),

  // Outline is Onion with a single ring. Its Style counted outward — outline,
  // hairline, inline — where Onion's counts inward, so the modes swap ends.
  outline: (p) => ({
    id: 'onion',
    params: {
      style: [2, 1, 0][Math.min(2, Math.max(0, Math.round(num(p, 'mode', 0))))],
      lines: 1,
      weight: num(p, 'weight', 22),
      beaded: 0,
      gap: 13,
      position: num(p, 'inset', 0),
      rounding: num(p, 'rounding', 0),
      simplify: num(p, 'simplify', 0.4),
    },
  }),

  // Stipple is Halftone with the grid loosened all the way and the dots
  // carrying past the edge. Both size a mark from the same formula, so only
  // the sampler dials move.
  stipple: (p) => ({
    id: 'halftone',
    params: {
      spacing: num(p, 'density', 19),
      size: num(p, 'size', 78),
      scatter: 100,
      spray: num(p, 'spray', 45),
      angle: 45,
      falloff: num(p, 'falloff', 40),
      solid: num(p, 'solid', 55),
      // Stipple's haze was always the broken-up kind, and it never faded or fused
      grain: 100,
      fade: 0,
      fadeAngle: 90,
      fuse: 0,
      shape: 0,
      invert: 0,
      simplify: num(p, 'simplify', 0.4),
    },
  }),

  // Ghost drew the fringe two impressions leave as a boolean, which is why it
  // read as almost nothing. Extrude already builds the offset copy and already
  // separates shade from face, so the fringe is its shade — and screening that
  // shade is the grey a misprint actually prints. The translation stays
  // faithful and leaves the screen off; the rebuild is a dial away.
  ghost: (p) => ({
    id: 'extrude',
    params: {
      depth: num(p, 'drift', 14),
      // Ghost read 0 as "let it wander", which has no direction to carry over
      angle: num(p, 'angle', 0) > 0 ? num(p, 'angle', 0) : 315,
      taper: 0,
      screen: 0,
      pattern: 0,
      pitch: 30,
      layer: Math.round(num(p, 'mode', 2)) === 1 ? 1 : 3,
      line: 20,
      simplify: num(p, 'simplify', 0.4),
    },
  }),
}

/**
 * Treatments that kept their id but retired a dial. Only the dial moves, so
 * anything the step already carries is left exactly as it was.
 */
const RENAMED: Record<string, (p: ParamValues) => ParamValues> = {
  // Onion traded Outward, a blend, for Style, a choice of three, when it
  // absorbed Outline. The two settings anyone actually saved were the ends.
  onion: (p) => {
    if (!('outward' in p) || 'style' in p) return p
    const { outward, ...rest } = p
    return { ...rest, style: outward >= 50 ? 2 : 0 }
  },
}

/**
 * Cut outright, with nothing that stands in for them.
 *
 * Melt sagged the letter off its baseline and drew drips by hiding narrowed
 * copies inside the body. Nothing else in the registry sags, so mapping it
 * anywhere would open the link on a picture its author never chose.
 */
const CUT: ReadonlySet<string> = new Set(['melt'])

/** whether a step's treatment has been folded into another one, or cut */
export function isRetired(id: string): boolean {
  return id in MERGED || CUT.has(id)
}

/** a step as the current registry can run it, or null if it was cut */
export function migrateStep(step: Step): Step | null {
  if (CUT.has(step.id)) return null
  const merged = MERGED[step.id]
  if (merged) return merged(step.params)
  const renamed = RENAMED[step.id]
  return renamed ? { id: step.id, params: renamed(step.params) } : step
}
