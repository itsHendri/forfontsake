import { getTreatment, type ParamSpec } from '../engine/treatments/registry'
import type { Step } from './urlState'

/** the four things the sound is split into, in the order the drive vector holds them */
export const BANDS = ['bass', 'mid', 'high', 'level'] as const
export type Band = (typeof BANDS)[number]

export const BAND_LABEL: Record<Band, string> = {
  bass: 'Bass',
  mid: 'Mids',
  high: 'Highs',
  level: 'Level',
}

/** how far a driven dial swings by default, as a share of its span */
export const DEFAULT_DEPTH = 0.35

/** only the dials somebody has reassigned; the rest are derived */
export type Bindings = Record<string, Band | null>

/**
 * Which dials the sound may ride.
 *
 * `steady` dials are excluded: they choose *which* picture rather than move
 * within one, so driving them alternates rather than animates and the word
 * strobes between two unrelated states on the beat.
 */
export function drivable(step: Step): ParamSpec[] {
  return getTreatment(step.id).params.filter((s) => s.primary && !s.steady)
}

/** a dial's address in the binding map — step position, then dial */
export const bindKey = (stepIndex: number, param: string) => `${stepIndex}:${param}`

/**
 * What a dial listens to when nobody has said otherwise.
 *
 * The first four drivable dials of each step take bass, mids, highs and level
 * in declared order, which is exactly what the sheet did before any of this
 * was adjustable — so opening the sheet sounds as it always did, and the
 * controls are there for when the declared order is the wrong order.
 */
export function defaultBand(order: number): Band | null {
  return order < BANDS.length ? BANDS[order] : null
}

/** the band a dial is riding, honouring an explicit choice over the default */
export function bandFor(
  bindings: Bindings,
  stepIndex: number,
  param: string,
  order: number,
): Band | null {
  const key = bindKey(stepIndex, param)
  return key in bindings ? bindings[key] : defaultBand(order)
}

/**
 * The dials, ridden by the sound.
 *
 * A dial's set point plus its band's drive times the depth, clamped to the
 * dial's range. Deliberately *not* snapped to the dial's step: the seed is
 * fixed, so the geometry is a continuous function of the values, and
 * un-snapped values are what let one frame morph into the next instead of
 * clicking through increments.
 *
 * The seed is never touched. This is pure parameter modulation, so any frame
 * the sheet draws is exactly reproducible from the values it was drawn with —
 * which is what makes a frame you like something you could still export.
 */
export function modulate(
  chain: Step[],
  drive: number[],
  bindings: Bindings = {},
  depth: number = DEFAULT_DEPTH,
): Step[] {
  return chain.map((step, i) => {
    const params = { ...step.params }
    drivable(step).forEach((spec, order) => {
      const band = bandFor(bindings, i, spec.key, order)
      if (!band) return
      const push = drive[BANDS.indexOf(band)] ?? 0
      const raw = (step.params[spec.key] ?? spec.default) + push * depth * (spec.max - spec.min)
      params[spec.key] = Math.min(spec.max, Math.max(spec.min, raw))
    })
    return { id: step.id, params }
  })
}
