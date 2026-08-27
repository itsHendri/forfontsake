import { mosaicGlyph, DEFAULT_PARAMS } from '../mosaic'
import type { Ring } from '../flatten'
import type { Treatment, ParamValues, TreatmentContext } from './types'

/**
 * The original ribbon-slicing mosaic, wrapped as a treatment.
 *
 * Kept because the engine is sound and the look is real, but demoted from
 * flagship: tile patterns have to relate to the letterform, which is the one
 * thing a global rule cannot judge. It reads best as one option among many.
 */
export const mosaic: Treatment = {
  id: 'mosaic',
  name: 'Mosaic',
  blurb: 'Each stroke cut across its width into tiles, grout between them.',
  params: [
    { key: 'tileSize', label: 'tile', min: 20, max: 140, step: 2, default: 44 },
    { key: 'aspect', label: 'aspect', min: 0.5, max: 2, step: 0.05, default: 1, note: '1 is square' },
    { key: 'grout', label: 'grout', min: 2, max: 30, step: 1, default: 8 },
    { key: 'groutJitter', label: 'grout jitter', min: 0, max: 1, step: 0.05, default: 0.35 },
    { key: 'irregularity', label: 'irregularity', min: 0, max: 1, step: 0.05, default: 0.45 },
    { key: 'simplify', label: 'simplify', min: 0, max: 4, step: 0.1, default: 1.2 },
  ],

  apply(rings: Ring[], p: ParamValues, ctx: TreatmentContext): Ring[] {
    void ctx
    const { tiles } = mosaicGlyph(rings, {
      ...DEFAULT_PARAMS,
      seeding: 'ribbon',
      tileSize: p.tileSize,
      aspect: p.aspect,
      grout: p.grout,
      groutJitter: p.groutJitter,
      irregularity: p.irregularity,
      simplify: p.simplify,
      // the treatment context owns randomness; mosaicGlyph seeds its own PRNG
      // from this, so the value only has to be stable per glyph
      seed: Math.floor(ctx.rng() * 1e9),
    })
    return tiles.flat()
  },
}
