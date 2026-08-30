import type { ParamValues, Step } from '../engine/treatments/registry'

// One definition of a stack entry, in the engine, re-exported for the app —
// the URL, the shelf, the preview and the font writer are all describing the
// same thing and must not drift into three shapes of it.
export type { Step }

export interface WorkbenchState {
  fontId: string
  seed: number
  alternates: number
  text: string
  /** applied in order, each one working on what the last one produced */
  chain: Step[]
}

/**
 * The whole state lives in the address bar, so a setting you like is a link.
 * Determinism is worth little when the only way back to a result is
 * remembering where the sliders were.
 *
 * The layout is six `|` fields and stayed six when stacking arrived: the
 * treatment field and the parameter field each hold one entry per step, joined
 * by `+`. A link written before stacking existed has no `+` in either, so it
 * reads as a one-step chain and still opens — which matters, because these
 * links are the thing people were told to keep.
 */
const STEP_SEP = '+'

function encodeParams(p: ParamValues): string {
  return Object.keys(p)
    .sort()
    .map((k) => `${k}:${p[k]}`)
    .join(',')
}

function decodeParams(raw: string): ParamValues {
  const params: ParamValues = {}
  for (const pair of raw.split(',')) {
    const [key, value] = pair.split(':')
    const n = Number(value)
    if (!key || Number.isNaN(n)) continue
    params[key] = n
  }
  return params
}

export function encodeState(s: WorkbenchState): string {
  return [
    s.fontId,
    s.chain.map((step) => step.id).join(STEP_SEP),
    s.seed,
    s.alternates,
    s.chain.map((step) => encodeParams(step.params)).join(STEP_SEP),
    encodeURIComponent(s.text),
  ].join('|')
}

export function decodeState(hash: string): WorkbenchState | null {
  const raw = hash.replace(/^#/, '')
  if (!raw) return null
  const bits = raw.split('|')
  if (bits.length < 6) return null

  const ids = bits[1].split(STEP_SEP).filter(Boolean)
  if (ids.length === 0) return null
  // A params field with fewer entries than there are treatments is not fatal —
  // the missing ones come back as empty and get filled from defaults upstream.
  const groups = bits[4].split(STEP_SEP)
  const chain: Step[] = ids.map((id, i) => ({ id, params: decodeParams(groups[i] ?? '') }))

  const seed = Number(bits[2])
  const alternates = Number(bits[3])
  if (Number.isNaN(seed) || Number.isNaN(alternates)) return null

  try {
    return {
      fontId: bits[0],
      seed,
      alternates,
      text: decodeURIComponent(bits[5]),
      chain,
    }
  } catch {
    // a hand-mangled URL should not take the page down
    return null
  }
}
