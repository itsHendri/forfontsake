import type { ParamValues } from '../engine/treatments/registry'

export interface WorkbenchState {
  fontId: string
  treatmentId: string
  seed: number
  alternates: number
  text: string
  params: ParamValues
}

/**
 * The whole state lives in the address bar, so a setting you like is a link.
 * Determinism is worth little when the only way back to a result is
 * remembering where the sliders were.
 */
export function encodeState(s: WorkbenchState): string {
  const params = Object.keys(s.params)
    .sort()
    .map((k) => `${k}:${s.params[k]}`)
    .join(',')
  return [s.fontId, s.treatmentId, s.seed, s.alternates, params, encodeURIComponent(s.text)].join('|')
}

export function decodeState(hash: string): WorkbenchState | null {
  const raw = hash.replace(/^#/, '')
  if (!raw) return null
  const bits = raw.split('|')
  if (bits.length < 6) return null

  const params: ParamValues = {}
  for (const pair of bits[4].split(',')) {
    const [key, value] = pair.split(':')
    const n = Number(value)
    if (!key || Number.isNaN(n)) continue
    params[key] = n
  }

  const seed = Number(bits[2])
  const alternates = Number(bits[3])
  if (Number.isNaN(seed) || Number.isNaN(alternates)) return null

  try {
    return {
      fontId: bits[0],
      treatmentId: bits[1],
      seed,
      alternates,
      text: decodeURIComponent(bits[5]),
      params,
    }
  } catch {
    // a hand-mangled URL should not take the page down
    return null
  }
}
