/**
 * Asymmetric one-pole envelope follower.
 *
 * Fast attack / slow release is what makes audio-driven motion feel *musical*
 * rather than twitchy: the value snaps up on a transient but eases back down.
 * Built-in AnalyserNode smoothing is symmetric, so we do this ourselves.
 *
 * All coefficients are derived from real frame `dt`, so behaviour is identical
 * regardless of display refresh rate or tab throttling.
 *
 * From FLUX (github.com/itsHendri/Flux, MIT), unchanged.
 */
export class EnvelopeFollower {
  private value = 0
  private attack: number
  private release: number

  /**
   * @param attack  Time constant in seconds for rising signal (small = snappy).
   * @param release Time constant in seconds for falling signal (large = smooth).
   */
  constructor(attack = 0.012, release = 0.22) {
    this.attack = attack
    this.release = release
  }

  /** Advance the envelope toward `target` by `dt` seconds. Returns new value. */
  update(target: number, dt: number): number {
    const tau = target > this.value ? this.attack : this.release
    // One-pole coefficient; clamp guards against huge dt after a stall.
    const coeff = tau > 0 ? 1 - Math.exp(-Math.min(dt, 0.1) / tau) : 1
    this.value += (target - this.value) * coeff
    return this.value
  }

  get current(): number {
    return this.value
  }

  reset(): void {
    this.value = 0
  }
}
