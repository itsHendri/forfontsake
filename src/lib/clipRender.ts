/**
 * The moving sheet, rendered to an MP4 one exact frame at a time.
 *
 * The clip used to be recorded off the screen: whatever the chain could
 * rebuild in real time, captured by MediaRecorder for as long as somebody held
 * the button. That made a slow chain a stepping clip and the length a matter
 * of reflexes. Here the clock is ours — frame `i` is drawn at `i / fps`,
 * however long it takes to draw — so every frame is the frame it should be,
 * the length is exact, and because the motion closes on itself the last frame
 * runs into the first without a seam.
 *
 * The same pipeline as the screen and the PNG: the sheet's layers go through
 * a throwaway finish view and the canvas is handed to the encoder. Encoding is
 * WebCodecs H.264 through mediabunny, loaded only when a clip is made.
 * `canRenderClips` says whether this browser can do it; the live recorder in
 * `videoRecorder.ts` is the fallback where it cannot.
 */

import { createFinishView, type FinishView } from './finish'

/** what one built sheet hands the GPU */
export interface ClipLayers {
  ground: string
  word: string | null
}

export interface ClipRequest {
  w: number
  h: number
  seconds: number
  fps: number
  /** the sheet at time `t` of the loop, built from the motion at that moment */
  layersAt: (t: number) => ClipLayers
  /** finishes, picture effects, the word's drag — whatever the view needs once */
  prepare: (view: FinishView) => void
  onProgress?: (done: number, total: number, etaSeconds: number | null) => void
  signal?: AbortSignal
}

/** 8 Mbps at 1080 wide: what Reels asks for, and comfortably inside X, LinkedIn and TikTok */
const BITRATE = 8_000_000

/** how long a clip may take before it is drawn on fewer frames and cross-faded between */
export const RENDER_BUDGET_MS = 90_000

/** never thinner than one build every this many frames — past that the morph turns to mush */
export const MAX_STRIDE = 4

/**
 * How many frames each geometry build covers.
 *
 * One build a frame when the chain can afford it inside the budget. Otherwise
 * builds are spaced out and the shader cross-fades from each to the next, the
 * way the live view does — but on an exact schedule, so the result is still
 * the same file every time.
 */
export function chooseStride(msPerBuild: number, frames: number, budgetMs = RENDER_BUDGET_MS): number {
  for (let k = 1; k < MAX_STRIDE; k++) {
    if ((frames / k) * msPerBuild <= budgetMs) return k
  }
  return MAX_STRIDE
}

/**
 * What frame `i` shows: which frame's sheet to build now, if any, and how much
 * of the previous sheet still shows over it.
 *
 * With a stride of one, every frame builds its own sheet and nothing
 * dissolves. With a stride of `k`, the build at frame `i` is the sheet for
 * frame `i + k` — looked ahead, so frames `i … i+k-1` dissolve from the sheet
 * at `i` towards the sheet at `i + k` and frame `i + k` lands exactly on it.
 * Frame `n` is frame `0` again, which is the loop closing.
 */
export function frameAt(i: number, stride: number): { build: number | null; fade: number } {
  if (stride <= 1) return { build: i, fade: 0 }
  const j = i % stride
  return { build: j === 0 ? i + stride : null, fade: 1 - j / stride }
}

export function frameCount(seconds: number, fps: number): number {
  return Math.round(seconds * fps)
}

/** a turn of the event loop that is not tied to the screen, so a hidden tab still renders */
function breathe(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel()
    ch.port1.onmessage = () => resolve()
    ch.port2.postMessage(null)
  })
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

/** whether this browser can encode the clip at this size */
export async function canRenderClips(w: number, h: number): Promise<boolean> {
  if (typeof VideoEncoder === 'undefined') return false
  try {
    const { canEncodeVideo, Quality } = await import('mediabunny')
    return await canEncodeVideo('avc', { width: w, height: h, quality: new Quality({ bitrate: BITRATE }) })
  } catch {
    return false
  }
}

export async function renderClip(req: ClipRequest): Promise<Blob> {
  const { Output, Mp4OutputFormat, BufferTarget, CanvasSource, Quality } = await import('mediabunny')
  const total = frameCount(req.seconds, req.fps)
  const view = createFinishView(1, req.w, req.h)
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() })
  let started = false
  try {
    req.prepare(view)

    /*
     * The first few builds are timed before anything is committed to: the
     * first is always slow (cold caches), so the stride is decided on the
     * median of three, and those three are kept — they are sheets the clip
     * needs anyway when every frame is built.
     */
    const early = new Map<number, ClipLayers>()
    const costs: number[] = []
    for (let i = 0; i < Math.min(3, total); i++) {
      const t0 = performance.now()
      early.set(i, req.layersAt(i / req.fps))
      costs.push(performance.now() - t0)
    }
    // frame `total` is frame 0 again: the loop closing
    const build = (i: number) => early.get(i % total) ?? req.layersAt((i % total) / req.fps)
    const stride = chooseStride(median(costs), total)

    const source = new CanvasSource(view.canvas, {
      codec: 'avc',
      quality: new Quality({ bitrate: BITRATE }),
      keyFrameInterval: 2,
    })
    output.addVideoTrack(source, { frameRate: req.fps })
    await output.start()
    started = true

    // the sheet at frame 0 goes in first, so with a stride the first
    // look-ahead build pushes it into the "previous" slot to dissolve from
    const first = build(0)
    await view.setSheet(first.ground, first.word)

    const began = performance.now()
    for (let i = 0; i < total; i++) {
      if (req.signal?.aborted) throw new DOMException('The render was cancelled.', 'AbortError')
      const { build: b, fade } = frameAt(i, stride)
      // frame 0's own sheet is already on the GPU
      if (b !== null && !(stride === 1 && i === 0)) {
        const next = build(b)
        await view.setSheet(next.ground, next.word)
      }
      view.setFade(fade)
      view.draw()
      await source.add(i / req.fps, 1 / req.fps)

      const done = i + 1
      const spent = performance.now() - began
      req.onProgress?.(done, total, done >= 3 ? ((spent / done) * (total - done)) / 1000 : null)
      await breathe()
    }

    await output.finalize()
    const buffer = (output.target as InstanceType<typeof BufferTarget>).buffer
    if (!buffer) throw new Error('The clip came out empty.')
    return new Blob([buffer], { type: 'video/mp4' })
  } catch (e) {
    if (started) await output.cancel().catch(() => {})
    throw e
  } finally {
    view.destroy()
  }
}
