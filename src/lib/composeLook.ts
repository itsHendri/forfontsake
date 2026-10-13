import { FINISHES, PICTURE_EFFECTS, finishState, pictureState, type Finish, type FinishState } from './finish'
import { DEFAULT_DEPTH, MODES } from './modulate'
import { DEFAULT_LENGTH, DEFAULT_SPEED, LENGTHS, MAX_SPEED, MIN_SPEED } from './motion'
import { FORMATS, GROUNDS, POSTER_PALETTES, type PosterPalette } from './poster'

/**
 * How Compose looked when you last left it.
 *
 * A weekly series should look like one, and the room used to open on the
 * first palette, a Post, flat paper and no finish every time — so the look
 * you settled on had to be rebuilt by hand each week. This is that look, kept
 * in the browser.
 *
 * Only the look: colours, ground, finishes, format, motion. Not the picture
 * you brought (megabytes, and a photo belongs to one post), not the word's
 * placement or the seed (those belong to the font, and the font changes
 * weekly), and not in the URL, which is still about the font alone.
 */
export interface ComposeLook {
  paletteIndex: number
  colours: Partial<PosterPalette>
  groundId: string
  finishes: FinishState
  pictureFx: FinishState
  formatId: string
  motionModeId: string
  depth: number
  speed: number
  length: number
}

const KEY = 'ffs:compose:v1'

export function defaultLook(): ComposeLook {
  return {
    paletteIndex: 0,
    colours: {},
    groundId: GROUNDS[0].id,
    finishes: finishState(),
    pictureFx: pictureState(),
    formatId: FORMATS[0].id,
    motionModeId: MODES[0].id,
    depth: DEFAULT_DEPTH,
    speed: DEFAULT_SPEED,
    length: DEFAULT_LENGTH,
  }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const HEX = /^#[0-9a-f]{6}$/i

/** a stored stack of effects, laid over today's defaults: unknown ids and out-of-range values drop out */
function effects(list: Finish[], fallback: FinishState, raw: unknown): FinishState {
  if (!raw || typeof raw !== 'object') return fallback
  const out: FinishState = {}
  for (const f of list) {
    const held = (raw as Record<string, { on?: unknown; params?: Record<string, unknown> }>)[f.id]
    const params = { ...fallback[f.id].params }
    for (const spec of f.params) {
      const v = held?.params?.[spec.key]
      if (isNum(v) && v >= spec.min && v <= spec.max) params[spec.key] = v
    }
    out[f.id] = { on: held?.on === true, params }
  }
  return out
}

/**
 * Whatever was stored, made safe.
 *
 * Every field is checked against what exists today rather than trusted: a
 * finish that has since been cut, a format renamed, a length no longer
 * offered — each falls back on its own rather than spoiling the rest.
 */
export function readLook(raw: unknown): ComposeLook {
  const d = defaultLook()
  if (!raw || typeof raw !== 'object') return d
  const r = raw as Record<string, unknown>
  const colours: Partial<PosterPalette> = {}
  if (r.colours && typeof r.colours === 'object') {
    for (const k of ['ink', 'paper', 'mark'] as const) {
      const v = (r.colours as Record<string, unknown>)[k]
      if (typeof v === 'string' && HEX.test(v)) colours[k] = v
    }
  }
  return {
    paletteIndex:
      isNum(r.paletteIndex) && r.paletteIndex >= 0 ? Math.floor(r.paletteIndex) % POSTER_PALETTES.length : d.paletteIndex,
    colours,
    groundId: GROUNDS.some((g) => g.id === r.groundId) ? (r.groundId as string) : d.groundId,
    finishes: effects(FINISHES, d.finishes, r.finishes),
    pictureFx: effects(PICTURE_EFFECTS, d.pictureFx, r.pictureFx),
    formatId: FORMATS.some((f) => f.id === r.formatId) ? (r.formatId as string) : d.formatId,
    motionModeId: MODES.some((m) => m.id === r.motionModeId) ? (r.motionModeId as string) : d.motionModeId,
    depth: isNum(r.depth) && r.depth >= 0 && r.depth <= 1 ? r.depth : d.depth,
    speed: isNum(r.speed) && r.speed >= MIN_SPEED && r.speed <= MAX_SPEED ? r.speed : d.speed,
    length: (LENGTHS as readonly number[]).includes(r.length as number) ? (r.length as number) : d.length,
  }
}

/** guarded, as the shelf is: reading storage throws in a private window */
export function loadLook(): ComposeLook {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? readLook(JSON.parse(raw)) : defaultLook()
  } catch {
    return defaultLook()
  }
}

export function saveLook(look: ComposeLook): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(look))
  } catch {
    // full or refused: the room still works, it just will not remember
  }
}
