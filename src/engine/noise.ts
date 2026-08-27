import type { Rng } from './prng'

/**
 * 2D value noise with smooth interpolation, seeded from an injected RNG.
 *
 * Coherent noise, not white noise: nearby points get nearby values, so an
 * outline displaced by it wanders rather than jitters. Random per-point offsets
 * read as damage; this reads as a hand-cut or weathered edge.
 */
export class NoiseField {
  private readonly grid: Float32Array
  private readonly size: number

  constructor(rng: Rng, size = 256) {
    this.size = size
    this.grid = new Float32Array(size * size)
    for (let i = 0; i < this.grid.length; i++) this.grid[i] = rng() * 2 - 1
  }

  private at(ix: number, iy: number): number {
    const s = this.size
    const x = ((ix % s) + s) % s
    const y = ((iy % s) + s) % s
    return this.grid[y * s + x]
  }

  /** value in [-1, 1] at an arbitrary point */
  sample(x: number, y: number): number {
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const fx = x - x0
    const fy = y - y0
    // smoothstep keeps the field free of the grid-aligned creases that plain
    // linear interpolation leaves behind
    const sx = fx * fx * (3 - 2 * fx)
    const sy = fy * fy * (3 - 2 * fy)
    const n00 = this.at(x0, y0)
    const n10 = this.at(x0 + 1, y0)
    const n01 = this.at(x0, y0 + 1)
    const n11 = this.at(x0 + 1, y0 + 1)
    const a = n00 + (n10 - n00) * sx
    const b = n01 + (n11 - n01) * sx
    return a + (b - a) * sy
  }

  /** several octaves summed — fine detail riding on broad movement */
  fractal(x: number, y: number, octaves = 2, gain = 0.5): number {
    let sum = 0
    let amp = 1
    let norm = 0
    let freq = 1
    for (let o = 0; o < octaves; o++) {
      sum += this.sample(x * freq, y * freq) * amp
      norm += amp
      amp *= gain
      freq *= 2
    }
    return norm > 0 ? sum / norm : 0
  }
}
