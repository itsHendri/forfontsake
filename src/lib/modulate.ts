import { getTreatment, type ParamSpec } from '../engine/treatments/registry'
import { EnvelopeFollower } from '../audio/EnvelopeFollower'
import type { AudioFrame } from '../audio/frame'
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

/**
 * How far a driven dial swings, as a share of its span — now in *both*
 * directions from where you left it, so a third of what it was is more motion
 * than it sounds. The sheet is a way of looking at the font you made, not a
 * second place to design one, so the letters should read as themselves
 * breathing rather than as a different cut on every beat.
 */
export const DEFAULT_DEPTH = 0.15

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
 * The drive is **signed** — see `SoundDrive`. It used to be a level between 0
 * and 1, which could only ever be added, so the value you set was the quietest
 * the sheet ever got and everything you actually looked at was heavier than the
 * font you had made. Centred, your setting is the average instead of the floor.
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

/**
 * What the sound does to the letters, as a named thing rather than a matrix.
 *
 * The sheet used to expose one row per drivable dial with a band picker on it.
 * That is a prosumer control — OpenMosh and Neural Frames have it, and even
 * they put an automatic mode in front of it, while the closest peer (Dinamo's
 * Font Gauntlet) maps one signal to one axis and stops. So the front of house
 * is three named movements and a Depth slider, and the per-dial map underneath
 * is still exactly the `Bindings` record it always was — a mode is just a
 * function that fills one in.
 */
export interface SoundMode {
  id: string
  name: string
  note: string
  /** the band a dial rides, given its position among its step's drivable dials */
  band(order: number): Band | null
}

export const MODES: SoundMode[] = [
  {
    id: 'pulse',
    name: 'Pulse',
    note: 'the beat moves the headline dial, and the rest hold still',
    band: (order) => (order === 0 ? 'bass' : order === 1 ? 'level' : null),
  },
  {
    id: 'breathe',
    name: 'Breathe',
    note: 'the body of the sound swells every dial at once',
    band: () => 'mid',
  },
  {
    id: 'shimmer',
    name: 'Shimmer',
    note: 'the top end only, so the detail moves and the shape does not',
    band: (order) => (order === 0 ? 'high' : 'mid'),
  },
]

export const DEFAULT_MODE = MODES[0]

export function getMode(id: string): SoundMode {
  return MODES.find((m) => m.id === id) ?? DEFAULT_MODE
}

/**
 * A mode, resolved into the binding map `modulate` already understands.
 *
 * Rebuilt from the chain rather than stored, for the same reason the old
 * overrides were derived: a map keyed by step position goes stale the moment a
 * layer is added, removed or retreated, and a stale map drives the wrong dial.
 */
export function bindingsFor(mode: SoundMode, chain: Step[]): Bindings {
  const out: Bindings = {}
  chain.forEach((step, i) => {
    drivable(step).forEach((spec, order) => {
      out[bindKey(i, spec.key)] = mode.band(order)
    })
  })
  return out
}

/**
 * The four bands, as deviations from what the sound has lately been doing.
 *
 * Two followers per band. The fast one is the motion — slower than the
 * analyser's own, which is tuned for light shows and made to twitch — and the
 * slow one is a running sense of how loud this material is. Driving on the
 * difference is what centres the movement on the dial's set point: a steady
 * passage settles back to the font you made, a transient pushes above it and
 * the dip after it pulls below.
 *
 * That also makes it self-levelling. A quiet recording and a loud one both
 * move the letters about as much, where an absolute level would leave one
 * inert and pin the other at the top of every dial.
 */
export class SoundDrive {
  private readonly fast = [
    new EnvelopeFollower(0.3, 0.9), // bass + beat
    new EnvelopeFollower(0.45, 1.1), // mids
    new EnvelopeFollower(0.25, 0.8), // highs
    new EnvelopeFollower(0.55, 1.3), // level
  ]
  // rises to meet the sound in about a second so there is no lurch at the
  // start, and lets go slowly so a loud bar does not become the new normal
  private readonly slow = BANDS.map(() => new EnvelopeFollower(1.2, 4))

  read(f: AudioFrame, dt: number): number[] {
    const targets = [Math.min(1, f.bass + f.beat * 0.5), f.mid, f.high, f.level]
    return targets.map((t, i) => {
      const now = this.fast[i].update(t, dt)
      const baseline = this.slow[i].update(t, dt)
      return Math.max(-1, Math.min(1, now - baseline))
    })
  }
}
