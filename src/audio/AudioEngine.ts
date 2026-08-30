import { SILENT_FRAME, type AudioFrame } from './frame'
import { EnvelopeFollower } from './EnvelopeFollower'
import { analyseBands } from './bands'
import { OnsetDetector } from './OnsetDetector'
import type { AudioSource } from './sources'

export interface AudioEngineOptions {
  fftSize?: number
}

/**
 * Owns a single AudioContext and a single AnalyserNode. The current source is
 * swappable; everything downstream (analysis, smoothing) is identical no matter
 * where the audio came from.
 *
 * Adapted from FLUX (github.com/itsHendri/Flux, MIT).
 */
export class AudioEngine {
  private readonly ctx: AudioContext
  private readonly analyser: AnalyserNode
  private readonly freqData: Uint8Array<ArrayBuffer>
  private readonly timeData: Uint8Array<ArrayBuffer>

  private readonly envBass = new EnvelopeFollower()
  private readonly envMid = new EnvelopeFollower()
  private readonly envHigh = new EnvelopeFollower()
  private readonly envLevel = new EnvelopeFollower()

  // Spectral-flux transient detectors: beat = bass band (kick), onset = full
  // spectrum. Both emit decaying 0..1 pulses (see OnsetDetector).
  private readonly beatDetector = new OnsetDetector({ loHz: 20, hiHz: 250 })
  private readonly onsetDetector = new OnsetDetector()

  private source: AudioSource | null = null
  private frame: AudioFrame = SILENT_FRAME
  // a tap for MediaRecorder — separate from monitoring, so recording the mic
  // does not put it on the speakers
  private recDest: MediaStreamAudioDestinationNode | null = null

  constructor(opts: AudioEngineOptions = {}) {
    this.ctx = new AudioContext()
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = opts.fftSize ?? 2048
    // Near-zero: we do our own asymmetric smoothing in EnvelopeFollower.
    // The built-in smoothing is symmetric and would mute transients.
    this.analyser.smoothingTimeConstant = 0
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount)
    this.timeData = new Uint8Array(this.analyser.fftSize)
  }

  get context(): AudioContext {
    return this.ctx
  }

  /** AudioContext starts suspended; must be resumed from a user gesture. */
  async resume(): Promise<void> {
    if (this.ctx.state !== 'running') await this.ctx.resume()
  }

  get currentLabel(): string | null {
    return this.source?.label ?? null
  }

  /** Swap the input source. Disposes the previous one and rewires monitoring. */
  setSource(source: AudioSource | null): void {
    if (this.source) {
      this.source.node.disconnect()
      this.source.dispose()
    }
    this.analyser.disconnect()

    this.source = source
    if (source) {
      source.node.connect(this.analyser)
      // A monitored source also goes to the speakers — the loop should be
      // heard; the live mic must not be, to avoid acoustic feedback.
      if (source.monitor) this.analyser.connect(this.ctx.destination)
    }
    // disconnect() above severed the recording tap too — restore it
    if (this.recDest) this.analyser.connect(this.recDest)

    this.envBass.reset()
    this.envMid.reset()
    this.envHigh.reset()
    this.envLevel.reset()
    this.beatDetector.reset()
    this.onsetDetector.reset()
    this.frame = SILENT_FRAME
  }

  /** Read the analyser, advance envelopes by `dt` seconds, snapshot the frame. */
  tick(dt: number): AudioFrame {
    if (!this.source) {
      this.frame = SILENT_FRAME
      return this.frame
    }
    this.analyser.getByteFrequencyData(this.freqData)
    this.analyser.getByteTimeDomainData(this.timeData)

    const raw = analyseBands(this.freqData, this.timeData, this.ctx.sampleRate, this.analyser.fftSize)
    this.frame = {
      bass: this.envBass.update(raw.bass, dt),
      mid: this.envMid.update(raw.mid, dt),
      high: this.envHigh.update(raw.high, dt),
      level: this.envLevel.update(raw.level, dt),
      beat: this.beatDetector.update(this.freqData, dt, this.ctx.sampleRate, this.analyser.fftSize),
      onset: this.onsetDetector.update(this.freqData, dt, this.ctx.sampleRate, this.analyser.fftSize),
    }
    return this.frame
  }

  /** Last snapshot — for consumers that read between ticks. */
  getFrame(): AudioFrame {
    return this.frame
  }

  /** What the analyser hears, as a stream MediaRecorder can take. */
  captureStream(): MediaStream {
    if (!this.recDest) {
      this.recDest = this.ctx.createMediaStreamDestination()
      this.analyser.connect(this.recDest)
    }
    return this.recDest.stream
  }

  dispose(): void {
    if (this.source) this.source.dispose()
    this.analyser.disconnect()
    void this.ctx.close()
  }
}
