import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  buildPoster,
  buildPosterLayers,
  FORMATS,
  getFormat,
  LAYOUTS,
  POSTER_PALETTES,
  type WordTransform,
} from '../lib/poster'
import { saveFile } from '../lib/exportFont'
import { getTreatment } from '../engine/treatments/registry'
import {
  DEFAULT_DEPTH,
  DEFAULT_MODE,
  MODES,
  SoundDrive,
  bindingsFor,
  getMode,
  modulate,
} from '../lib/modulate'
import { AudioEngine } from '../audio/AudioEngine'
import { createLoopSource, createMicSource } from '../audio/sources'
import { startSheetRecorder, type SheetRecorder } from '../lib/videoRecorder'
import {
  FINISHES,
  createFinishView,
  finishDefaults,
  getFinish,
  type FinishView,
} from '../lib/finish'
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
  /*
   * Static or video: the one choice the whole room hangs off.
   *
   * It is a mode rather than a consequence of turning the sound on, because the
   * clip is the capability nobody else in this niche has and a mode nobody can
   * see is a mode nobody uses. The rule underneath it runs one way only —
   * sound is what makes a moving export possible, never the reverse — so in
   * static there is no sound anywhere to wonder about, and choosing MP4 can
   * never silently start it.
   */
  const [mode, setMode] = useState<'static' | 'video'>('static')
  // The sheet's size is a property of the sheet, not of the export. Every tool
  // in this category splits them that way; the download stays type and scale.
  const [formatId, setFormatId] = useState(FORMATS[0].id)
  const [soundModeId, setSoundModeId] = useState(DEFAULT_MODE.id)
  const [stillType, setStillType] = useState<'png' | 'svg'>('png')
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
  const soundModeRef = useRef(soundModeId)
  useEffect(() => {
    soundSpeedRef.current = soundSpeed
  }, [soundSpeed])
  useEffect(() => {
    depthRef.current = depth
  }, [depth])
  useEffect(() => {
    soundModeRef.current = soundModeId
  }, [soundModeId])
  const engineRef = useRef<AudioEngine | null>(null)
  const rafRef = useRef<number | null>(null)
  // how long the last sheet took to build, so the tick can back off adaptively
  const buildCost = useRef(0)

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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current()
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
    const drive = new SoundDrive()
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
      const bands = drive.read(engine.tick(dt), dt * soundSpeedRef.current)
      // ...but rebuild the geometry at a pace the chain can afford
      if (now - lastBuild >= Math.max(tier, buildCost.current * 1.5)) {
        lastBuild = now
        setModChain(
          modulate(p.chain, bands, bindingsFor(getMode(soundModeRef.current), p.chain), depthRef.current),
        )
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
  const format = getFormat(formatId)
  // the number is the seed's, so the same sheet always carries the same one
  const number = (sheetSeed % 999) + 1


  /*
   * Either sheet can move; what varies is how fast.
   *
   * The character set was barred outright on the grounds that 69 glyphs per
   * frame is beyond the engine. Measured, that is 13–15× a word — which is a
   * lot, and still leaves Halftone at 19 rebuilds a second and Organic at 25.
   * It is Grit (1.6) and stacked chains (0.6) that step rather than flow, and
   * those are slow on a word too. So the limit is the chain's cost, not the
   * layout, and the rail reports it instead of the picker forbidding it.
   */
  useEffect(() => {
    if (mode !== 'video') stopSound()
  }, [mode, stopSound])

  const sheetChain = mode === 'video' && modChain ? modChain : p.chain

  const sheetReq = useMemo(
    () => ({
      font: p.font,
      fontId: p.fontId,
      chain: sheetChain,
      overrides: p.overrides,
      seed: sheetSeed,
      word: p.word,
      layout: layout.id,
      format: format.id,
      palette,
      number,
      wordTransform: wordT,
    }),
    [p.font, p.fontId, sheetChain, p.overrides, sheetSeed, p.word, layout.id, format.id, palette, number, wordT],
  )

  /*
   * How long a rebuild takes, from more than one rebuild.
   *
   * The first build of a sheet is not representative — cold paths, nothing
   * warm — and on the character set it came in around sixteen times the
   * settled cost, which reported a usable chain as one frame every ten
   * seconds. So the rail waits for a few samples and reads the median of the
   * recent ones, and says nothing until it has enough to be worth saying.
   */
  const costs = useRef<number[]>([])
  const [frameMs, setFrameMs] = useState(0)
  const [samples, setSamples] = useState(0)
  const layers = useMemo(() => {
    const t0 = performance.now()
    const out = buildPosterLayers(sheetReq)
    buildCost.current = performance.now() - t0
    return out
  }, [sheetReq])

  useEffect(() => {
    costs.current = [...costs.current, buildCost.current].slice(-7)
    const sorted = [...costs.current].sort((a, b) => a - b)
    const ms = Math.round(sorted[Math.floor(sorted.length / 2)])
    setSamples(costs.current.length)
    setFrameMs((prev) => (Math.abs(prev - ms) > Math.max(8, prev * 0.25) ? ms : prev))
  }, [layers])

  // a different sheet is a different measurement — start the count again
  useEffect(() => {
    costs.current = []
    setSamples(0)
  }, [layout.id, format.id, p.chain])

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
  // read through a ref so the mount callback stays stable: it is keyed on the
  // format in the DOM instead, which is what forces a fresh canvas at a new size
  const formatRef = useRef(format)
  formatRef.current = format
  const mount = useCallback((el: HTMLDivElement | null) => {
    viewRef.current?.destroy()
    viewRef.current = null
    lastLayers.current = null
    holdRef.current = el
    if (!el) return
    el.replaceChildren()
    try {
      const view = createFinishView(1, formatRef.current.w, formatRef.current.h)
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
      const shot = createFinishView(2, format.w, format.h)
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


  /** one client-space delta, in sheet pixels */
  const toSheet = (px: number) => {
    const el = viewRef.current?.canvas
    return el && el.clientWidth ? px * (format.w / el.clientWidth) : px
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
    const x = ((e.clientX - r.left) / r.width) * format.w - wordT.dx
    const y = ((e.clientY - r.top) / r.height) * format.h - wordT.dy
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
  const chainName = p.chain.map((c) => getTreatment(c.id).name).join(' + ')
  const inVideo = mode === 'video'

  /*
   * A picture of each layout, drawn from the real engine.
   *
   * The layouts are the one choice on this screen where the difference is
   * entirely visual, so it is shown rather than named — the same argument the
   * workbench presets won on. Memoised on everything except the dials, because
   * the chain the sheet is handed does not change while you are in here (the
   * sound modulates a copy), so this is two renders per visit rather than two
   * per frame.
   */
  const layoutThumbs = useMemo(
    () =>
      LAYOUTS.map((l) => {
        try {
          const svg = buildPoster({ ...sheetReq, chain: p.chain, layout: l.id, wordTransform: IDENTITY })
          return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
        } catch {
          return null
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.font, p.fontId, p.chain, p.overrides, sheetSeed, p.word, format.id, palette, number],
  )

  /** leaving static for video, or the other way, and what each costs */
  const setStatic = () => {
    stopSound()
    setMode('static')
  }
  const setVideo = () => setMode('video')

  /*
   * What the sound will actually get out of this chain.
   *
   * The rebuild rate is adaptive already — the tick backs off to the measured
   * cost — so this is that number said out loud rather than a new limit. Under
   * about six a second the letters step between shapes instead of morphing
   * through them, which is worth knowing before you record fifteen seconds of
   * it rather than after.
   */
  const framesPerSecond = frameMs > 0 ? 1000 / Math.max(TICK_MS, frameMs * 1.5) : null
  // three rebuilds before it is allowed an opinion; one is just the cold one
  const steppy = samples >= 3 && framesPerSecond !== null && framesPerSecond < 6

  const download = () => (stillType === 'svg' ? void downloadSvg() : void downloadPng())

  return (
    <div className="sheet-view">
      <header className="sheet-bar">
        <b className="sheet-name">{chainName}</b>
        <span className="sheet-no">Specimen No. {String(number).padStart(3, '0')}</span>

        {/*
          Static or video, centred above everything it governs. It is the only
          control disabled while a take runs: you cannot change what you are
          recording halfway through it.
        */}
        <div className="mode-switch" role="group" aria-label="Still or video">
          <button
            type="button"
            className={inVideo ? 'seg' : 'seg is-on'}
            aria-pressed={!inVideo}
            disabled={recording}
            onClick={setStatic}
          >
            Static
          </button>
          <button
            type="button"
            className={inVideo ? 'seg is-on' : 'seg'}
            aria-pressed={inVideo}
            disabled={recording}
            onClick={setVideo}
          >
            Video
          </button>
        </div>

        <label className="visually-hidden" htmlFor="sheet-format">
          Sheet size
        </label>
        <select id="sheet-format" value={format.id} onChange={(e) => setFormatId(e.target.value)}>
          {FORMATS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name} {f.ratio} · {f.w} × {f.h}
            </option>
          ))}
        </select>
        {/* closing finishes a take rather than losing it — see handleClose */}
        <button type="button" className="sheet-close" onClick={handleClose} aria-label="Close the sheet">
          ✕
        </button>
      </header>

      <div className="sheet-body">
        <div
          className="sheet-stage"
          ref={sheetRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onWheel={onWheel}
        >
          {recording && (
            <p className="rec-pill" role="status">
              <span className="rec-dot" aria-hidden="true" />
              Recording · 0:{String(recSeconds).padStart(2, '0')}
            </p>
          )}
          <div
            className="sheet-live"
            /* a new size needs a new canvas, so the holder is keyed on it */
            key={format.id}
            ref={mount}
            role="img"
            aria-label={`Specimen sheet number ${number}`}
          />
          {glError && <p className="notice is-bad">{glError}</p>}
        </div>

        <aside className="sheet-rail">
          <div className="group">
            <h2>Layout</h2>
            <div className="layout-pick">
              {LAYOUTS.map((l, i) => {
                const on = l.id === layout.id
                return (
                  <button
                    type="button"
                    key={l.id}
                    className={`layout-cell${on ? ' is-on' : ''}`}
                    aria-pressed={on}
                    title={l.note}
                    onClick={() => setLayoutIndex(i)}
                  >
                    {layoutThumbs[i] ? (
                      <img src={layoutThumbs[i]!} alt="" />
                    ) : (
                      <span className="layout-blank" />
                    )}
                    <span>{l.name}</span>
                  </button>
                )
              })}
            </div>
            {inVideo && steppy && (
              <p className="note">
                This chain redraws {layout.id === 'chars' ? 'the character set' : 'the word'} about{' '}
                {framesPerSecond!.toFixed(1)} times a second, so the letters will step between
                shapes rather than morph through them. A lighter chain, or one layer fewer, moves
                smoothly.
              </p>
            )}
            {layout.id === 'word' && (
              <div className="ctl word-place">
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
                <p className="note">
                  Drag the word to place it{moved ? ' · ' : '.'}
                  {moved && (
                    <button type="button" className="linkish" onClick={() => setWordT(IDENTITY)}>
                      Reset position
                    </button>
                  )}
                </p>
              </div>
            )}
          </div>

          <div className="group ruled">
            <h2>Finish</h2>
            <div className="chips">
              {FINISHES.map((f) => (
                <button
                  type="button"
                  key={f.id}
                  className={f.id === finishId ? 'chip is-on' : 'chip'}
                  aria-pressed={f.id === finishId}
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
                  onChange={(e) => setFinishParams((v) => ({ ...v, [spec.key]: Number(e.target.value) }))}
                  onDoubleClick={() => setFinishParams((v) => ({ ...v, [spec.key]: spec.default }))}
                />
              </div>
            ))}
            <div className="row">
              <button type="button" onClick={() => setSheetSeed(Math.floor(Math.random() * 9999) + 1)}>
                Randomise
              </button>
              <button type="button" onClick={() => setPaletteIndex((i) => i + 1)}>
                Recolour
              </button>
            </div>
          </div>

          {/*
            Sound exists only in video. Not greyed, not collapsed — absent — so
            "does picking MP4 turn the sound on?" is a question that cannot come
            up: it is sound that makes a moving export possible, never the other
            way round.
          */}
          {inVideo && (
            <div className="group ruled sound">
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
              <div className="chips">
                {MODES.map((m) => (
                  <button
                    type="button"
                    key={m.id}
                    className={m.id === soundModeId ? 'chip is-on' : 'chip'}
                    aria-pressed={m.id === soundModeId}
                    onClick={() => setSoundModeId(m.id)}
                    title={m.note}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
              <p className="note">{getMode(soundModeId).note}</p>
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
              </div>
            </div>
          )}

          <div className="rail-push" />

          {/*
            One type and one button. Copy SVG and Copy link went with this: a
            second row of verbs beside a download is furniture, and the type
            select already says everything the extra buttons said.
          */}
          <div className="group ruled">
            <h2>Export</h2>
            {inVideo ? (
              <>
                <div className="row">
                  <span className="pill">MP4</span>
                  <span className="pill">up to {MAX_RECORD_SECONDS}s</span>
                  <button
                    type="button"
                    className={recording ? 'is-live' : 'save'}
                    disabled={!soundSource && !recording}
                    onClick={() => (recording ? void finishRecording() : startRecording())}
                  >
                    {recording ? `Stop · ${recSeconds}s` : 'Record & download'}
                  </button>
                </div>
                <p className="note">
                  {recording
                    ? 'It saves itself at the end, and closing finishes the take rather than losing it.'
                    : soundSource
                      ? 'The dials are riding the sound. The take starts when you press it.'
                      : 'Start the loop or the mic first — a clip is a recording of something moving.'}
                </p>
              </>
            ) : (
              <>
                <div className="row">
                  <label className="visually-hidden" htmlFor="still-type">
                    File type
                  </label>
                  <select
                    id="still-type"
                    value={stillType}
                    onChange={(e) => setStillType(e.target.value as 'png' | 'svg')}
                  >
                    <option value="png">PNG · 2×</option>
                    <option value="svg">SVG</option>
                  </select>
                  <button type="button" className="save" onClick={download} disabled={busy}>
                    {busy ? 'Rendering…' : 'Download'}
                  </button>
                </div>
                <p className="note">
                  {stillType === 'svg'
                    ? 'Letterforms only — a finish is pixels, so it cannot travel in a vector file.'
                    : `${format.w} × ${format.h}, drawn again at 2× so it holds up posted large.`}
                </p>
              </>
            )}
            {note && <p className="note">{note}</p>}
          </div>
        </aside>
      </div>
    </div>
  )
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

