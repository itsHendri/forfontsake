import { describe, it, expect } from 'vitest'
import { MAX_STRIDE, RENDER_BUDGET_MS, chooseStride, frameAt, frameCount } from './clipRender'
import { FPS, LENGTHS } from './motion'

describe('the frame schedule', () => {
  it('is exactly the length times the frame rate', () => {
    expect(frameCount(10, 30)).toBe(300)
    for (const l of LENGTHS) expect(frameCount(l, FPS)).toBe(l * FPS)
  })

  it('builds every frame when the chain can afford it', () => {
    expect(chooseStride(20, 300)).toBe(1)
    for (let i = 0; i < 10; i++) expect(frameAt(i, 1)).toEqual({ build: i, fade: 0 })
  })

  it('spaces the builds out on a heavy chain, and never past the limit', () => {
    const frames = 450
    expect(chooseStride(RENDER_BUDGET_MS / frames + 1, frames)).toBe(2)
    expect(chooseStride(10_000, frames)).toBe(MAX_STRIDE)
  })

  it('dissolves towards each look-ahead build and lands on it', () => {
    const k = 3
    // frame 0 builds frame 3's sheet and still shows all of frame 0's
    expect(frameAt(0, k)).toEqual({ build: 3, fade: 1 })
    expect(frameAt(1, k).build).toBeNull()
    expect(frameAt(2, k).fade).toBeCloseTo(1 / 3)
    // frame 3 shows its own sheet in full and looks ahead to frame 6
    expect(frameAt(3, k)).toEqual({ build: 6, fade: 1 })
  })
})
