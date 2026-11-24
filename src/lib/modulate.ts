import { getTreatment, type ParamSpec } from '../engine/treatments/registry'
import { CHANNELS, type Channel } from './motion'
import type { Step } from './urlState'

/**
 * The four curves a dial can follow, in the order the drive vector holds them.
 * They were the sound's bands — bass, mids, highs, level — and kept their
 * places when the sound went, so the modes below still mean what they meant.
 */
export const BANDS = CHANNELS
export type Band = Channel

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
 * Which dials the motion may ride.
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
 * What a dial follows when nobody has said otherwise.
 *
 * The first four drivable dials of each step take the four curves in declared
 * order, which is what the sheet did before any of this was adjustable.
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
 * The dials, ridden by the motion.
 *
 * A dial's set point plus its band's drive times the depth, clamped to the
 * dial's range. Deliberately *not* snapped to the dial's step: the seed is
 * fixed, so the geometry is a continuous function of the values, and
 * un-snapped values are what let one frame morph into the next instead of
 * clicking through increments.
 *
 * The drive is **signed** — see `motionAt`. It used to be a level between 0
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
 * What the motion does to the letters, as a named thing rather than a matrix.
 *
 * The sheet used to expose one row per drivable dial with a band picker on it.
 * That is a prosumer control — OpenMosh and Neural Frames have it, and even
 * they put an automatic mode in front of it, while the closest peer (Dinamo's
 * Font Gauntlet) maps one signal to one axis and stops. So a named movement
 * comes first, and the per-dial map underneath is exactly the `Bindings`
 * record it always was: a mode is just a function that fills one in. Since
 * November the map is on show again, as the timeline's rows (below): the mode
 * fills them, and any one can be changed by hand.
 */
export interface MotionMode {
  id: string
  name: string
  note: string
  /** the band a dial rides, given its position among its step's drivable dials */
  band(order: number): Band | null
}

export const MODES: MotionMode[] = [
  {
    id: 'pulse',
    name: 'Pulse',
    note: 'a beat moves the headline dial, a slow drift the next, and the rest hold still',
    band: (order) => (order === 0 ? 'beat' : order === 1 ? 'drift' : null),
  },
  {
    id: 'breathe',
    name: 'Breathe',
    note: 'every dial swells and settles at once, like a breath',
    band: () => 'swell',
  },
  {
    id: 'shimmer',
    name: 'Shimmer',
    note: 'a quick flicker on the detail while the rest swell slowly underneath',
    band: (order) => (order === 0 ? 'flicker' : 'swell'),
  },
]

export const DEFAULT_MODE = MODES[0]

export function getMode(id: string): MotionMode {
  return MODES.find((m) => m.id === id) ?? DEFAULT_MODE
}

/**
 * A mode, resolved into the binding map `modulate` already understands.
 *
 * Rebuilt from the chain rather than stored, for the same reason the old
 * overrides were derived: a map keyed by step position goes stale the moment a
 * layer is added, removed or retreated, and a stale map drives the wrong dial.
 */
export function bindingsFor(mode: MotionMode, chain: Step[]): Bindings {
  const out: Bindings = {}
  chain.forEach((step, i) => {
    drivable(step).forEach((spec, order) => {
      out[bindKey(i, spec.key)] = mode.band(order)
    })
  })
  return out
}

/*
 * The timeline's rows.
 *
 * Compose used to show three named movements and keep the per-dial map out of
 * sight. Hendri picked the video-editor dock in November, where the map is the
 * thing you look at: one row per drivable dial, each following a curve you can
 * see and change. The presets still come first, filling the rows, and a
 * row changed by hand is an explicit binding laid over what the preset said.
 */

/** what a row can follow, as the timeline names it. Hold follows nothing. */
export const CURVES: { band: Band | null; name: string; note: string }[] = [
  { band: 'beat', name: 'Beat', note: 'a quick rise and a slow fall, about every second' },
  { band: 'drift', name: 'Drift', note: 'slower than everything else, once or twice a loop' },
  { band: 'swell', name: 'Swell', note: 'a breath in and out, every few seconds' },
  { band: 'flicker', name: 'Flicker', note: 'three quick rates that never line up' },
  { band: null, name: 'Hold', note: 'stays where you set it' },
]

export function curveName(band: Band | null): string {
  return CURVES.find((c) => c.band === band)?.name ?? 'Hold'
}

/** which motion a series of rows is for: the chain's treatments in order */
export const chainKey = (chain: Step[]) => chain.map((s) => s.id).join('+')

/**
 * The rows changed by hand that still mean something on this chain.
 *
 * Keyed by step and dial, so a row for a dial this chain does not have (a
 * look pasted from another font, a layer since removed) is dropped rather
 * than left to drive whatever now sits at that address.
 */
export function liveRows(chain: Step[], rows: Bindings): Bindings {
  const out: Bindings = {}
  chain.forEach((step, i) => {
    for (const spec of drivable(step)) {
      const key = bindKey(i, spec.key)
      if (key in rows) out[key] = rows[key]
    }
  })
  return out
}

/** the preset, with the rows changed by hand laid over it: what modulate() is handed */
export function resolveBindings(mode: MotionMode, chain: Step[], rows: Bindings): Bindings {
  return { ...bindingsFor(mode, chain), ...liveRows(chain, rows) }
}

/**
 * One row changed: kept as an explicit binding, or dropped again when it is
 * put back on what the preset gives it, so a row returned by hand stops
 * counting as custom.
 */
export function setRow(mode: MotionMode, chain: Step[], rows: Bindings, key: string, band: Band | null): Bindings {
  const preset = bindingsFor(mode, chain)
  const next = { ...rows }
  if (preset[key] === band) delete next[key]
  else next[key] = band
  return liveRows(chain, next)
}

export interface Track {
  key: string
  stepIndex: number
  spec: ParamSpec
  /** the treatment's name, for a stack, where two layers can both have a Weight */
  treatment: string
  band: Band | null
  /** changed by hand, off what the preset gives it */
  custom: boolean
}

/** every drivable dial of every step, top to bottom, with what it follows */
export function tracksFor(mode: MotionMode, chain: Step[], rows: Bindings): Track[] {
  const preset = bindingsFor(mode, chain)
  const live = liveRows(chain, rows)
  const out: Track[] = []
  chain.forEach((step, i) => {
    const t = getTreatment(step.id)
    for (const spec of drivable(step)) {
      const key = bindKey(i, spec.key)
      const custom = key in live
      out.push({ key, stepIndex: i, spec, treatment: t.name, band: custom ? live[key] : (preset[key] ?? null), custom })
    }
  })
  return out
}
