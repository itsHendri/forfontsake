import type { Path64 } from 'clipper2-ts'
import { SCALE } from './paths'
import type { NoiseField } from './noise'

/**
 * An irregular closed blob — never a circle, and lumpier the larger it is.
 *
 * Shared by every treatment that adds or removes material in patches. Two noise
 * lookups at different frequencies stop the outline settling into a regular
 * polygon, which is what makes a field of them read as organic rather than as a
 * scatter of dots.
 */
export function roughBlob(
  cx: number,
  cy: number,
  radius: number,
  noise: NoiseField,
  rng: () => number,
): Path64 {
  const sides = Math.max(6, Math.min(14, Math.round(6 + radius / (SCALE * 6))))
  const phase = rng() * Math.PI * 2
  const ring: Path64 = []
  for (let i = 0; i < sides; i++) {
    const ang = phase + (i / sides) * Math.PI * 2
    const coarse = noise.sample(cx / 1400 + Math.cos(ang) * 1.6, cy / 1400 + Math.sin(ang) * 1.6)
    const fine = noise.sample(cx / 320 + Math.cos(ang) * 3.1, cy / 320 + Math.sin(ang) * 3.1)
    const wobble = 1 + coarse * 0.45 + fine * 0.22
    const r = radius * Math.max(0.3, wobble)
    ring.push({ x: Math.round(cx + Math.cos(ang) * r), y: Math.round(cy + Math.sin(ang) * r) })
  }
  return ring
}
