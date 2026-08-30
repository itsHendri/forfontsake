import { grit } from './grit'
import { bubble } from './bubble'
import { bleed } from './bleed'
import { outline } from './outline'
import { extrude } from './extrude'
import { mosaic } from './mosaic-treatment'
import { growth } from './growth'
import type { Ring } from '../flatten'
import type { ParamValues, Treatment, TreatmentContext } from './types'

export const TREATMENTS: Treatment[] = [grit, bubble, bleed, outline, extrude, mosaic, growth]

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

/** id, name and blurb only — for building a picker without pulling in the engine */
export function listTreatments() {
  return TREATMENTS.map((t) => ({ id: t.id, name: t.name, blurb: t.blurb }))
}

export * from './types'
