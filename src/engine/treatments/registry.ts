import { grit } from './grit'
import { bubble } from './bubble'
import { bleed } from './bleed'
import { soak } from './soak'
import { melt } from './melt'
import { growth } from './growth'
import { halftone } from './halftone'
import { stipple } from './stipple'
import { hatch } from './hatch'
import { scanline } from './scanline'
import { pixel } from './pixel'
import { ghost } from './ghost'
import { outline } from './outline'
import { onion } from './onion'
import { extrude } from './extrude'
import { mosaic } from './mosaic-treatment'
import { shatter } from './shatter'
import type { Ring } from '../flatten'
import type { Family, ParamValues, Treatment, TreatmentContext } from './types'
import { FAMILY_LABEL } from './types'

/**
 * Ordered by family, because that is how the picker groups them and how
 * somebody arrives at a choice: what sort of damage first, which one second.
 */
export const TREATMENTS: Treatment[] = [
  grit,
  bubble,
  bleed,
  soak,
  melt,
  growth,
  halftone,
  stipple,
  hatch,
  scanline,
  pixel,
  ghost,
  outline,
  onion,
  extrude,
  mosaic,
  shatter,
]

/** the families in picker order, each with the treatments that belong to it */
export function treatmentsByFamily(): { family: Family; label: string; items: Treatment[] }[] {
  const order: Family[] = ['erosion', 'ink', 'screen', 'press', 'structure']
  return order
    .map((family) => ({
      family,
      label: FAMILY_LABEL[family],
      items: TREATMENTS.filter((t) => t.family === family),
    }))
    .filter((g) => g.items.length > 0)
}

export function getTreatment(id: string): Treatment {
  const t = TREATMENTS.find((x) => x.id === id)
  if (!t) throw new Error(`unknown treatment: ${id}`)
  return t
}

/** one entry in a treatment chain */
export interface Step {
  id: string
  params: ParamValues
}

/**
 * Put one glyph's outlines through a whole stack.
 *
 * This exists in one place on purpose. The preview and the exported font are
 * built by different code over different inputs — flattened library outlines in
 * the page, real font bytes in the writer — and the single thing they must
 * agree on to the last unit is *this*: which treatments run, in what order,
 * over what context.
 *
 * The context, and so the random stream inside it, is shared by every step
 * rather than renewed per step. Treatments draw from that stream as they go, so
 * a second step handed a fresh rng would produce different geometry for the
 * same settings — and if only one of the two callers did that, the specimen on
 * screen and the font on disk would quietly stop matching. Having one function
 * makes that impossible rather than merely tested.
 */
export function applyChain(rings: Ring[], chain: Step[], ctx: TreatmentContext): Ring[] {
  let out = rings
  for (const step of chain) {
    out = getTreatment(step.id).apply(out, step.params, ctx)
    // a step that erases the glyph ends the stack rather than handing on nothing
    if (out.length === 0) break
  }
  return out
}

/** what a stack grows a glyph by, which the advance widths have to keep up with */
export function chainGrowth(chain: Step[], ctx: TreatmentContext): number {
  return chain.reduce((sum, s) => sum + (getTreatment(s.id).growth?.(s.params, ctx) ?? 0), 0)
}

/**
 * One glyph's exceptions to the global chain.
 *
 * Overrides are sparse dial deltas, never a different stack: the steps and
 * their order always come from the global chain, and `params[i]` holds only
 * the dials the user moved for this glyph at step `i`. A global slider still
 * flows through every dial the glyph has not overridden — the CSS-cascade
 * model, which is what keeps "what am I looking at" answerable.
 */
export interface GlyphOverride {
  /** per-step sparse dial values, aligned with the chain by index */
  params: ParamValues[]
  /** moves this glyph's seed off the global one — the per-glyph reroll */
  nudge?: number
}

export type Overrides = Record<string, GlyphOverride>

/**
 * The chain as it applies to one character.
 *
 * This is the only place an override is merged, for the same reason applyChain
 * is the only place a chain runs: preview, sheet and font writer must agree on
 * what a glyph's settings are, or they quietly stop matching. Returns the
 * global chain itself when the character has no deltas, so callers can keep
 * cheap identity checks.
 */
export function resolveChain(chain: Step[], overrides: Overrides | undefined, ch: string): Step[] {
  const o = overrides?.[ch]
  if (!o) return chain
  let changed = false
  const merged = chain.map((step, i) => {
    const delta = o.params[i]
    if (!delta || Object.keys(delta).length === 0) return step
    changed = true
    return { id: step.id, params: { ...step.params, ...delta } }
  })
  return changed ? merged : chain
}

// a large prime, so nudged seeds land nowhere near their neighbours
const NUDGE_PRIME = 104651

/** the seed as it applies to one character — reroll moves it, nothing else */
export function effectiveSeed(seed: number, overrides: Overrides | undefined, ch: string): number {
  const nudge = overrides?.[ch]?.nudge ?? 0
  return nudge ? seed + nudge * NUDGE_PRIME : seed
}

/** id, name and blurb only — for building a picker without pulling in the engine */
export function listTreatments() {
  return TREATMENTS.map((t) => ({ id: t.id, name: t.name, blurb: t.blurb }))
}

export * from './types'
