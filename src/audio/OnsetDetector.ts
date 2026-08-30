/**
 * Spectral-flux onset detection — the standard real-time approach: sum the
 * half-rectified frame-to-frame spectrum difference (rises only), compare it
 * against an adaptive threshold (trailing mean of recent flux × a sensitivity
 * multiplier), and emit a decaying 0..1 pulse on each hit. A refractory gap
 * stops one transient from double-triggering.
 *
 * Adapted for causal/live use from the offline reference pipeline in
 * Keavon/Web-Onset (flux + mean-window × 1.5 threshold + peak picking), itself
 * after the badlogic onset-detection tutorial; an offline detector can centre
 * its window and pick peaks with lookahead, a live one only has the past, so a
 * trailing window + refractory gap replaces peak picking.
 *
 * Band-limitable: a detector over the bass bins (~20–250 Hz) tracks the kick
 * ("beat"), one over the full spectrum tracks any transient ("onset").
 *
 * From FLUX (github.com/itsHendri/Flux, MIT), unchanged.
 */

export interface OnsetDetectorOptions {
  /** Trailing flux-history length (frames) for the adaptive mean. ~0.7 s at 60 fps. */
  windowSize?: number
  /** Threshold = mean(history) × multiplier. Reference value 1.5. */
  multiplier?: number
  /** Refractory gap in seconds — minimum time between triggers. */
  minGap?: number
  /** Pulse decay rate (per second); pulse ≈ e^(−decay·t) after a hit. */
  decay?: number
  /** Absolute flux floor so silence/noise can't trigger (mean ≈ 0 otherwise). */
  floor?: number
  /** Band limits in Hz (defaults: full analysed spectrum). */
  loHz?: number
  hiHz?: number
}

export class OnsetDetector {
  private readonly windowSize: number
  private readonly multiplier: number
  private readonly minGap: number
  private readonly decay: number
  private readonly floor: number
  private readonly loHz: number
  private readonly hiHz: number

  private prev: Float32Array | null = null
  private history: number[] = []
  private sinceTrigger = Infinity
  private pulseValue = 0

  constructor(opts: OnsetDetectorOptions = {}) {
    this.windowSize = opts.windowSize ?? 43
    this.multiplier = opts.multiplier ?? 1.5
    this.minGap = opts.minGap ?? 0.12
    this.decay = opts.decay ?? 6
    this.floor = opts.floor ?? 0.01
    this.loHz = opts.loHz ?? 20
    this.hiHz = opts.hiHz ?? 16000
  }

  /** Current pulse, 0..1 — 1 at a hit, exponentially decaying after. */
  get pulse(): number {
    return this.pulseValue
  }

  /** Forget all history (e.g. when the audio source changes). */
  reset(): void {
    this.prev = null
    this.history = []
    this.sinceTrigger = Infinity
    this.pulseValue = 0
  }

  /**
   * Feed one analyser frame (byte frequency data) and advance `dt` seconds.
   * Returns the updated pulse.
   */
  update(freq: Uint8Array, dt: number, sampleRate: number, fftSize: number): number {
    const hzPerBin = sampleRate / fftSize
    const lo = Math.max(0, Math.floor(this.loHz / hzPerBin))
    const hi = Math.min(freq.length - 1, Math.ceil(this.hiHz / hzPerBin))
    const bins = Math.max(1, hi - lo + 1)

    // Half-rectified spectral flux, normalised to 0..1 per bin.
    let flux = 0
    if (this.prev && this.prev.length === bins) {
      for (let i = lo; i <= hi; i++) {
        flux += Math.max(0, freq[i] / 255 - this.prev[i - lo])
      }
      flux /= bins
    }
    if (!this.prev || this.prev.length !== bins) {
      this.prev = new Float32Array(bins)
    }
    for (let i = lo; i <= hi; i++) this.prev[i - lo] = freq[i] / 255

    // Adaptive threshold over the trailing window (needs some warmup so the
    // very first loud frame after silence can't compare against nothing).
    const warm = this.history.length >= Math.min(12, this.windowSize)
    const mean = warm ? this.history.reduce((a, b) => a + b, 0) / this.history.length : Infinity
    this.history.push(flux)
    if (this.history.length > this.windowSize) this.history.shift()

    this.sinceTrigger += dt
    if (warm && flux > this.floor && flux > mean * this.multiplier && this.sinceTrigger >= this.minGap) {
      this.pulseValue = 1
      this.sinceTrigger = 0
    } else {
      this.pulseValue *= Math.exp(-this.decay * dt)
      if (this.pulseValue < 1e-3) this.pulseValue = 0
    }
    return this.pulseValue
  }
}
