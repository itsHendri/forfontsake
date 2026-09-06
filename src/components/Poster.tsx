import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  buildPoster,
  buildPosterLayers,
  LAYOUTS,
  POSTER_PALETTES,
  SHEET_W,
  SHEET_H,
  type WordTransform,
} from '../lib/poster'
import { saveFile } from '../lib/exportFont'
import { copyText } from '../lib/clipboard'
import { getTreatment } from '../engine/treatments/registry'
import {
  BANDS,
  BAND_LABEL,
  DEFAULT_DEPTH,
  bandFor,
  bindKey,
  drivable,
  modulate,
  type Band,
  type Bindings,
} from '../lib/modulate'
import { AudioEngine } from '../audio/AudioEngine'
import { EnvelopeFollower } from '../audio/EnvelopeFollower'
import { createLoopSource, createMicSource } from '../audio/sources'
import { startSheetRecorder, type SheetRecorder } from '../lib/videoRecorder'
import {
  FINISHES,
  createFinishView,
  finishDefaults,
  getFinish,
  type FinishView,
} from '../lib/finish'
import type { AudioFrame } from '../audio/frame'
import type { FontData } from '../lib/glyphData'
import type { Overrides, Step } from '../lib/urlState'

interface Props {
  font: FontData
  fontId: string
  chain: Step[]
  overrides?: Overrides
  seed: number
  word: string
  onClose: () => void
}

const IDENTITY: WordTransform = { dx: 0, dy: 0, scale: 1 }

// The geometry rebuilds as fast as the chain can afford — a light chain on a
// short word reaches ~30fps and genuinely morphs; the heavy treatments sit
// nearer 7fps and lean on the cross-fade below to feel continuous.
const TICK_MS = 33
const TICK_MS_HEAVY = 140
const HEAVY = new Set(['growth', 'mosaic'])

/**
 * The engine's own envelopes are tuned for light shows — 12 ms attack, made
 * to twitch. Letterforms that twitch read as broken; letterforms that swell
 * and subside read as alive. So the modulation runs through a second, much
 * slower set of followers, each band on its own clock so the four drives
 * never move in lockstep — which is most of what "organic" means.
 */
function makeGlides() {
  return [
    new EnvelopeFollower(0.3, 0.9), // bass + beat
    new EnvelopeFollower(0.45, 1.1), // mids
    new EnvelopeFollower(0.25, 0.8), // highs
    new EnvelopeFollower(0.55, 1.3), // level
  ]
}

function glide(glides: EnvelopeFollower[], f: AudioFrame, dt: number): number[] {
  const targets = [Math.min(1, f.bass + f.beat * 0.5), f.mid, f.high, f.level]
  return glides.map((g, i) => g.update(targets[i], dt))
}

// long enough for a loop of the bubble track, short enough to stay postable
const MAX_RECORD_SECONDS = 15

/**
 * The specimen sheet, as a thing you can take away.
 *
 * A workbench screenshot is a picture of software. The same letters set on a
 * numbered sheet is a specimen, which is the form a foundry has always
 * published in — and it is the artefact somebody actually wants to post.
 * Randomise and Recolour are here rather than in the panel because they belong
 * to the sheet, not to the font. The word itself can be dragged and resized:
 * the sheet is a layout the user finishes, not a template they receive.
 */
