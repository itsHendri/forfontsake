/**
 * One analysed moment of sound, as six floats.
 *
 * Adapted from FLUX (github.com/itsHendri/Flux, MIT) — the author's own
 * audio-reactive instrument, whose analysis stack this module family lifts.
 */
export interface AudioFrame {
  /** 20–250 Hz, envelope-followed, 0..1 */
  bass: number
  /** 250–2000 Hz, envelope-followed, 0..1 */
  mid: number
  /** 2000–16000 Hz, envelope-followed, 0..1 */
  high: number
  /** overall loudness from the time-domain RMS, 0..1 */
  level: number
  /** decaying pulse from the bass-band onset detector — the kick */
  beat: number
  /** decaying pulse from the full-spectrum onset detector — any transient */
  onset: number
}

export const SILENT_FRAME: AudioFrame = {
  bass: 0,
  mid: 0,
  high: 0,
  level: 0,
  beat: 0,
  onset: 0,
}
