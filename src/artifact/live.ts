/**
 * Browser entry for the live specimen page: the real treatment engine, driven
 * by sliders, with glyph outlines supplied as data so no font parser ships.
 */
import { getTreatment, defaults, listTreatments, type ParamValues } from '../engine/treatments/registry'
import { mulberry32 } from '../engine/prng'
import { ringsToPathD } from '../engine/svg'
import type { Ring } from '../engine/flatten'

interface FontData {
  label: string
  note: string
  reserved: string[]
  unitsPerEm: number
  strokeWidth: number
  ascender: number
  descender: number
  glyphs: Record<string, { adv: number; rings: number[][] }>
}

type Library = Record<string, FontData>

let library: Library

function toRings(flat: number[][]): Ring[] {
  return flat.map((r) => {
    const ring: Ring = []
    for (let i = 0; i < r.length; i += 2) ring.push({ x: r[i], y: r[i + 1] })
    return ring
  })
}

export function init(data: Library) {
  library = data
}

/** id, label and note for each source font — enough to build a picker */
export function listFonts() {
  return Object.entries(library).map(([id, f]) => ({
    id,
    label: f.label,
    note: f.note,
    reserved: f.reserved,
  }))
}

/** whether a treatment consumes randomness — decides if seed controls apply */
export function isDeterministic(treatmentId: string): boolean {
  return getTreatment(treatmentId).deterministic === true
}

/** named starting points for a treatment */
export function listPresets(treatmentId: string) {
  return getTreatment(treatmentId).presets ?? []
}

export function listParams(treatmentId: string) {
  return getTreatment(treatmentId).params
}

export { listTreatments }

export function defaultParams(treatmentId: string): ParamValues {
  return defaults(getTreatment(treatmentId))
}

export interface RenderResult {
  d: string
  width: number
  ascender: number
  descender: number
  contours: number
  ms: number
}

/**
 * Run the treatment over a string and return one SVG path.
 *
 * `alternates` is how many differently-cut versions of each letter exist. With
 * one, every `o` in a word is identical and the eye reads the repetition as a
 * pattern; with three, they cycle and the line stops looking stamped. Real
 * distressed faces ship several cuts per letter for exactly this reason.
 */
export function render(
  fontId: string,
  treatmentId: string,
  text: string,
  params: ParamValues,
  seed: number,
  alternates = 1,
): RenderResult {
  const t0 = performance.now()
  const data = library[fontId] ?? Object.values(library)[0]
  const treatment = getTreatment(treatmentId)
  const variants = treatment.deterministic ? 1 : Math.max(1, Math.round(alternates))
  const seen = new Map<string, number>()
  const cache = new Map<string, { rings: Ring[]; contours: number }>()
  let penX = 0
  let d = ''
  let contours = 0

  for (const ch of text) {
    const g = data.glyphs[ch]
    if (!g) continue
    if (g.rings.length > 0) {
      // cycle through the cuts as a letter repeats
      const nth = seen.get(ch) ?? 0
      seen.set(ch, nth + 1)
      const variant = nth % variants

      const key = ch + '/' + variant
      let entry = cache.get(key)
      if (!entry) {
        const charSeed = seed + (ch.codePointAt(0) ?? 0) * 7919 + variant * 104729
        const rings = treatment.apply(toRings(g.rings), params, {
          rng: mulberry32(charSeed),
          unitsPerEm: data.unitsPerEm,
          strokeWidth: data.strokeWidth || data.unitsPerEm * 0.1,
          advanceWidth: g.adv,
          penX,
        })
        entry = { rings, contours: rings.length }
        cache.set(key, entry)
      }
      contours += entry.contours
      d += ringsToPathD(entry.rings, penX, 0)
    }
    penX += g.adv
  }

  return {
    d,
    width: penX,
    ascender: data.ascender,
    descender: data.descender,
    contours,
    ms: performance.now() - t0,
  }
}
