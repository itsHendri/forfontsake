import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  buildPoster,
  LAYOUTS,
  POSTER_PALETTES,
  SHEET_W,
  SHEET_H,
  type WordTransform,
} from '../lib/poster'
import { saveFile } from '../lib/exportFont'
import { copyText } from '../lib/clipboard'
import { getTreatment } from '../engine/treatments/registry'
import { AudioEngine } from '../audio/AudioEngine'
import { EnvelopeFollower } from '../audio/EnvelopeFollower'
import { createLoopSource, createMicSource } from '../audio/sources'
import { startSheetRecorder, type SheetRecorder } from '../lib/videoRecorder'
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

/**
 * The dials, ridden by the sound.
 *
 * Each step's primary dials are driven in declared order by bass (with a kick
 * on the beat), mids, highs and overall level — set point plus up to 35% of
 * the dial's span, clamped to its range. Deliberately *not* snapped to the
 * dial's step: the seed is fixed, so the geometry is a continuous function of
 * the values, and un-snapped values are what let one frame morph into the
 * next instead of clicking through increments. The seed is never touched —
 * this is pure parameter modulation, so a captured frame is exactly
 * reproducible from the values it was drawn with.
 */
function modulate(chain: Step[], drive: number[]): Step[] {
  return chain.map((step) => {
    const primary = getTreatment(step.id).params.filter((s) => s.primary)
    const params = { ...step.params }
    primary.slice(0, drive.length).forEach((spec, i) => {
      const raw = (step.params[spec.key] ?? spec.default) + drive[i] * 0.35 * (spec.max - spec.min)
      params[spec.key] = Math.min(spec.max, Math.max(spec.min, raw))
    })
    return { id: step.id, params }
  })
}

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
  useEffect(() => {
    soundSpeedRef.current = soundSpeed
  }, [soundSpeed])
  const engineRef = useRef<AudioEngine | null>(null)
  const rafRef = useRef<number | null>(null)
  // how long the last sheet took to build, so the tick can back off adaptively
  const buildCost = useRef(0)

  // Closing must never discard work: a take in flight is finished and saved
  // on the way out, and the backdrop stops being a close target while sound
  // or recording is live — a stray click outside the sheet must not kill a
  // performance. Close and Escape always work.
  const closeRef = useRef<() => void>(p.onClose)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current()
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
        setModChain(modulate(p.chain, drive))
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

  // the sound rides the word sheet only — 69 glyphs re-treated at 10 Hz is
  // more than the heavy chains can afford
  useEffect(() => {
    if (layout.id !== 'word') stopSound()
  }, [layout.id, stopSound])

  const sheetChain = layout.id === 'word' && modChain ? modChain : p.chain

  const svg = useMemo(() => {
    const t0 = performance.now()
    const out = buildPoster({
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
    })
    buildCost.current = performance.now() - t0
    return out
  }, [p.font, p.fontId, sheetChain, p.overrides, sheetSeed, p.word, layout.id, palette, number, wordT])

  const stem = `forfontsake-${p.chain.map((c) => c.id).join('-')}-${layout.id}-${String(number).padStart(3, '0')}`

  // every new sheet reaches a running recorder
  useEffect(() => {
    recorderRef.current?.update(svg)
  }, [svg])

  // While sound plays, the outgoing sheet lingers briefly over the incoming
  // one — the sheets are opaque, so an old one fading off the top reads as
  // the letters morphing rather than a cut.
  const lastSvgRef = useRef(svg)
  const ghostKeyRef = useRef(0)
  const [ghost, setGhost] = useState<{ svg: string; key: number } | null>(null)
  useEffect(() => {
    if (soundSource && lastSvgRef.current !== svg) {
      setGhost({ svg: lastSvgRef.current, key: ++ghostKeyRef.current })
    } else if (!soundSource && ghostKeyRef.current > 0) {
      setGhost(null)
    }
    lastSvgRef.current = svg
  }, [svg, soundSource])

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
      recorderRef.current = startSheetRecorder(
        SHEET_W,
        SHEET_H,
        svg,
        palette.paper,
        engine.captureStream(),
      )
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

  const downloadSvg = async () => {
    await saveFile(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `${stem}.svg`)
  }

  // Rasterised at 2× so the sheet holds up posted anywhere that shows it large.
  const downloadPng = async () => {
    setBusy(true)
    setNote(null)
    try {
      const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
      const blob = await rasterise(src, SHEET_W * 2, SHEET_H * 2)
      await saveFile(blob, `${stem}.png`)
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const copySvg = async () => {
    const ok = await copyText(svg)
    setNote(
      ok
        ? 'Copied as SVG — paste into Figma or any editor.'
        : 'The browser would not let the page use the clipboard. Download the SVG instead.',
    )
  }

  /** one client-space delta, in sheet pixels */
  const toSheet = (px: number) => {
    const el = sheetRef.current?.querySelector('svg')
    return el ? px * (SHEET_W / el.clientWidth) : px
  }

  const wordGroup = () =>
    sheetRef.current?.querySelector<SVGGElement>('[data-part="word"]') ?? null

  /**
   * Dragging mutates the live group's transform and commits on release. A full
   * rebuild per pointermove would re-run the whole treatment chain — tens of
   * milliseconds on the heavy ones — where moving one attribute is free.
   */
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (layout.id !== 'word') return
    const target = e.target as Element
    if (!target.closest?.('[data-part="word"]')) return
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startY: e.clientY, base: wordT }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    const g = wordGroup()
    if (!drag || !g) return
    const dx = drag.base.dx + toSheet(e.clientX - drag.startX)
    const dy = drag.base.dy + toSheet(e.clientY - drag.startY)
    const rest = g.dataset.baseTransform ?? g.getAttribute('transform') ?? ''
    // remember the untouched transform so each move replaces, not accumulates
    if (!g.dataset.baseTransform) g.dataset.baseTransform = rest
    g.setAttribute(
      'transform',
      `translate(${dx - drag.base.dx}, ${dy - drag.base.dy}) ${rest}`,
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
      className="poster-backdrop"
      onClick={() => {
        if (!soundSource && !recorderRef.current) p.onClose()
      }}
      role="presentation"
    >
      <div
        className="poster"
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
          <div className="sheet-live" dangerouslySetInnerHTML={{ __html: svg }} />
          {ghost && (
            <div
              className="sheet-ghost"
              key={ghost.key}
              aria-hidden="true"
              // a slower drift earns a longer dissolve
              style={{ animationDuration: `${Math.round(350 / Math.max(0.35, soundSpeed))}ms` }}
              dangerouslySetInnerHTML={{ __html: ghost.svg }}
            />
          )}
        </div>

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

/**
 * SVG string to PNG, through an image and a canvas.
 *
 * The canvas stays untainted because the source is a data URI of our own
 * making with nothing external in it — which is also why the poster embeds no
 * fonts it did not draw as outlines.
 */
function rasterise(src: string, width: number, height: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) return reject(new Error('no 2d canvas'))
      ctx.drawImage(img, 0, 0, width, height)
      canvas.toBlob((blob) => {
        if (blob) resolve(blob)
        else reject(new Error('the sheet could not be rendered'))
      }, 'image/png')
    }
    img.onerror = () => reject(new Error('the sheet could not be rendered'))
    img.src = src
  })
}
