import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { FINISHES, finishDefaults, finishState, getFinish } from './finish'

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
