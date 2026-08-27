import { getTreatment, type ParamValues } from '../engine/treatments/registry'
import { mulberry32 } from '../engine/prng'
import { ringsToPathD } from '../engine/svg'
import type { Ring } from '../engine/flatten'
import { toRings, type Library } from './glyphData'

export interface RenderResult {
  /** one SVG path covering the whole line, in font units, y-up */
  d: string
  width: number
  ascender: number
  descender: number
  contours: number
  ms: number
}

export interface RenderRequest {
  library: Library
  fontId: string
  treatmentId: string
  text: string
  params: ParamValues
  seed: number
  /**
   * How many differently-cut versions of each letter exist. With one, every `o`
   * in a word is identical and the eye reads the repetition as a pattern; with
   * three they cycle and the line stops looking stamped.
   */
  alternates?: number
}

export function render({
  library,
  fontId,
  treatmentId,
  text,
  params,
  seed,
  alternates = 1,
}: RenderRequest): RenderResult {
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

      const key = `${ch}/${variant}`
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
