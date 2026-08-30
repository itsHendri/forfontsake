import { mulberry32 } from '../engine/prng'

/**
 * Audio source factories. Every input terminates in this shape — an
 * `AudioSource` — so AudioEngine stays source-agnostic and only ever connects
 * `node` into its analyser.
 *
 * Mic capture adapted from FLUX (github.com/itsHendri/Flux, MIT); the bubble
 * loop is this project's own.
 */
export interface AudioSource {
  /** Node to connect into the AnalyserNode. */
  node: AudioNode
  /** If true, AudioEngine also routes the analyser to the speakers. */
  monitor: boolean
  /** Human-readable label for the UI. */
  label: string
  /** Stop tracks / buffer sources, disconnect nodes. */
  dispose(): void
}

/** Friendly explanation for the common getUserMedia failure modes. */
function micErrorHint(name: string): string {
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'permission denied — allow microphone access for this site.'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'no microphone was found on this device.'
    case 'NotReadableError':
      return 'the microphone is busy in another application.'
    default:
      return 'could not open the microphone.'
  }
}

/** Live microphone. Not monitored — routing it to the speakers is feedback. */
export async function createMicSource(ctx: AudioContext): Promise<AudioSource> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('this browser does not expose microphone access.')
  }

  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      // the browser's DSP would wreck the analysis: echo cancellation and
      // noise suppression eat exactly the transients the detectors listen for
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false,
    })
  } catch (e) {
    const name = e instanceof DOMException ? e.name : 'Error'
    throw new Error(`Microphone unavailable: ${micErrorHint(name)}`)
  }

  const track = stream.getAudioTracks()[0]
  if (!track) {
    stream.getTracks().forEach((t) => t.stop())
    throw new Error('Input granted but the stream carried no audio track.')
  }

  const node = ctx.createMediaStreamSource(stream)
  return {
    node,
    monitor: false,
    label: track.label || 'microphone',
    dispose() {
      node.disconnect()
      stream.getTracks().forEach((t) => t.stop())
    },
  }
}

const LOOP_SECONDS = 30
const LOOP_SEED = 4242

// rendered once and kept — the loop is deterministic, so there is exactly one
let cachedLoop: AudioBuffer | null = null

/**
 * The built-in soundtrack: thirty seconds of bubbles, synthesised.
 *
 * No asset ships for this. A steady low pulse gives the beat detector
 * something to latch onto; on top of it, sine "pops" gliding down an octave
 * are what a bubble sounds like (a resonating cavity shrinking as it rises),
 * and occasional band-passed noise adds fizz. Seeded, so every visitor hears
 * the same loop and a captured sheet is reproducible.
 */
async function renderBubbleLoop(sampleRate: number): Promise<AudioBuffer> {
  if (cachedLoop && cachedLoop.sampleRate === sampleRate) return cachedLoop
  const off = new OfflineAudioContext(2, sampleRate * LOOP_SECONDS, sampleRate)
  const rng = mulberry32(LOOP_SEED)
  const master = off.createGain()
  master.gain.value = 0.7
  master.connect(off.destination)

  // the pulse: a soft kick every 0.6 s (~100 BPM)
  for (let t = 0.05; t < LOOP_SECONDS - 0.2; t += 0.6) {
    const osc = off.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(110, t)
    osc.frequency.exponentialRampToValueAtTime(50, t + 0.12)
    const gain = off.createGain()
    gain.gain.setValueAtTime(0.5, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16)
    osc.connect(gain)
    gain.connect(master)
    osc.start(t)
    osc.stop(t + 0.2)
  }

  // the bubbles: short sine pops gliding down, arriving unevenly (~2.5/s)
  for (let t = 0.2; t < LOOP_SECONDS - 0.3; t += 0.15 + rng() * 0.55) {
    const f0 = 500 + rng() * 1000
    const dur = 0.06 + rng() * 0.05
    const osc = off.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(f0, t)
    osc.frequency.exponentialRampToValueAtTime(f0 / 2, t + dur)
    const gain = off.createGain()
    const peak = 0.08 + rng() * 0.12
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur)
    osc.connect(gain)
    gain.connect(master)
    osc.start(t)
    osc.stop(t + dur + 0.05)
  }

  // the fizz: a few seconds apart, a burst of band-passed noise
  const noiseLen = Math.floor(sampleRate * 0.4)
  const noise = off.createBuffer(1, noiseLen, sampleRate)
  const data = noise.getChannelData(0)
  for (let i = 0; i < noiseLen; i++) data[i] = rng() * 2 - 1
  for (let t = 1.5; t < LOOP_SECONDS - 1; t += 2.5 + rng() * 2.5) {
    const src = off.createBufferSource()
    src.buffer = noise
    const filter = off.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = 2500 + rng() * 3500
    filter.Q.value = 1.2
    const gain = off.createGain()
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.06, t + 0.03)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35)
    src.connect(filter)
    filter.connect(gain)
    gain.connect(master)
    src.start(t)
  }

  cachedLoop = await off.startRendering()
  return cachedLoop
}

/** The bubble loop as a source — monitored, so you hear what the type hears. */
export async function createLoopSource(ctx: AudioContext): Promise<AudioSource> {
  const buffer = await renderBubbleLoop(ctx.sampleRate)
  const node = ctx.createBufferSource()
  node.buffer = buffer
  node.loop = true
  node.start()
  return {
    node,
    monitor: true,
    label: 'bubble loop',
    dispose() {
      try {
        node.stop()
      } catch {
        // already stopped
      }
      node.disconnect()
    },
  }
}
