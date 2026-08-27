import { grit } from './grit'
import { mosaic } from './mosaic-treatment'
import type { Treatment } from './types'

export const TREATMENTS: Treatment[] = [grit, mosaic]

export function getTreatment(id: string): Treatment {
  const t = TREATMENTS.find((x) => x.id === id)
  if (!t) throw new Error(`unknown treatment: ${id}`)
  return t
}

export * from './types'
