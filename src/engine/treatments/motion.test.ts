import { describe, it, expect } from 'vitest'
import { TREATMENTS } from './registry'
import { defaults } from './types'
import { mulberry32 } from '../prng'
import { pointCount } from '../paths'
import type { Ring } from '../flatten'
import type { ParamValues, Treatment, TreatmentContext } from './types'

/**
 * Every treatment has to survive being ridden by sound.
 *
 * The specimen sheet drives each step's first four primary dials from the
 * audio — set point plus up to 35% of the dial's span, *not* snapped to the
 * dial's step, so the geometry is sampled as a continuous function of its
 * parameters. Three things go wrong there and nowhere else: a frame that comes
 * back empty (the word blinks out), a frame that costs an order of magnitude
 * more than its neighbours (the motion hitches), and a treatment that does not
 * move at all under its own primaries (a dead dial, which reads as a bug in the
 * sound rather than in the dial).
 *
 * This mirrors `modulate()` in Poster.tsx. If that changes, change this.
 */

const ctx = (): TreatmentContext => ({
  rng: mulberry32(1337),
  unitsPerEm: 1000,
  strokeWidth: 160,
  advanceWidth: 600,
  penX: 0,
})

const word = (): Ring[] => [
  [
    { x: 100, y: 100 },
    { x: 700, y: 100 },
    { x: 700, y: 700 },
    { x: 100, y: 700 },
  ],
  [
    { x: 300, y: 300 },
    { x: 300, y: 500 },
    { x: 500, y: 500 },
    { x: 500, y: 300 },
  ],
]

/** the sheet's modulation, at a single drive level applied to every band */
function driven(t: Treatment, base: ParamValues, drive: number): ParamValues {
  const out = { ...base }
  t.params
    .filter((s) => s.primary && !s.steady)
    .slice(0, 4)
    .forEach((spec) => {
      const raw = base[spec.key] + drive * 0.35 * (spec.max - spec.min)
      out[spec.key] = Math.min(spec.max, Math.max(spec.min, raw))
    })
  return out
}

const areaOf = (rings: Ring[]) => {
  let total = 0
  for (const r of rings) {
    let a = 0
    for (let i = 0; i < r.length; i++) {
      const p = r[i]
      const q = r[(i + 1) % r.length]
      a += p.x * q.y - q.x * p.y
    }
    total += a / 2
  }
  return Math.abs(total)
}

const STEPS = 12

describe.each(TREATMENTS.map((t) => [t.id, t] as const))('%s under modulation', (_id, t) => {
  const base = defaults(t)
  const frames = Array.from({ length: STEPS + 1 }, (_, i) =>
    t.apply(word(), driven(t, base, i / STEPS), ctx()),
  )

  it('never blinks out', () => {
    frames.forEach((f, i) => {
      expect(f.length, `frame ${i} was empty`).toBeGreaterThan(0)
      expect(areaOf(f), `frame ${i} had no ink`).toBeGreaterThan(0)
    })
  })

  it('actually moves', () => {
    // if the primaries do nothing, the sound has nothing to ride
    const first = JSON.stringify(frames[0])
    expect(frames.some((f) => JSON.stringify(f) !== first)).toBe(true)
  })

  it('holds its point budget across the whole sweep', () => {
    frames.forEach((f, i) => {
      expect(pointCount(f), `frame ${i} is over budget`).toBeLessThan(6000)
    })
  })

  it('keeps a letter on the page at every drive level', () => {
    // Erosion at full drive is meant to take a lot — that is the drama. What it
    // may not do is take everything, leaving the sheet blank on a bass peak.
    const start = areaOf(word())
    frames.forEach((f, i) => {
      expect(areaOf(f) / start, `frame ${i} has almost no ink left`).toBeGreaterThan(0.12)
    })
  })

  it('changes weight smoothly from frame to frame', () => {
    // The guard against strobing, and the one that had to be measured in ink
    // rather than in contours: a grid or a screen legitimately fuses and
    // unfuses as it rescales, so its contour count swings by tenfold while the
    // letter on the page never changes weight. Mass is what the eye tracks.
    const mass = frames.map(areaOf)
    for (let i = 1; i < mass.length; i++) {
      const ratio = mass[i] / Math.max(mass[i - 1], 1)
      expect(ratio, `frame ${i} changed weight ${ratio.toFixed(2)}x`).toBeGreaterThan(0.25)
      expect(ratio, `frame ${i} changed weight ${ratio.toFixed(2)}x`).toBeLessThan(2.5)
    }
  })

  it('never lurches in cost between neighbouring frames', () => {
    // measured in points added, not multiplied: going from 14 points to 340 is
    // free, and going from 3000 to 6000 is the hitch
    const counts = frames.map(pointCount)
    for (let i = 1; i < counts.length; i++) {
      const added = counts[i] - counts[i - 1]
      expect(added, `frame ${i} added ${added} points`).toBeLessThan(2500)
    }
  })
})