export function Poster(p: Props) {
  const [sheetSeed, setSheetSeed] = useState(p.seed)
  const [paletteIndex, setPaletteIndex] = useState(0)
  const [layoutIndex, setLayoutIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [wordT, setWordT] = useState<WordTransform>(IDENTITY)

  const sheetRef = useRef<HTMLDivElement>(null)
  // a drag in flight: committed transform at pointerdown, plus where it started
  const dragRef = useRef<{ startX: number; startY: number; base: WordTransform } | null>(null)
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // wheel events arrive in bursts faster than the commit; accumulate here
  const pendingScale = useRef<number | null>(null)

  // Sound. The engine is created in a click handler, never on mount — an
  // AudioContext made outside a user gesture starts suspended, and StrictMode
  // would make one twice.
  const [soundSource, setSoundSource] = useState<'loop' | 'mic' | null>(null)
  const [modChain, setModChain] = useState<Step[] | null>(null)
  // how fast the letters move with the sound: it scales the clock the glides
  // run on, so low values are a slow drift and 1.5 is back to eager
  const [soundSpeed, setSoundSpeed] = useState(0.5)
  const soundSpeedRef = useRef(soundSpeed)
  // How far a driven dial swings, as a share of its span. Tuned by ear at 0.35
  // and kept as the default; adjustable because a heavy treatment on a short
  // word wants less travel than a light one on a long word.
  const [depth, setDepth] = useState(DEFAULT_DEPTH)
  const depthRef = useRef(depth)
  // Only the dials somebody has actually reassigned. Deriving the rest keeps
  // the map from going stale when a layer is added, removed or retreated.
  const [bindings, setBindings] = useState<Bindings>({})
  const bindingsRef = useRef(bindings)
  useEffect(() => {
    soundSpeedRef.current = soundSpeed
  }, [soundSpeed])
  useEffect(() => {
    depthRef.current = depth
  }, [depth])
  useEffect(() => {
    bindingsRef.current = bindings
  }, [bindings])
  const engineRef = useRef<AudioEngine | null>(null)
  const rafRef = useRef<number | null>(null)
  // how long the last sheet took to build, so the tick can back off adaptively
  const buildCost = useRef(0)

  // The rail hidden and the sheet given the whole window: for looking at, and
  // for pointing a camera at. It changes nothing about what gets exported —
  // the recorder draws the sheet at its own 1080×1350 either way.
  const [presenting, setPresenting] = useState(false)
  // The finish belongs to the sheet, not to the font: it is pixels over the
  // rendered page and never reaches the outlines, so it lives here with the
  // palette and the layout rather than in the workbench state or the URL.
  const [finishId, setFinishId] = useState('none')
  const [finishParams, setFinishParams] = useState<Record<string, number>>({})

  // Closing must never discard work: a take in flight is finished and saved
  // on the way out, and the backdrop stops being a close target while sound
  // or recording is live — a stray click outside the sheet must not kill a
  // performance. Escape always gets you out, but out of one thing at a time:
  // from a performance it returns the rail rather than throwing away the sheet
  // and whatever was playing.
  const closeRef = useRef<() => void>(p.onClose)
  const presentingRef = useRef(presenting)
  useEffect(() => {
    presentingRef.current = presenting
  }, [presenting])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (presentingRef.current) setPresenting(false)
      else closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Recording. The recorder lives in refs and the finisher in a ref too, so
  // stopSound (a stable callback) can save a take without stale closures.
  const [recording, setRecording] = useState(false)
  const [recSeconds, setRecSeconds] = useState(0)
  const recorderRef = useRef<SheetRecorder | null>(null)
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const recStemRef = useRef('sheet')
  const finishRecordingRef = useRef<(() => Promise<void>) | null>(null)

  const stopSound = useCallback(() => {
    // a deliberate stop mid-take keeps the take
    void finishRecordingRef.current?.()
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    engineRef.current?.setSource(null)
    setSoundSource(null)
    setModChain(null)
  }, [])

  // the overlay closing takes the sound with it — and abandons any take
  useEffect(
    () => () => {
      recorderRef.current?.cancel()
      recorderRef.current = null
      if (recTimerRef.current) clearInterval(recTimerRef.current)
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      engineRef.current?.dispose()
      engineRef.current = null
    },
    [],
  )

  const startTicking = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    const tier = p.chain.some((s) => HEAVY.has(s.id)) ? TICK_MS_HEAVY : TICK_MS
    const glides = makeGlides()
    let last = performance.now()
    let lastBuild = 0
    const loop = (now: number) => {
      const engine = engineRef.current
      if (!engine) return
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      // Tick every frame so the envelopes and detectors stay accurate; only
      // the glides run on the scaled clock — the Speed dial is time dilation
      // on the motion, not on the analysis.
      const drive = glide(glides, engine.tick(dt), dt * soundSpeedRef.current)
      // ...but rebuild the geometry at a pace the chain can afford
      if (now - lastBuild >= Math.max(tier, buildCost.current * 1.5)) {
        lastBuild = now
        setModChain(modulate(p.chain, drive, bindingsRef.current, depthRef.current))
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
  }, [p.chain])

  const startSound = async (kind: 'loop' | 'mic') => {
    setNote(null)
    try {
      const engine = engineRef.current ?? new AudioEngine()
      engineRef.current = engine
      await engine.resume()
      const source =
        kind === 'loop' ? await createLoopSource(engine.context) : await createMicSource(engine.context)
      engine.setSource(source)
      setSoundSource(kind)
      startTicking()
    } catch (e) {
      stopSound()
      setNote(e instanceof Error ? e.message : String(e))
    }
  }

  const palette = POSTER_PALETTES[paletteIndex % POSTER_PALETTES.length]
  const layout = LAYOUTS[layoutIndex % LAYOUTS.length]
  // the number is the seed's, so the same sheet always carries the same one
  const number = (sheetSeed % 999) + 1

  // Only worth explaining the omission when there is one: most stacks have no
  // steady dials at all, and a note about an absence that isn't there is noise.
  const hasSteady = p.chain.some((step) =>
    getTreatment(step.id).params.some((spec) => spec.primary && spec.steady),
  )

  // the sound rides the word sheet only — 69 glyphs re-treated at 10 Hz is
  // more than the heavy chains can afford
  useEffect(() => {
    if (layout.id !== 'word') stopSound()
  }, [layout.id, stopSound])

  const sheetChain = layout.id === 'word' && modChain ? modChain : p.chain

  const sheetReq = useMemo(
    () => ({
      font: p.font,
      fontId: p.fontId,
      chain: sheetChain,
      overrides: p.overrides,
      seed: sheetSeed,
      word: p.word,
      layout: layout.id,
      palette,
      number,
      wordTransform: wordT,
    }),
    [p.font, p.fontId, sheetChain, p.overrides, sheetSeed, p.word, layout.id, palette, number, wordT],
  )

  const layers = useMemo(() => {
    const t0 = performance.now()
    const out = buildPosterLayers(sheetReq)
    buildCost.current = performance.now() - t0
    return out
  }, [sheetReq])

  // The composed sheet is what the SVG download and the clipboard hand over,
  // and it is built only when one of them is pressed: composing it alongside
  // the layers would run the whole treatment chain twice per rebuild.
  const composed = () => buildPoster(sheetReq)

  const stem = `forfontsake-${p.chain.map((c) => c.id).join('-')}-${layout.id}-${String(number).padStart(3, '0')}`

  /*
   * The sheet on the GPU.
   *
   * The view owns a canvas and outlives every rebuild: handing it a new pair of
   * layers uploads two textures and keeps the outgoing pair, so the cross-fade
   * that turns a rebuild into a morph is a uniform rather than a second copy of
   * the sheet in the DOM.
   */
  const viewRef = useRef<FinishView | null>(null)
  const holdRef = useRef<HTMLDivElement | null>(null)
  const fadeRef = useRef(0)
  const lastLayers = useRef<{ ground: string; word: string | null } | null>(null)
  const [glError, setGlError] = useState<string | null>(null)
  // bumped whenever a view is made, so the sheet is handed to the new one
  // rather than waiting on layers that may never change again
  const [viewAge, setViewAge] = useState(0)

  /*
   * Creation and teardown both live on the ref, deliberately.
   *
   * Split across a ref and an unmount effect they interleave under StrictMode's
   * double mount: the effect's cleanup loses the GL context while the first
   * canvas is still in the DOM, so the sheet renders onto a dead one and comes
   * out blank. Doing both here means a holder can only ever have the live
   * canvas in it, and `lastLayers` is cleared so the new view is handed a sheet
   * rather than waiting for one that never changes.
   */
  const mount = useCallback((el: HTMLDivElement | null) => {
    viewRef.current?.destroy()
    viewRef.current = null
    lastLayers.current = null
    holdRef.current = el
    if (!el) return
    el.replaceChildren()
    try {
      const view = createFinishView(1)
      viewRef.current = view
      el.appendChild(view.canvas)
      setGlError(null)
      setViewAge((n) => n + 1)
    } catch (e) {
      setGlError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  // a new sheet, and the fade over the old one that makes it a morph
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const same =
      lastLayers.current?.ground === layers.ground && lastLayers.current?.word === layers.word
    if (same) return
    lastLayers.current = { ground: layers.ground, word: layers.word }
    void view.setSheet(layers.ground, layers.word).then(() => {
      fadeRef.current = 1
    })
  }, [layers, viewAge])

  const finishSpec = getFinish(finishId)
  useEffect(() => {
    viewRef.current?.setFinish(finishId, finishParams)
  }, [finishId, finishParams])

  // One loop while the sheet is open. It is a full-screen quad over 1080×1350 —
  // a rounding error next to the geometry that produced the sheet — and having
  // one loop means the fade, the drag and the dials all reach the screen the
  // same way.
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      if (fadeRef.current > 0) {
        // a slower drift earns a longer dissolve, as the CSS version did
        fadeRef.current = Math.max(0, fadeRef.current - dt / (0.35 / Math.max(0.35, soundSpeed)))
      }
      const view = viewRef.current
      if (view) {
        view.setFade(fadeRef.current)
        view.draw()
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [soundSpeed])

  const finishRecording = async () => {
    const recorder = recorderRef.current
    if (!recorder) return
    recorderRef.current = null
    if (recTimerRef.current) clearInterval(recTimerRef.current)
    setRecording(false)
    try {
      const { blob, extension } = await recorder.stop()
      await saveFile(blob, `${recStemRef.current}-live.${extension}`)
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    }
  }
  /** finish any take, then leave — the exit that keeps the work */
  const handleClose = () => {
    void finishRecordingRef.current?.()
    p.onClose()
  }

  // kept fresh so stopSound, Escape and the countdown can finish a take
  // without closing over a stale sheet or filename
  useEffect(() => {
    finishRecordingRef.current = finishRecording
    closeRef.current = handleClose
  })

  const startRecording = () => {
    const engine = engineRef.current
    if (!engine || recorderRef.current) return
    setNote(null)
    try {
      const canvas = viewRef.current?.canvas
      if (!canvas) throw new Error('The sheet is not ready to record yet.')
      recorderRef.current = startSheetRecorder(canvas, engine.captureStream())
      recStemRef.current = stem
      setRecSeconds(0)
      setRecording(true)
      recTimerRef.current = setInterval(() => {
        setRecSeconds((s) => {
          if (s + 1 >= MAX_RECORD_SECONDS) void finishRecordingRef.current?.()
          return s + 1
        })
      }, 1000)
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    }
  }

  /*
   * The SVG stays letterforms only.
   *
   * A finish is pixels, and there is no honest way to put pixels into a vector
   * file — so the download says so rather than quietly handing over a sheet
   * that does not match the screen.
   */
  const downloadSvg = async () => {
    await saveFile(new Blob([composed()], { type: 'image/svg+xml;charset=utf-8' }), `${stem}.svg`)
    if (finishId !== 'none') setNote('The SVG carries the letters, not the finish — a finish is pixels.')
  }

  // Drawn again at 2× so the sheet holds up posted anywhere that shows it
  // large. The same pipeline as the screen, one throwaway view wider: two ways
  // of applying a finish would be two finishes.
  const downloadPng = async () => {
    setBusy(true)
    setNote(null)
    try {
      const shot = createFinishView(2)
      try {
        shot.setFinish(finishId, finishParams)
        shot.setOffset(wordT.dx, wordT.dy)
        await shot.setSheet(layers.ground, layers.word)
        shot.draw()
        const blob = await new Promise<Blob>((resolve, reject) =>
          shot.canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('could not draw the sheet'))), 'image/png'),
        )
        await saveFile(blob, `${stem}.png`)
      } finally {
        shot.destroy()
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const copySvg = async () => {
    const ok = await copyText(composed())
    setNote(
      ok
        ? 'Copied as SVG — paste into Figma or any editor.'
        : 'The browser would not let the page use the clipboard. Download the SVG instead.',
    )
  }

  /** one client-space delta, in sheet pixels */
  const toSheet = (px: number) => {
    const el = viewRef.current?.canvas
    return el && el.clientWidth ? px * (SHEET_W / el.clientWidth) : px
  }

  /**
   * Is the pointer on the word?
   *
   * The sheet is a canvas now, so there is no element to hit. `buildPosterLayers`
   * hands back the rectangle the word is drawn in — without its drag, because
   * the drag is the shader's uniform — so the test adds the drag back and asks
   * whether the point is inside. A test pins that box to the transform beside
   * it, since a box that drifts means dragging quietly starts missing.
   */
  const onWord = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = layers.wordBox
    const el = viewRef.current?.canvas
    if (!box || !el) return false
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) return false
    const x = ((e.clientX - r.left) / r.width) * SHEET_W - wordT.dx
    const y = ((e.clientY - r.top) / r.height) * SHEET_H - wordT.dy
    return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h
  }

  /**
   * Dragging moves a uniform and commits on release. A full rebuild per
   * pointermove would re-run the whole treatment chain — tens of milliseconds
   * on the heavy ones — where changing one uniform is free.
   */
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (layout.id !== 'word' || !onWord(e)) return
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startY: e.clientY, base: wordT }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    viewRef.current?.setOffset(
      drag.base.dx + toSheet(e.clientX - drag.startX),
      drag.base.dy + toSheet(e.clientY - drag.startY),
    )
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    const dx = drag.base.dx + toSheet(e.clientX - drag.startX)
    const dy = drag.base.dy + toSheet(e.clientY - drag.startY)
    setWordT({ ...drag.base, dx, dy })
  }

  /** wheel over the word resizes it; committed on a short trailing debounce */
  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (layout.id !== 'word') return
    const target = e.target as Element
    if (!target.closest?.('[data-part="word"]')) return
    const factor = Math.exp(-e.deltaY * 0.0012)
    const next = clamp((pendingScale.current ?? wordT.scale) * factor, 0.25, 2)
    pendingScale.current = next
    if (wheelTimer.current) clearTimeout(wheelTimer.current)
    wheelTimer.current = setTimeout(() => {
      pendingScale.current = null
      setWordT((t) => ({ ...t, scale: next }))
    }, 90)
  }

  const moved = wordT.dx !== 0 || wordT.dy !== 0 || wordT.scale !== 1

  return (
    <div
      className={presenting ? 'poster-backdrop is-presenting' : 'poster-backdrop'}
      onClick={() => {
        // presenting is a performance too — leaving it is deliberate or not at all
        if (!presenting && !soundSource && !recorderRef.current) p.onClose()
      }}
      role="presentation"
    >
      <div
        className={presenting ? 'poster is-presenting' : 'poster'}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Specimen sheet"
      >
        <div
          className="poster-sheet"
          ref={sheetRef}
          role="img"
          aria-label={`Specimen sheet number ${number}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onWheel={onWheel}
        >
          <div className="sheet-live" ref={mount} />
          {glError && <p className="notice is-bad">{glError}</p>}
        </div>

        {presenting && (
          <div className="present-bar">
            <button type="button" onClick={() => setPresenting(false)}>
              Stop presenting
            </button>
            {/* the rail is hidden, and a take running with no way to stop it
                and no countdown would be a trap */}
            {recording && (
              <button type="button" className="is-live" onClick={() => void finishRecording()}>
                Stop · {recSeconds}s
              </button>
            )}
            <p className="muted">Escape returns the controls.</p>
          </div>
        )}

        <div className="poster-side">
          <h2>Specimen No. {String(number).padStart(3, '0')}</h2>

          {/* The sheets, paged rather than listed — two is not a menu. */}
          <div className="sheets">
            {LAYOUTS.map((l, i) => (
              <button
                type="button"
                key={l.id}
                className={i === layoutIndex % LAYOUTS.length ? 'chip is-on' : 'chip'}
                onClick={() => setLayoutIndex(i)}
                title={l.note}
              >
                {l.name}
              </button>
            ))}
          </div>
          <p className="muted sheet-note">{layout.note}</p>

          <div className="row">
            <button type="button" onClick={() => setSheetSeed(Math.floor(Math.random() * 9999) + 1)}>
              Randomise
            </button>
            <button type="button" onClick={() => setPaletteIndex((i) => i + 1)}>
              Recolour
            </button>
            <button type="button" onClick={() => setPresenting(true)} title="Hide everything but the sheet">
              Present
            </button>
          </div>

          {layout.id === 'word' && (
            <div className="word-place ctl">
              <div className="ctl-head">
                <label htmlFor="word-size">Word size</label>
                <output htmlFor="word-size" className={wordT.scale === 1 ? 'is-default' : undefined}>
                  {wordT.scale.toFixed(2)}
                </output>
              </div>
              <input
                id="word-size"
                type="range"
                min={0.25}
                max={2}
                step={0.05}
                value={wordT.scale}
                onChange={(e) => setWordT((t) => ({ ...t, scale: Number(e.target.value) }))}
                onDoubleClick={() => setWordT((t) => ({ ...t, scale: 1 }))}
              />
              <p className="muted sheet-note">
                Drag the word to place it{moved ? ' · ' : '.'}
                {moved && (
                  <button type="button" className="linkish" onClick={() => setWordT(IDENTITY)}>
                    Reset position
                  </button>
                )}
              </p>
            </div>
          )}

          <div className="finish">
            <h2>Finish</h2>
            <div className="chips">
              {FINISHES.map((f) => (
                <button
                  type="button"
                  key={f.id}
                  className={f.id === finishId ? 'chip is-on' : 'chip'}
                  onClick={() => {
                    setFinishId(f.id)
                    setFinishParams(finishDefaults(f))
                  }}
                  title={f.blurb}
                >
                  {f.name}
                </button>
              ))}
            </div>
            <p className="muted sheet-note">{finishSpec.blurb}</p>
            {finishSpec.params.map((spec) => (
              <div className="ctl" key={spec.key}>
                <div className="ctl-head">
                  <label htmlFor={`finish-${spec.key}`}>{spec.label}</label>
                  <output
                    htmlFor={`finish-${spec.key}`}
                    className={(finishParams[spec.key] ?? spec.default) === spec.default ? 'is-default' : undefined}
                  >
                    {finishParams[spec.key] ?? spec.default}
                  </output>
                </div>
                <input
                  id={`finish-${spec.key}`}
                  type="range"
                  min={spec.min}
                  max={spec.max}
                  step={spec.step}
                  value={finishParams[spec.key] ?? spec.default}
                  onChange={(e) =>
                    setFinishParams((v) => ({ ...v, [spec.key]: Number(e.target.value) }))
                  }
                  onDoubleClick={() => setFinishParams((v) => ({ ...v, [spec.key]: spec.default }))}
                />
                {spec.note && <p className="ctl-note">{spec.note}</p>}
              </div>
            ))}
          </div>

          {layout.id === 'word' && (
            <div className="sound">
              <h2>Sound</h2>
              <div className="row">
                <button
                  type="button"
                  className={soundSource === 'loop' ? 'is-live' : undefined}
                  onClick={() => (soundSource === 'loop' ? stopSound() : startSound('loop'))}
                >
                  {soundSource === 'loop' ? 'Stop' : 'Play loop'}
                </button>
                <button
                  type="button"
                  className={soundSource === 'mic' ? 'is-live' : undefined}
                  onClick={() => (soundSource === 'mic' ? stopSound() : startSound('mic'))}
                >
                  {soundSource === 'mic' ? 'Stop mic' : 'Use mic'}
                </button>
              </div>
              <div className="ctl">
                <div className="ctl-head">
                  <label htmlFor="sound-speed">Speed</label>
                  <output htmlFor="sound-speed" className={soundSpeed === 0.5 ? 'is-default' : undefined}>
                    {soundSpeed.toFixed(2)}
                  </output>
                </div>
                <input
                  id="sound-speed"
                  type="range"
                  min={0.1}
                  max={1.5}
                  step={0.05}
                  value={soundSpeed}
                  onChange={(e) => setSoundSpeed(Number(e.target.value))}
                  onDoubleClick={() => setSoundSpeed(0.5)}
                />
                <p className="ctl-note">low is a slow drift, high is eager</p>
              </div>
              <div className="ctl">
                <div className="ctl-head">
                  <label htmlFor="sound-depth">Depth</label>
                  <output htmlFor="sound-depth" className={depth === DEFAULT_DEPTH ? 'is-default' : undefined}>
                    {Math.round(depth * 100)}%
                  </output>
                </div>
                <input
                  id="sound-depth"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={depth}
                  onChange={(e) => setDepth(Number(e.target.value))}
                  onDoubleClick={() => setDepth(DEFAULT_DEPTH)}
                />
                <p className="ctl-note">how far a dial swings from where you left it</p>
              </div>

              {/*
                Which dial listens to what. The sheet used to assign these in
                declared order with no say in it, so whichever dial a treatment
                happened to list first got the bass — and on half the
                treatments that is the wrong dial to put a kick on.
              */}
              <div className="binds">
                <h2>What the sound moves</h2>
                {p.chain.map((step, i) =>
                  drivable(step).map((spec, order) => {
                    const id = `bind-${i}-${spec.key}`
                    const band = bandFor(bindings, i, spec.key, order)
                    return (
                      <div className="bind" key={id}>
                        <label htmlFor={id}>
                          {spec.label}
                          {p.chain.length > 1 && (
                            <em> {getTreatment(step.id).name}</em>
                          )}
                        </label>
                        <select
                          id={id}
                          value={band ?? ''}
                          className={band ? undefined : 'is-off'}
                          onChange={(e) =>
                            setBindings((b) => ({
                              ...b,
                              [bindKey(i, spec.key)]: (e.target.value || null) as Band | null,
                            }))
                          }
                        >
                          <option value="">Nothing</option>
                          {BANDS.map((b) => (
                            <option key={b} value={b}>
                              {BAND_LABEL[b]}
                            </option>
                          ))}
                        </select>
                      </div>
                    )
                  }),
                )}
                {hasSteady && (
                  <p className="sheet-note muted">
                    Dials that switch between pictures rather than move within one are not
                    listed — driven, they strobe rather than animate.
                  </p>
                )}
              </div>
              <div className="row">
                <button
                  type="button"
                  className={recording ? 'is-live' : undefined}
                  disabled={!soundSource}
                  onClick={() => (recording ? void finishRecording() : startRecording())}
                >
                  {recording ? `Stop · ${recSeconds}s` : 'Record clip'}
                </button>
              </div>
              {soundSource && (
                <p className="muted sheet-note">
                  {recording
                    ? `Recording the sheet and the sound — up to ${MAX_RECORD_SECONDS} seconds, then it saves itself.`
                    : 'The dials are riding the sound. Download a still, or record a clip to post.'}
                </p>
              )}
            </div>
          )}

          <div className="row">
            <button type="button" className="save" onClick={downloadPng} disabled={busy}>
              {busy ? 'Rendering…' : 'Download PNG'}
            </button>
            <button type="button" onClick={downloadSvg}>
              Download SVG
            </button>
          </div>

          <div className="row">
            <button type="button" onClick={copySvg}>
              Copy SVG
            </button>
            <button type="button" onClick={handleClose}>
              Close
            </button>
          </div>

          {note && <p className="muted">{note}</p>}
        </div>
      </div>
    </div>
  )
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

