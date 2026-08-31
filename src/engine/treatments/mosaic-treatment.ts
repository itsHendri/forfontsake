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
  family: 'structure',
  blurb: 'Each stroke cut across its width into tiles, grout between them.',
  story:
    'Each stroke is sliced across its width into ribbons and the ribbons into tiles, so '+
    'the courses follow the letter rather than a grid laid over it — the logic of '+
    'Portuguese calçada paving, where the setts turn to follow the pattern. Grout jitter '+
    'and irregularity are what keep it from reading as tile-effect filter.',
  params: [
    { key: 'tileSize', label: 'Tile', min: 15, max: 220, step: 1, default: 37, note: '% of stroke width', primary: true },
    { key: 'aspect', label: 'Aspect', min: 0.5, max: 2, step: 0.05, default: 1, note: '1 is square', primary: true },
    { key: 'grout', label: 'Grout', min: 1, max: 40, step: 1, default: 7, primary: true },
    { key: 'groutJitter', label: 'Grout jitter', min: 0, max: 1, step: 0.05, default: 0.35 },
    { key: 'irregularity', label: 'Irregularity', min: 0, max: 1, step: 0.05, default: 0.45, primary: true },
    { key: 'simplify', label: 'Simplify', min: 0, max: 4, step: 0.1, default: 1.2 },
  ],

  presets: [
    { name: 'Calçada', values: { tileSize: 37, aspect: 1, grout: 7, groutJitter: 0.35, irregularity: 0.45, simplify: 1.2 } },
    { name: 'Subway', values: { tileSize: 48, aspect: 1.3, grout: 5, groutJitter: 0.1, irregularity: 0.12, simplify: 1.2 } },
    { name: 'Rubble', values: { tileSize: 30, aspect: 0.8, grout: 9, groutJitter: 0.8, irregularity: 0.95, simplify: 1.2 } },
  ],

  apply(rings: Ring[], p: ParamValues, ctx: TreatmentContext): Ring[] {
    // tiles are measured against the stroke they have to span
    const stem = ctx.strokeWidth / 100
    const { tiles } = mosaicGlyph(rings, {
      ...DEFAULT_PARAMS,
      seeding: 'ribbon',
      tileSize: p.tileSize * stem,
      aspect: p.aspect,
      grout: p.grout * stem,
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
