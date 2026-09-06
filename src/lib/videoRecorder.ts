/**
 * The pulsing sheet, recorded to a video file.
 *
 * The sheet is an SVG string that changes ~10 times a second while sound
 * drives the dials. Each new string is decoded to an image and painted onto a
 * canvas every animation frame, so the video runs at full frame rate even
 * though the geometry updates slower; `captureStream` on that canvas plus the
 * audio engine's tap gives MediaRecorder one stream carrying both.
 *
 * MP4 is preferred because that is what Instagram and iMessage take without
 * complaint; browsers that only mux WebM get WebM.
 */

const CANDIDATES = [
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
]

/** the first container this browser can actually write, or null */
export function pickMimeType(isSupported: (type: string) => boolean): string | null {
  return CANDIDATES.find((t) => isSupported(t)) ?? null
}

export function extensionFor(mimeType: string): string {
  return mimeType.includes('mp4') ? 'mp4' : 'webm'
}

export interface SheetRecording {
  blob: Blob
  extension: string
}

export interface SheetRecorder {
  /** finish and return the file */
  stop(): Promise<SheetRecording>
  /** abandon without a file (closing the overlay mid-take) */
  cancel(): void
}

/**
 * A take of the sheet.
 *
 * The sheet is already being drawn to a canvas every frame by the finish
 * stage, so recording is that canvas's own stream — no second canvas, no
 * decoding SVG per frame, and no chance of the video and the screen showing
 * different things. The cross-fade between geometry rebuilds is in the shader,
 * so it comes along for free.
 */
export function startSheetRecorder(
  canvas: HTMLCanvasElement,
  audio: MediaStream | null,
): SheetRecorder {
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('This browser cannot record video.')
  }
  const mimeType = pickMimeType((t) => MediaRecorder.isTypeSupported(t))
  if (!mimeType) throw new Error('This browser cannot record video.')

  const stream = canvas.captureStream(30)
  if (audio) for (const track of audio.getAudioTracks()) stream.addTrack(track)

  const chunks: BlobPart[] = []
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 })
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }
  // a timeslice so a long take is many small chunks rather than one giant one
  recorder.start(1000)

  // only the canvas's own track is ours to stop — the audio tracks belong to
  // the engine's tap and must survive for the next take
  const teardown = () => {
    stream.getVideoTracks().forEach((t) => t.stop())
  }

  return {
    stop: () =>
      new Promise<SheetRecording>((resolve, reject) => {
        recorder.onstop = () => {
          teardown()
          resolve({
            blob: new Blob(chunks, { type: mimeType.split(';')[0] }),
            extension: extensionFor(mimeType),
          })
        }
        recorder.onerror = () => {
          teardown()
          reject(new Error('The recording could not be finished.'))
        }
        try {
          recorder.stop()
        } catch (e) {
          teardown()
          reject(e instanceof Error ? e : new Error(String(e)))
        }
      }),
    cancel() {
      try {
        recorder.stop()
      } catch {
        // already stopped
      }
      teardown()
    },
  }
}
