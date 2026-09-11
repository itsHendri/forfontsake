import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  FINISHES,
  PICTURE_EFFECTS,
  finishDefaults,
  finishState,
  getFinish,
  getPictureEffect,
  pictureState,
} from './finish'

/**
 * A finish is pixels over the rendered sheet. The rule it carries is that it
 * never reaches the outlines — the `.ttf` is byte-identical with any finish on
 * or off, and the SVG download stays letterforms only.
 *
 * That rule is structural, so the test is structural: nothing on the path from
 * a chain to a font file may know finishes exist. A behavioural test would only
 * prove it for the finishes that exist today.
 */
describe('a finish never changes what the font is', () => {
  const onThePathToAFont = [
    'src/lib/exportFont.ts',
    'src/workers/buildFont.worker.ts',
    'src/engine/fontio.ts',
    'src/engine/treatments/registry.ts',
    'src/lib/render.ts',
    'src/lib/poster.ts',
  ]

  it.each(onThePathToAFont)('%s does not know finishes exist', (file) => {
    const src = readFileSync(file, 'utf8')
    expect(src).not.toMatch(/from '.*\/finish'/)
    expect(src).not.toMatch(/\bFINISHES\b|\bcreateFinishView\b/)
  })

  it('keeps the finish out of the sheet the SVG download hands over', () => {
    const src = readFileSync('src/lib/poster.ts', 'utf8')
    // poster.ts draws letterforms; a finish is applied after it, on the GPU
    expect(src).not.toMatch(/finish/i)
  })
})

describe('finishes', () => {
  /*
   * The order is a fact about what the finishes do, not a preference, and the
   * shader's uniforms are positional — `uScan`, `uRiso`, `uGrain` are filled
   * from FINISHES[0..2] by index. Reordering this list therefore silently
   * feeds each finish another's dials, so the order is written down.
   */
  it('runs the two that resample the sheet before the one that speckles it', () => {
    expect(FINISHES.map((f) => f.id)).toEqual(['scanline', 'riso', 'grain'])
  })

  it('has no none, because they no longer exclude each other', () => {
    expect(FINISHES.some((f) => f.id === 'none')).toBe(false)
  })

  it('opens with every finish off and at its own defaults', () => {
    const state = finishState()
    expect(Object.keys(state).sort()).toEqual(FINISHES.map((f) => f.id).sort())
    for (const f of FINISHES) {
      expect(state[f.id].on, f.id).toBe(false)
      expect(state[f.id].params, f.id).toEqual(finishDefaults(f))
    }
  })

  it('gives every finish a name, a blurb and at most three dials', () => {
    for (const f of FINISHES) {
      expect(f.name, f.id).toBeTruthy()
      expect(f.blurb, f.id).toBeTruthy()
      // the shader packs the dials into one vec3
      expect(f.params.length, f.id).toBeLessThanOrEqual(3)
    }
  })

  it('gives every dial a default inside its own range', () => {
    for (const f of FINISHES) {
      for (const spec of f.params) {
        expect(spec.default, `${f.id} · ${spec.key}`).toBeGreaterThanOrEqual(spec.min)
        expect(spec.default, `${f.id} · ${spec.key}`).toBeLessThanOrEqual(spec.max)
        expect(spec.max).toBeGreaterThan(spec.min)
      }
    }
  })

  it('falls back to the first rather than throwing on an unknown id', () => {
    expect(getFinish('nope')).toBe(FINISHES[0])
  })

  it(`hands back every dial when asked for a finish's defaults`, () => {
    for (const f of FINISHES) {
      expect(Object.keys(finishDefaults(f)).sort()).toEqual(f.params.map((s) => s.key).sort())
    }
  })
})

describe('what can be done to a picture', () => {
  it('runs the three that reprint the picture before the one that reads it coarsely', () => {
    // Positional uniforms again: this array's order is what assigns each
    // effect its own vec3 in the shader, so it is a fact rather than a list.
    expect(PICTURE_EFFECTS.map((f) => f.id)).toEqual(['halftone', 'dither', 'duotone', 'pixelate'])
  })

  it('gives every one a name, a blurb and at most three dials', () => {
    for (const f of PICTURE_EFFECTS) {
      expect(f.name, f.id).toBeTruthy()
      expect(f.blurb, f.id).toBeTruthy()
      expect(f.params.length, f.id).toBeGreaterThan(0)
      // the shader packs each effect's dials into one vec3
      expect(f.params.length, f.id).toBeLessThanOrEqual(3)
    }
  })

  it('starts with all of them off, at their own defaults', () => {
    const state = pictureState()
    for (const f of PICTURE_EFFECTS) {
      expect(state[f.id].on, f.id).toBe(false)
      expect(state[f.id].params, f.id).toEqual(finishDefaults(f))
    }
  })

  it('keeps every default inside the dial it belongs to', () => {
    for (const f of PICTURE_EFFECTS) {
      for (const spec of f.params) {
        expect(spec.default, `${f.id}.${spec.key}`).toBeGreaterThanOrEqual(spec.min)
        expect(spec.default, `${f.id}.${spec.key}`).toBeLessThanOrEqual(spec.max)
      }
    }
  })

  it('falls through to the first on an unknown id', () => {
    expect(getPictureEffect('nope')).toBe(PICTURE_EFFECTS[0])
  })

  it('is a different list from the finishes over the whole sheet', () => {
    // the two are scoped differently — one is the page, one is the ground —
    // and sharing an id would mean sharing a switch
    const sheet = new Set(FINISHES.map((f) => f.id))
    for (const f of PICTURE_EFFECTS) expect(sheet.has(f.id), f.id).toBe(false)
  })
})
