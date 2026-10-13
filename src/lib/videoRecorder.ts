/**
 * The moving sheet, recorded off the screen — the fallback.
 *
 * Clips are rendered frame by frame in `clipRender.ts` wherever the browser
 * has a WebCodecs H.264 encoder. Where it has not, this records the live view
 * instead: real time, so a slow chain steps, but a clip all the same. Silent,
 * like the rendered one — music is added in the app the clip is posted from.
 *
 * MP4 is preferred because that is what Instagram and iMessage take without
 * complaint; browsers that only mux WebM get WebM.
 */

const CANDIDATES = [
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
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
export function startSheetRecorder(canvas: HTMLCanvasElement): SheetRecorder {
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('This browser cannot record video.')
  }
  const mimeType = pickMimeType((t) => MediaRecorder.isTypeSupported(t))
  if (!mimeType) throw new Error('This browser cannot record video.')

  const stream = canvas.captureStream(30)

  const chunks: BlobPart[] = []
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 })
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }
  // a timeslice so a long take is many small chunks rather than one giant one
  recorder.start(1000)

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
