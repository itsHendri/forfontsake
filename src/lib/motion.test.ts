import { describe, it, expect } from 'vitest'
import { CHANNELS, FPS, LENGTHS, MAX_SPEED, MIN_SPEED, cyclesIn, motionAt } from './motion'

const SPEEDS = [MIN_SPEED, 0.6, 1, 1.35, MAX_SPEED]

describe('the motion loops', () => {
  it('ends where it began, at every length and speed', () => {
    for (const seconds of LENGTHS) {
      for (const speed of SPEEDS) {
        for (const t of [0, 0.37, 2.5, seconds * 0.81]) {
          const a = motionAt(t, seconds, speed)
          const b = motionAt(t + seconds, seconds, speed)
          a.forEach((v, i) => expect(b[i], `${CHANNELS[i]} at ${t}s of ${seconds}s, speed ${speed}`).toBeCloseTo(v, 9))
        }
      }
    }
  })

  it('steps from the last frame into the first as gently as between any two frames', () => {
    // the seam is the jump from frame n-1 back to frame 0; it should be no
    // bigger than the largest jump anywhere else in the clip
    for (const seconds of LENGTHS) {
      const n = seconds * FPS
      const frames = Array.from({ length: n }, (_, i) => motionAt(i / FPS, seconds))
      CHANNELS.forEach((_, c) => {
        let worst = 0
        for (let i = 1; i < n; i++) worst = Math.max(worst, Math.abs(frames[i][c] - frames[i - 1][c]))
        const seam = Math.abs(frames[0][c] - frames[n - 1][c])
        expect(seam, `${CHANNELS[c]} at ${seconds}s`).toBeLessThanOrEqual(worst + 1e-9)
      })
    }
  })

  it('stays inside the range modulate expects', () => {
    for (const seconds of LENGTHS) {
      for (const speed of SPEEDS) {
        for (let i = 0; i < seconds * FPS; i++) {
          for (const v of motionAt(i / FPS, seconds, speed)) {
            expect(v).toBeGreaterThanOrEqual(-1)
            expect(v).toBeLessThanOrEqual(1)
          }
        }
      }
    }
  })

  it('actually moves every curve', () => {
    for (const seconds of LENGTHS) {
      const frames = Array.from({ length: seconds * FPS }, (_, i) => motionAt(i / FPS, seconds))
      CHANNELS.forEach((name, c) => {
        const vals = frames.map((f) => f[c])
        expect(Math.max(...vals) - Math.min(...vals), name).toBeGreaterThan(0.5)
      })
    }
  })

  it('centres the beat on your setting rather than above it', () => {
    // the dial should spend as long under its set point as over it, roughly:
    // the average drive over a loop is near nothing
    const n = 10 * FPS
    let sum = 0
    for (let i = 0; i < n; i++) sum += motionAt(i / FPS, 10)[0]
    expect(Math.abs(sum / n)).toBeLessThan(0.05)
  })
})

describe('speed', () => {
  it('rounds to whole cycles and never to none', () => {
    expect(cyclesIn(0.08, 6, 0.25)).toBe(1)
    expect(cyclesIn(0.8, 10, 1)).toBe(8)
    expect(cyclesIn(0.8, 10, 1.04)).toBe(8)
    expect(cyclesIn(0.8, 10, 2)).toBe(16)
  })

  it('goes round faster when it is turned up', () => {
    expect(cyclesIn(0.8, 10, MAX_SPEED)).toBeGreaterThan(cyclesIn(0.8, 10, MIN_SPEED))
  })
})
