import type { GlyphOverride, Overrides, ParamValues, Step } from '../engine/treatments/registry'

// One definition of a stack entry, in the engine, re-exported for the app —
// the URL, the shelf, the preview and the font writer are all describing the
// same thing and must not drift into three shapes of it.
export type { GlyphOverride, Overrides, Step }

export interface WorkbenchState {
  fontId: string
  seed: number
  alternates: number
  text: string
  /** applied in order, each one working on what the last one produced */
  chain: Step[]
  /** per-character exceptions to the chain — absent means none */
  overrides?: Overrides
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
 *
 * Per-glyph overrides ride in a seventh field, appended only when any exist:
 * a state without them encodes to the same six fields it always did, and an
 * old build reading a new link simply ignores the extra field.
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

/** an override that says nothing should not travel */
function overrideEmpty(o: GlyphOverride): boolean {
  return !o.nudge && o.params.every((p) => !p || Object.keys(p).length === 0)
}

/**
 * `ch=nudge&params+params;ch=…` — the characters are percent-encoded, because
 * the glyph set itself contains this format's punctuation, and `;`, `=` and
 * `&` are all characters encodeURIComponent never leaves bare.
 */
function encodeOverrides(overrides: Overrides): string {
  return Object.keys(overrides)
    .sort()
    .flatMap((ch) => {
      const o = overrides[ch]
      if (overrideEmpty(o)) return []
      const steps = o.params.map((p) => encodeParams(p ?? {})).join(STEP_SEP)
      return [`${encodeURIComponent(ch)}=${o.nudge ?? 0}&${steps}`]
    })
    .join(';')
}

function decodeOverrides(raw: string): Overrides | undefined {
  if (!raw) return undefined
  const out: Overrides = {}
  for (const group of raw.split(';')) {
    const eq = group.indexOf('=')
    if (eq <= 0) continue
    try {
      const ch = decodeURIComponent(group.slice(0, eq))
      const payload = group.slice(eq + 1)
      const amp = payload.indexOf('&')
      if (!ch || amp < 0) continue
      const nudge = Number(payload.slice(0, amp))
      if (Number.isNaN(nudge)) continue
      const params = payload
        .slice(amp + 1)
        .split(STEP_SEP)
        .map(decodeParams)
      const o: GlyphOverride = { params, ...(nudge ? { nudge } : {}) }
      if (!overrideEmpty(o)) out[ch] = o
    } catch {
      // one mangled group should not drop the rest
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

export function encodeState(s: WorkbenchState): string {
  const bits = [
    s.fontId,
    s.chain.map((step) => step.id).join(STEP_SEP),
    String(s.seed),
    String(s.alternates),
    s.chain.map((step) => encodeParams(step.params)).join(STEP_SEP),
    encodeURIComponent(s.text),
  ]
  const overrides = s.overrides ? encodeOverrides(s.overrides) : ''
  if (overrides) bits.push(overrides)
  return bits.join('|')
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
    const overrides = decodeOverrides(bits[6] ?? '')
    return {
      fontId: bits[0],
      seed,
      alternates,
      text: decodeURIComponent(bits[5]),
      chain,
      ...(overrides ? { overrides } : {}),
    }
  } catch {
    // a hand-mangled URL should not take the page down
    return null
  }
}
