/**
 * FFT frame → bass / mid / high / level.
 *
 * From FLUX (github.com/itsHendri/Flux, MIT), unchanged.
 */

/** Raw (un-smoothed) band magnitudes, each 0..1. */
export interface RawBands {
  bass: number
  mid: number
  high: number
  level: number
}

// Frequency band edges in Hz.
const BASS_RANGE = [20, 250]
const MID_RANGE = [250, 2000]
const HIGH_RANGE = [2000, 16000]

/** Average normalised magnitude of frequency bins within [loHz, hiHz]. */
function bandAverage(
  freq: Uint8Array,
  loHz: number,
  hiHz: number,
  sampleRate: number,
  fftSize: number,
): number {
  const hzPerBin = sampleRate / fftSize
  const lo = Math.max(0, Math.floor(loHz / hzPerBin))
  const hi = Math.min(freq.length - 1, Math.ceil(hiHz / hzPerBin))
  if (hi < lo) return 0
  let sum = 0
  for (let i = lo; i <= hi; i++) sum += freq[i]
  return sum / (hi - lo + 1) / 255
}

/**
 * Split an FFT frame into bass / mid / high, plus an overall RMS level taken
 * from the time-domain waveform. Output is raw — feed it to envelope followers.
 */
export function analyseBands(
  freq: Uint8Array,
  time: Uint8Array,
  sampleRate: number,
  fftSize: number,
): RawBands {
  let sumSq = 0
  for (let i = 0; i < time.length; i++) {
    const v = (time[i] - 128) / 128
    sumSq += v * v
  }
  const rms = Math.sqrt(sumSq / time.length)

  return {
    bass: bandAverage(freq, BASS_RANGE[0], BASS_RANGE[1], sampleRate, fftSize),
    mid: bandAverage(freq, MID_RANGE[0], MID_RANGE[1], sampleRate, fftSize),
    high: bandAverage(freq, HIGH_RANGE[0], HIGH_RANGE[1], sampleRate, fftSize),
    // RMS is small for typical music; lift it into a useful display range.
    level: Math.min(1, rms * 3),
  }
}
