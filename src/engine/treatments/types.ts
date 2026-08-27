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
}

export type ParamValues = Record<string, number>

export interface TreatmentContext {
  /** deterministic, seeded per glyph — treatments must never call Math.random */
  rng: Rng
  /** font units per em, so treatments can size themselves relative to the em */
  unitsPerEm: number
  /** advance width of the glyph being treated */
  advanceWidth: number
  /**
   * Horizontal origin of this glyph within the em, used by treatments whose
   * pattern must line up across a word (hatch, scanline). Anchoring to the
   * glyph's bounding box instead makes stripes jump between letters.
   */
  penX: number
}

export interface Treatment {
  id: string
  name: string
  /** one line, shown on the style card */
  blurb: string
  params: ParamSpec[]
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
