/**
 * Browser entry for the live specimen page: the real treatment engine, driven
 * by sliders, with glyph outlines supplied as data so no font parser ships.
 */
import { getTreatment, defaults, type ParamValues } from '../engine/treatments/registry'
import { mulberry32 } from '../engine/prng'
import { ringsToPathD } from '../engine/svg'
import type { Ring } from '../engine/flatten'

interface GlyphData {
  unitsPerEm: number
  ascender: number
  descender: number
  glyphs: Record<string, { adv: number; rings: number[][] }>
}

let data: GlyphData

function toRings(flat: number[][]): Ring[] {
  return flat.map((r) => {
    const ring: Ring = []
    for (let i = 0; i < r.length; i += 2) ring.push({ x: r[i], y: r[i + 1] })
    return ring
  })
}

export function init(glyphData: GlyphData) {
  data = glyphData
}

export function listParams(treatmentId: string) {
  return getTreatment(treatmentId).params
}

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

/** run the treatment over a string and return one SVG path */
export function render(
  treatmentId: string,
  text: string,
  params: ParamValues,
  seed: number,
): RenderResult {
  const t0 = performance.now()
  const treatment = getTreatment(treatmentId)
  let penX = 0
  let d = ''
  let contours = 0

  for (const ch of text) {
    const g = data.glyphs[ch]
    if (!g) continue
    if (g.rings.length > 0) {
      // seed from the character, so the same letter erodes the same way
      // wherever it appears in the word
      const charSeed = seed + (ch.codePointAt(0) ?? 0) * 7919
      const out = treatment.apply(toRings(g.rings), params, {
        rng: mulberry32(charSeed),
        unitsPerEm: data.unitsPerEm,
        advanceWidth: g.adv,
        penX,
      })
      contours += out.length
      d += ringsToPathD(out, penX, 0)
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
