import { describe, it, expect } from 'vitest'
import { analyseBands } from './bands'
import { EnvelopeFollower } from './EnvelopeFollower'

const SAMPLE_RATE = 48000
const FFT_SIZE = 2048

/** a frequency frame with one band lit */
function frame(loHz: number, hiHz: number, value: number): Uint8Array {
  const bins = FFT_SIZE / 2
  const hzPerBin = SAMPLE_RATE / FFT_SIZE
  const freq = new Uint8Array(bins)
  for (let i = 0; i < bins; i++) {
    const hz = i * hzPerBin
    if (hz >= loHz && hz <= hiHz) freq[i] = value
  }
  return freq
}

const silence = new Uint8Array(FFT_SIZE).fill(128)

describe('analyseBands', () => {
  it('puts energy in the band it belongs to', () => {
    const bassy = analyseBands(frame(40, 200, 255), silence, SAMPLE_RATE, FFT_SIZE)
    expect(bassy.bass).toBeGreaterThan(0.5)
    expect(bassy.high).toBeLessThan(0.1)

    const hissy = analyseBands(frame(4000, 12000, 255), silence, SAMPLE_RATE, FFT_SIZE)
    expect(hissy.high).toBeGreaterThan(0.5)
    expect(hissy.bass).toBeLessThan(0.1)
  })

  it('reads level from the waveform, not the spectrum', () => {
    const loud = new Uint8Array(FFT_SIZE)
    for (let i = 0; i < FFT_SIZE; i++) loud[i] = i % 2 ? 255 : 0
    expect(analyseBands(new Uint8Array(1024), loud, SAMPLE_RATE, FFT_SIZE).level).toBe(1)
    expect(analyseBands(new Uint8Array(1024), silence, SAMPLE_RATE, FFT_SIZE).level).toBe(0)
  })
})

describe('EnvelopeFollower', () => {
  it('snaps up fast and eases down slow', () => {
    const env = new EnvelopeFollower()
    const up = env.update(1, 1 / 60)
    expect(up).toBeGreaterThan(0.5) // one frame is most of the attack

    // now the signal drops; one frame should release only a little
    const down = env.update(0, 1 / 60)
    expect(down).toBeGreaterThan(up * 0.8)
  })

  it('is refresh-rate independent in the limit', () => {
    const a = new EnvelopeFollower()
    const b = new EnvelopeFollower()
    for (let i = 0; i < 60; i++) a.update(1, 1 / 60)
    for (let i = 0; i < 120; i++) b.update(1, 1 / 120)
    expect(Math.abs(a.current - b.current)).toBeLessThan(0.01)
  })
})
