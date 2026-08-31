import type { Ring } from '../flatten'
import type { Rng } from '../prng'

/** A parameter a treatment exposes to the UI. */
export interface ParamSpec {
  key: string
  label: string
  min: number
  max: number
  step: number
  default: number
  /** short hint shown under the control */
  note?: string
  /**
   * Front-of-house controls. A treatment should expose three or four of these;
   * everything else lives behind "more" so the common case stays a few dials.
   */
  primary?: boolean
  /**
   * Front-of-house, but the sound may not ride it.
   *
   * The specimen sheet drives the primary dials from audio, which assumes a
   * dial moves *within* a picture. Some dials instead choose *which* picture —
   * outline versus inline, fused blocks versus a dithered fringe. Driven, those
   * do not animate, they alternate: the word strobes between two unrelated
   * states on the beat and reads as a fault. They stay up front, because they
   * are the first thing you reach for by hand; they just sit still while the
   * music plays.
   */
  steady?: boolean
}

export type ParamValues = Record<string, number>

export interface TreatmentContext {
  /** deterministic, seeded per glyph — treatments must never call Math.random */
  rng: Rng
  /** font units per em */
  unitsPerEm: number
  /**
   * Median stem width of the source font, in font units.
   *
   * Size-like parameters are expressed as a percentage of this rather than of
   * the em: 100 means one stroke width. Fonts vary about twofold in how heavy
   * they are at the same em size, so a setting pinned to the em means something
   * different on every face, and a preset tuned on one is wrong on the next.
   */
  strokeWidth: number
  /** advance width of the glyph being treated */
  advanceWidth: number
  /**
   * Horizontal origin of this glyph within the em, used by treatments whose
   * pattern must line up across a word (hatch, scanline). Anchoring to the
   * glyph's bounding box instead makes stripes jump between letters.
   */
  penX: number
}

/**
 * A named starting point. Names are things, not settings — "Photocopy" tells
 * you what you are about to get in a way that "amount 70, piece 40" does not,
 * and it is the difference between a tool that reads as a design object and one
 * that reads as a control panel.
 */
export interface Preset {
  name: string
  values: ParamValues
}

/**
 * What kind of thing a treatment does to a letter.
 *
 * Seventeen names in one list is a wall; grouped, the picker answers "what
 * sort of thing am I after" before it asks "which one". The families are also
 * true rather than tidy — the ones sharing a family compete with each other
 * more than with anything else on the list.
 */
export type Family = 'erosion' | 'ink' | 'screen' | 'press' | 'structure'

export const FAMILY_LABEL: Record<Family, string> = {
  erosion: 'Wear',
  ink: 'Ink',
  screen: 'Screens',
  press: 'Press',
  structure: 'Structure',
}

export interface Treatment {
  id: string
  name: string
  family: Family
  /** one line, shown on the style card */
  blurb: string
  /**
   * A paragraph on what the treatment actually does and where it comes from,
   * shown under the dials.
   *
   * Knowing that Grit draws its piece sizes log-uniformly, or that Growth is
   * differential growth on a leash, changes how somebody reaches for the dials
   * — and it is the difference between a control panel and a thing with an
   * opinion. Credit borrowed algorithms here.
   */
  story?: string
  params: ParamSpec[]
  presets?: Preset[]
  /**
   * True when the same input always gives the same output. Alternates only
   * make sense for treatments that consume randomness; computing several
   * "variants" of a deterministic one just does the same work repeatedly.
   */
  deterministic?: boolean
  /**
   * How much this treatment can grow a glyph beyond its outline, in font
   * units, given its parameters. The builder widens advance widths to match —
   * without this, a fattening treatment makes the font set solid.
   */
  growth?: (p: ParamValues, ctx: TreatmentContext) => number
  apply(rings: Ring[], p: ParamValues, ctx: TreatmentContext): Ring[]
}

export function defaults(t: Treatment): ParamValues {
  const out: ParamValues = {}
  for (const p of t.params) out[p.key] = p.default
  return out
}
