/**
 * What moves the letters, now that nothing is listening.
 *
 * The sheet used to ride a sound: a bubble loop or the microphone, analysed
 * into bands and followed by envelopes. That made a clip a performance — real
 * time, whatever the chain could manage, fifteen seconds and a stop button —
 * and the sound itself never made it to the post anyway, because music is
 * added in the app you post from. So the drive is a function of time instead.
 *
 * Every curve completes a whole number of cycles in the clip's length, which
 * is the one property everything else rests on: frame `t` and frame
 * `t + length` are the same frame, so a clip loops without a seam on any
 * platform that loops it, and a frame can be drawn in any order. That second
 * part is what lets a clip be rendered offline, one exact frame at a time,
 * rather than recorded off the screen.
 *
 * Pure: no clock, no DOM. The live view and the renderer both ask it what
 * frame `t` looks like.
 */

/** the four curves a dial can follow, in the order the drive vector holds them */
export const CHANNELS = ['beat', 'swell', 'flicker', 'drift'] as const
export type Channel = (typeof CHANNELS)[number]

/** the lengths a clip comes in, in seconds — short enough to loop, long enough to read */
export const LENGTHS = [6, 10, 15] as const
export const DEFAULT_LENGTH = 10

/** the clip's frame rate, which every platform on the list takes */
export const FPS = 30

export const DEFAULT_SPEED = 1
export const MIN_SPEED = 0.25
export const MAX_SPEED = 2

/*
 * How often each curve wants to go round at speed 1, in cycles a second.
 *
 * Wants, because the clip gets the nearest whole number of cycles rather than
 * this exactly: a beat every 1.25 s, a breath every eight, a flicker made of
 * three rates that do not share a pattern the eye can lock onto, and a drift
 * slower than all of them.
 */
const BEAT_HZ = 0.8
const SWELL_HZ = 0.12
const FLICKER_HZ = [0.6, 1.1, 1.9] as const
const DRIFT_HZ = 0.08

/**
 * Whole cycles in a loop, never fewer than one.
 *
 * Rounding here, rather than in the Speed dial, is what lets the dial stay a
 * continuous slider: any value it lands on still produces a seamless loop,
 * and a nudge that does not change the count does not change the clip.
 */
export function cyclesIn(hz: number, seconds: number, speed: number): number {
  return Math.max(1, Math.round(hz * seconds * speed))
}

const TAU = Math.PI * 2
const frac = (x: number) => x - Math.floor(x)
const clamp1 = (v: number) => Math.max(-1, Math.min(1, v))

/*
 * A beat: a fast rise and an exponential fall.
 *
 * Centred on its own average so the dial spends the gap between beats a
 * little under where you set it and the beat lifts it over — the same thing
 * the sound drive did by subtracting a slow baseline from a fast follower.
 */
const BEAT_DECAY = 6
const BEAT_ATTACK = 0.04
const BEAT_MEAN = (() => {
  // the envelope's average over one cycle, measured once
  let sum = 0
  const n = 2000
  for (let i = 0; i < n; i++) sum += beatEnvelope(i / n)
  return sum / n
})()
function beatEnvelope(phase: number): number {
  const rise = Math.min(1, phase / BEAT_ATTACK)
  return rise * Math.exp(-BEAT_DECAY * phase)
}

/**
 * The four curves at time `t` of a loop `seconds` long, each in −1..1.
 *
 * `t` may be any number: it is wrapped into the loop, so the live view can
 * hand it a running clock and the renderer a frame index over the frame rate.
 */
export function motionAt(t: number, seconds: number, speed: number = DEFAULT_SPEED): number[] {
  const u = frac(t / seconds)
  const beat = (beatEnvelope(frac(u * cyclesIn(BEAT_HZ, seconds, speed))) - BEAT_MEAN) / (1 - BEAT_MEAN)
  const swell = -Math.cos(TAU * u * cyclesIn(SWELL_HZ, seconds, speed))
  const [a, b, c] = FLICKER_HZ.map((hz) => cyclesIn(hz, seconds, speed))
  const flicker =
    0.5 * Math.sin(TAU * u * a) + 0.3 * Math.sin(TAU * u * b + 1.3) + 0.2 * Math.sin(TAU * u * c + 2.1)
  const drift = Math.sin(TAU * u * cyclesIn(DRIFT_HZ, seconds, speed))
  return [clamp1(beat), clamp1(swell), clamp1(flicker), clamp1(drift)]
}
