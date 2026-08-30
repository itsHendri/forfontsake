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
  /** hand over the newest sheet — frames keep painting the last decoded one */
  update(svg: string): void
  /** finish and return the file */
  stop(): Promise<SheetRecording>
  /** abandon without a file (closing the overlay mid-take) */
  cancel(): void
}

export function startSheetRecorder(
  width: number,
  height: number,
  firstSvg: string,
  /** painted under every frame, so the first frames are paper rather than black */
  background: string,
  audio: MediaStream | null,
): SheetRecorder {
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('This browser cannot record video.')
  }
  const mimeType = pickMimeType((t) => MediaRecorder.isTypeSupported(t))
  if (!mimeType) throw new Error('This browser cannot record video.')

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d canvas')

  // Decoding is async and out-of-order arrival is possible; a frame may only
  // ever replace an older one, or a loud moment could paint over a later calm.
  // The outgoing frame is kept and faded over the incoming one, so the video
  // dissolves between geometry rebuilds the way the live sheet does.
  const FADE_MS = 350
  let img: HTMLImageElement | null = null
  let prev: HTMLImageElement | null = null
  let swappedAt = 0
  let seq = 0
  const load = (svg: string) => {
    const mine = ++seq
    const next = new Image()
    next.onload = () => {
      if (mine === seq) {
        prev = img
        img = next
        swappedAt = performance.now()
      }
    }
    next.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  }
  load(firstSvg)

  const stream = canvas.captureStream(30)
  if (audio) for (const track of audio.getAudioTracks()) stream.addTrack(track)

  const chunks: BlobPart[] = []
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 })
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }
  // a timeslice so a long take is many small chunks rather than one giant one
  recorder.start(1000)

  let raf = 0
  const draw = () => {
    ctx.fillStyle = background
    ctx.fillRect(0, 0, width, height)
    if (img) ctx.drawImage(img, 0, 0, width, height)
    // the sheets are opaque, so the old one fading off the top reads as a morph
    const fade = 1 - (performance.now() - swappedAt) / FADE_MS
    if (prev && fade > 0) {
      ctx.globalAlpha = fade
      ctx.drawImage(prev, 0, 0, width, height)
      ctx.globalAlpha = 1
    }
    raf = requestAnimationFrame(draw)
  }
  raf = requestAnimationFrame(draw)

  // only the canvas's own track is ours to stop — the audio tracks belong to
  // the engine's tap and must survive for the next take
  const teardown = () => {
    cancelAnimationFrame(raf)
    stream.getVideoTracks().forEach((t) => t.stop())
  }

  return {
    update: load,
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
