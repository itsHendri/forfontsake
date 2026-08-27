import { grit } from './grit'
import { bubble } from './bubble'
import { outline } from './outline'
import { extrude } from './extrude'
import { mosaic } from './mosaic-treatment'
import type { Treatment } from './types'

export const TREATMENTS: Treatment[] = [grit, bubble, outline, extrude, mosaic]

export function getTreatment(id: string): Treatment {
  const t = TREATMENTS.find((x) => x.id === id)
  if (!t) throw new Error(`unknown treatment: ${id}`)
  return t
}

/** id, name and blurb only — for building a picker without pulling in the engine */
export function listTreatments() {
  return TREATMENTS.map((t) => ({ id: t.id, name: t.name, blurb: t.blurb }))
}

export * from './types'
