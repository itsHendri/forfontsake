import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  buildPoster,
  buildPosterLayers,
  dissolveFor,
  FORMATS,
  getFormat,
  getGround,
  GROUNDS,
  LAYOUTS,
  liveBox,
  snapLines,
  POSTER_PALETTES,
  type PosterLayout,
  type PosterPalette,
  type WordTransform,
} from '../lib/poster'
import { saveFile } from '../lib/exportFont'
import { Menu } from './Menu'
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
  finishState,
  type FinishState,
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

const IDENTITY: WordTransform = { dx: 0, dy: 0, scale: 1, rotate: 0 }

/**
 * The sheet, stated as its layers — topmost first, the way every layer list
 * in the world reads.
 *
 * `sub` is what the row says about itself without being opened, which is the
 * whole reason the list is worth having: you can see the sheet is on two
 * finishes and a story format without selecting anything.
 */
const LAYERS: {
  id: 'background' | 'type' | 'caption' | 'finishes'
  name: (layout: PosterLayout) => string
  sub: (s: {
    palette: PosterPalette
    finishes: FinishState
    layout: PosterLayout
    wordT: WordTransform
    ground: string
    backdrop: string | null
  }) => string
  /** which colour the row shows a chip of, if any */
  swatch?: 'paper' | 'ink' | 'mark'
}[] = [
  {
    id: 'finishes',
    name: () => 'Finishes',
    sub: ({ finishes }) => {
      const on = FINISHES.filter((f) => finishes[f.id]?.on).map((f) => f.name.toLowerCase())
      return on.length > 0 ? on.join(' · ') : 'none'
    },
  },
  { id: 'caption', name: () => 'Caption', sub: () => 'name · number · chain', swatch: 'mark' },
  {
    id: 'type',
    name: (layout) => layout.name,
    sub: ({ layout, wordT }) =>
      layout.id !== 'word'
        ? 'set to the sheet'
        : wordT.dx === 0 && wordT.dy === 0 && wordT.scale === 1
          ? 'centred'
          : `placed · ${wordT.scale.toFixed(2)}×`,
    swatch: 'ink',
  },
  {
    id: 'background',
    name: () => 'Background',
    sub: ({ ground, backdrop }) =>
      backdrop ? 'your picture' : getGround(ground).name.toLowerCase(),
    swatch: 'paper',
  },
]

/** a ground drawn small, for the picker — the same function that draws the sheet */
function groundArt(id: string, palette: PosterPalette): string {
  return `<svg viewBox="0 0 88 58" width="100%" height="100%" preserveAspectRatio="none">${
    (GROUNDS.find((g) => g.id === id) ?? GROUNDS[0]).draw(88, 58, palette)
  }</svg>`
}

/**
 * One colour, on the layer it belongs to.
 *
 * The platform's own picker rather than a grid of swatches: it is the control
 * people already know, it is reachable from the keyboard, and a sheet is a
 * thing somebody wants an exact colour on. The hex is shown because it is what
 * gets typed into the thing this ends up next to.
 */
function Swatch({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = `swatch-${label.replace(/\W+/g, '-').toLowerCase()}`
  /*
   * One colour a frame, latest wins.
   *
   * Dragging across the picker's spectrum fires an event a pixel, and every
   * one of them repaints the sheet and re-uploads two textures. Nobody can see
   * more than one colour a frame, so the ones in between are work for a
   * picture that is never shown.
   */
  // What the picker is showing. It has to be this component's own state and
  // it has to move on the event: a controlled input whose value prop is a
  // frame behind gets snapped back to the old colour by the render in between,
  // and the swatch fights the hand dragging it.
  const [shown, setShown] = useState(value)
  useEffect(() => {
    setShown(value)
  }, [value])
  const pending = useRef<string | null>(null)
  const frame = useRef<number | null>(null)
  const latest = useRef(onChange)
  latest.current = onChange
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    },
    [],
  )
  const take = (v: string) => {
    pending.current = v
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      const next = pending.current
      pending.current = null
      if (next !== null) latest.current(next)
    })
  }
  return (
    <div className="swatch-row">
      <label htmlFor={id}>{label}</label>
      <span className="swatch-value">{shown.toUpperCase()}</span>
      <input
        id={id}
        type="color"
        className="swatch"
        value={shown}
        onChange={(e) => {
          setShown(e.target.value)
          take(e.target.value)
        }}
      />
    </div>
  )
}

// The geometry rebuilds as fast as the chain can afford — a light chain on a
// short word reaches ~30fps and genuinely morphs; the heavy treatments sit
// nearer 7fps and lean on the cross-fade below to feel continuous.
const TICK_MS = 33
const TICK_MS_HEAVY = 140
const HEAVY = new Set(['growth', 'mosaic'])

// long enough for a loop of the bubble track, short enough to stay postable
const MAX_RECORD_SECONDS = 15

// How close a snap line has to be, in *screen* pixels — converted into sheet
// units where it is used, which is the only way it means the same thing on a
// sheet drawn at 852px and one drawn at 400. Konva's own demo uses five and
// tldraw eight; the middle of that is what this is.
const SNAP_PX = 6

/**
 * How long a resize or a turn may stay a shader uniform before the outlines
 * are rebuilt under it. Long enough that a slider's whole sweep is one
 * rebuild, short enough that letting go feels like the letters sharpening
 * rather than a second thought.
 */
const BAKE_MS = 150

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// Fourteen bars, spaced so the quiet end has resolution — speech sits low and
// a linear ladder would leave a working mic looking like a dead one.
const METER_BARS = Array.from({ length: 14 }, (_, i) => Math.pow((i + 1) / 15, 1.7))

/** a sheet coordinate as a percentage of the sheet, which is how the frame is laid out */
const pct = (v: number, of: number) => `${(v / of) * 100}%`

/** the four corners, and what the pointer says it will do there */
const CORNERS: [number, number, string][] = [
  [0, 0, 'nwse-resize'],
  [1, 0, 'nesw-resize'],
  [0, 1, 'nesw-resize'],
  [1, 1, 'nwse-resize'],
]

/**
 * Compose: the room where a font becomes something you would post.
 *
 * A workbench screenshot is a picture of software. The same letters set on a
 * numbered sheet is a specimen, which is the form a foundry has always
 * published in — and it is the artefact somebody actually wants to post.
 *
 * It was called Share, which named the exit rather than the room: sharing is
 * what you do once the thing exists, and this is where it gets made. What is
 * in here is a sheet stated as its layers — a ground, the type, the caption
 * and whatever finishes are on — with the word as an object you can take hold
 * of. Everything here belongs to the sheet, never to the font: the structural
 * test that keeps finishes off the path to a font file is the same rule
 * written down.
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
  const [busy, setBusy] = useState(false)
  /*
   * Two notes, because they had two causes and one place to appear.
   *
   * A refused microphone used to be reported at the foot of the rail inside
   * Export — the length of the whole room away from the button that asked for
   * it, and under a heading about something else. A message about a thing you
   * just pressed belongs beside the thing you just pressed.
   */
  const [soundNote, setSoundNote] = useState<string | null>(null)
  const [exportNote, setExportNote] = useState<string | null>(null)
  /*
   * Two transforms, and the difference between them is what the GPU is doing.
   *
   * `wordT` is what the reader is doing right now; `bakedT` is what the
   * outlines on the sheet were last built with. A resize or a turn shows as a
   * shader uniform while the hand is down — the whole treatment chain would
   * otherwise re-run on every pointermove, tens of milliseconds each on the
   * heavy chains — and is baked into the geometry when it lets go, which is
   * what makes the letters crisp again and what the export reads.
   */
  const [wordT, setWordT] = useState<WordTransform>(IDENTITY)
  const [bakedT, setBakedT] = useState<WordTransform>(IDENTITY)

  const sheetRef = useRef<HTMLDivElement>(null)
  /*
   * A gesture in flight. `kind` is what the pointer went down on: the word
   * itself, one of the four corners, or the knob under it — so one set of
   * handlers covers moving, resizing and turning rather than three.
   */
  const dragRef = useRef<{
    kind: 'move' | 'scale' | 'rotate'
    startX: number
    startY: number
    base: WordTransform
    /** the word's centre in client px, for the two gestures that turn about it */
    cx: number
    cy: number
    /** distance or angle at pointerdown, so the gesture is relative to it */
    from: number
  } | null>(null)
  /** the word is an object you select, so it has a selected state to be in */
  const [framed, setFramed] = useState(false)
  /** which snap lines are lit, in sheet units, while a move is in flight */
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] })
  // where the move got to, so the release commits the snapped value rather
  // than recomputing it from a pointer that may have left the canvas
  const moveRef = useRef<WordTransform | null>(null)

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
  /*
   * How loud it is, for the meter.
   *
   * The room has never had one, which is most of why the microphone read as
   * dead: a working mic and a refused one looked identical, because the mic is
   * deliberately not monitored — playing it back through the speakers is a
   * feedback loop. Published at about twelve times a second rather than every
   * frame; a meter is read by eye and sixty setStates a second is sixty
   * renders a second.
   */
  const [level, setLevel] = useState(0)
  const levelAt = useRef(0)
  // how long the last sheet took to build, so the tick can back off adaptively
  const buildCost = useRef(0)

  // The finish belongs to the sheet, not to the font: it is pixels over the
  // rendered page and never reaches the outlines, so it lives here with the
  // palette and the layout rather than in the workbench state or the URL.
  // Any combination can be on: they are passes over a page, and a page can be
  // scanned badly, printed in two inks and still be on toothy paper.
  const [finishes, setFinishes] = useState<FinishState>(finishState)

  /*
   * Which layer the rail is editing, or null for the sheet's own settings.
   *
   * The room had one rail showing everything at once, so colour was a button
   * that cycled six palettes — the only shape a control can take when it has
   * nothing to belong to. With the sheet stated as its layers, colour is a
   * property of the one you picked, which is what "recolour" was always
   * reaching for.
   */
  const [selected, setSelected] = useState<'background' | 'type' | 'caption' | 'finishes' | null>(null)
  /** colours set by hand, over whatever the palette roll last landed on */
  const [colours, setColours] = useState<Partial<PosterPalette>>({})
  /** what the sheet is printed on: a drawn texture, or a picture you brought */
  const [groundId, setGroundId] = useState(GROUNDS[0].id)
  const [backdrop, setBackdrop] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

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
    setLevel(0)
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
      const frame = engine.tick(dt)
      const bands = drive.read(frame, dt * soundSpeedRef.current)
      if (now - levelAt.current >= 80) {
        levelAt.current = now
        setLevel(frame.level)
      }
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
    setSoundNote(null)
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
      setSoundNote(e instanceof Error ? e.message : String(e))
    }
  }

  // The roll underneath, and whatever has been set by hand over it. Recolour
  // still moves all four at once, which is the fast way to a different sheet;
  // a swatch moves one, which is the way to the sheet you meant.
  //
  // Memoised, and it has to be: the sheet request below is memoised on this
  // object, so a fresh literal every render would re-run the whole treatment
  // chain on every render rather than when a colour actually moved.
  const palette = useMemo<PosterPalette>(() => {
    const rolled = POSTER_PALETTES[paletteIndex % POSTER_PALETTES.length]
    return { ...rolled, caption: rolled.caption ?? rolled.ink, ...colours }
  }, [paletteIndex, colours])
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
      wordTransform: bakedT,
      ground: groundId,
      backdrop,
    }),
    [p.font, p.fontId, sheetChain, p.overrides, sheetSeed, p.word, layout.id, format.id, palette, number, bakedT, groundId, backdrop],
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
  /*
   * What an export reads.
   *
   * A gesture or the size field can be a shader uniform at the moment Download
   * is pressed — the geometry under it is a beat behind on purpose. An export
   * is not allowed to be: it builds from the live transform, which is the same
   * request when nothing is mid-flight.
   */
  const exactReq = wordT === bakedT ? sheetReq : { ...sheetReq, wordTransform: wordT }
  const composed = () => buildPoster(exactReq)

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
   * The sheet draws when something has changed, and keeps drawing only while
   * something is still changing.
   *
   * It used to be one unconditional sixty-a-second loop for as long as the
   * room was open, which on a still sheet with no finishes and no sound is
   * sixty full-screen passes a second to produce the same pixels. The frames
   * that must keep coming are the fade after a rebuild, a take being recorded,
   * and sound driving the dials — so those three re-arm it and nothing else
   * does.
   */
  const drawReq = useRef<number | null>(null)
  const lastDraw = useRef(performance.now())
  const keepDrawing = useRef(false)
  const requestDraw = useCallback(() => {
    if (drawReq.current !== null) return
    const tick = (now: number) => {
      drawReq.current = null
      // clamped: a tab that was away for a minute must not swallow the fade
      const dt = Math.min(0.1, (now - lastDraw.current) / 1000)
      lastDraw.current = now
      if (fadeRef.current > 0) {
        // a slower drift earns a longer dissolve, as the CSS version did
        fadeRef.current = Math.max(
          0,
          fadeRef.current - dt / (0.35 / Math.max(0.35, soundSpeedRef.current)),
        )
      }
      const view = viewRef.current
      if (view) {
        view.setFade(fadeRef.current)
        view.draw()
      }
      if (fadeRef.current > 0 || keepDrawing.current) drawReq.current = requestAnimationFrame(tick)
    }
    lastDraw.current = performance.now()
    drawReq.current = requestAnimationFrame(tick)
  }, [])

  useEffect(() => {
    keepDrawing.current = recording || soundSource !== null
    if (keepDrawing.current) requestDraw()
  }, [recording, soundSource, requestDraw])

  /*
   * The size field bakes when it stops moving.
   *
   * A gesture knows when it is over — the pointer comes up. A range input does
   * not: React gives it an event a frame and no "done", so the geometry
   * catches up a beat after the last one rather than on every one. Any gesture
   * that ends first bakes it sooner, which is why this only ever moves the
   * bake earlier.
   */
  useEffect(() => {
    if (wordT === bakedT) return
    const t = setTimeout(() => setBakedT(wordT), BAKE_MS)
    return () => clearTimeout(t)
  }, [wordT, bakedT])

  useEffect(
    () => () => {
      if (drawReq.current !== null) cancelAnimationFrame(drawReq.current)
      drawReq.current = null
    },
    [],
  )

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

  // A new sheet, and the fade over the old one that makes it a morph — except
  // where the reader asked for a different picture rather than a moving one.
  const lastPicture = useRef<{ layout: string; format: string } | null>(null)
  /** the transform the textures now on the GPU were drawn with */
  const gpuT = useRef<WordTransform>(IDENTITY)
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const same =
      lastLayers.current?.ground === layers.ground && lastLayers.current?.word === layers.word
    if (same) return
    lastLayers.current = { ground: layers.ground, word: layers.word }
    const picture = { layout: layout.id, format: format.id }
    const fade = dissolveFor(lastPicture.current, picture)
    lastPicture.current = picture
    const built = sheetReq.wordTransform
    void view.setSheet(layers.ground, layers.word).then(() => {
      gpuT.current = built
      fadeRef.current = fade
      requestDraw()
    })
    // sheetReq is what produced these layers; the guard above is on the layers
    // themselves, so a request that changed nothing never gets this far
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers, viewAge, layout.id, format.id])

  /*
   * The word, resampled rather than rebuilt.
   *
   * Whatever the hand has done since the outlines were drawn goes to the
   * shader as a scale and an angle about the word's own centre. When the two
   * agree — which is every moment except a gesture in flight — this is the
   * identity and the sheet is exactly what the geometry says.
   */
  useEffect(() => {
    const view = viewRef.current
    const box = layers.wordBox
    if (!view || !box) return
    const built = gpuT.current
    view.setWordTransform(
      wordT.scale / (built.scale || 1),
      (wordT.rotate ?? 0) - (built.rotate ?? 0),
      box.x + box.w / 2,
      box.y + box.h / 2,
    )
    view.setOffset(wordT.dx, wordT.dy)
    requestDraw()
  }, [wordT, layers.wordBox, viewAge, requestDraw])

  /**
   * A picture you brought, cut down to the sheet before it is kept.
   *
   * The sheet is drawn as an SVG string and rasterised through a data URI, so
   * whatever comes in has to travel inside it — a 6 MB photo would be encoded
   * on every rebuild, which is on the path a dial move takes. Redrawn once at
   * the sheet's own size, it is a couple of hundred kilobytes and nothing
   * downstream has to care where it came from.
   */
  const takeBackdrop = async (file: File) => {
    setExportNote(null)
    try {
      const bitmap = await createImageBitmap(file)
      // cover, so a picture of any shape fills the sheet without distorting
      const k = Math.max(format.w / bitmap.width, format.h / bitmap.height)
      const c = document.createElement('canvas')
      c.width = format.w
      c.height = format.h
      const ctx = c.getContext('2d')
      if (!ctx) throw new Error('could not read that picture')
      const w = bitmap.width * k
      const h = bitmap.height * k
      ctx.drawImage(bitmap, (format.w - w) / 2, (format.h - h) / 2, w, h)
      bitmap.close()
      setBackdrop(c.toDataURL('image/jpeg', 0.86))
    } catch (e) {
      setExportNote(e instanceof Error ? e.message : 'could not read that picture')
    }
  }

  const anyFinish = FINISHES.some((f) => finishes[f.id]?.on)
  useEffect(() => {
    viewRef.current?.setFinishes(finishes)
    requestDraw()
  }, [finishes, requestDraw])

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
      setExportNote(e instanceof Error ? e.message : String(e))
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
    setExportNote(null)
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
      setExportNote(e instanceof Error ? e.message : String(e))
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
    if (anyFinish)
      setExportNote('The SVG carries the letters, not the finish — a finish is pixels.')
  }

  // Drawn again at 2× so the sheet holds up posted anywhere that shows it
  // large. The same pipeline as the screen, one throwaway view wider: two ways
  // of applying a finish would be two finishes.
  const downloadPng = async () => {
    setBusy(true)
    setExportNote(null)
    try {
      const shot = createFinishView(2, format.w, format.h)
      try {
        shot.setFinishes(finishes)
        shot.setOffset(wordT.dx, wordT.dy)
        // built from the live transform, not the sheet on screen: a resize
        // still settling would otherwise go out at the size before it
        const exact = exactReq === sheetReq ? layers : buildPosterLayers(exactReq)
        await shot.setSheet(exact.ground, exact.word)
        shot.draw()
        const blob = await new Promise<Blob>((resolve, reject) =>
          shot.canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('could not draw the sheet'))), 'image/png'),
        )
        await saveFile(blob, `${stem}.png`)
      } finally {
        shot.destroy()
      }
    } catch (e) {
      setExportNote(e instanceof Error ? e.message : String(e))
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
   * The word's rectangle on the sheet, drag included — what the frame draws on.
   *
   * Grown by however far the live size has got ahead of the built one, so the
   * handles stay on the letters through a resize the geometry has not caught
   * up with yet.
   */
  const framedBox = useMemo(() => {
    const box = layers.wordBox
    if (!box) return null
    const grown = liveBox(box, wordT.scale / (bakedT.scale || 1))
    return { x: grown.x + wordT.dx, y: grown.y + wordT.dy, w: grown.w, h: grown.h }
  }, [layers.wordBox, wordT.dx, wordT.dy, wordT.scale, bakedT.scale])

  /** a client point in sheet units */
  const toPoint = (clientX: number, clientY: number) => {
    const el = viewRef.current?.canvas
    if (!el) return null
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) return null
    return { x: ((clientX - r.left) / r.width) * format.w, y: ((clientY - r.top) / r.height) * format.h }
  }

  /**
   * Is the pointer on the word?
   *
   * The sheet is a canvas, so there is no element to hit. `buildPosterLayers`
   * hands back the rectangle the word is drawn in — unrotated, and without its
   * drag, because the drag is the shader's uniform. So the test turns the
   * point back through the word's own angle about its centre and asks whether
   * it is inside the plain rectangle. Growing the box to the bounds of a spun
   * one would claim the empty corners a rotated word leaves behind.
   */
  const onWord = (clientX: number, clientY: number) => {
    if (!framedBox) return false
    const at = toPoint(clientX, clientY)
    if (!at) return false
    const cx = framedBox.x + framedBox.w / 2
    const cy = framedBox.y + framedBox.h / 2
    const a = (-(wordT.rotate ?? 0) * Math.PI) / 180
    const dx = at.x - cx
    const dy = at.y - cy
    const x = cx + dx * Math.cos(a) - dy * Math.sin(a)
    const y = cy + dx * Math.sin(a) + dy * Math.cos(a)
    return (
      x >= framedBox.x && x <= framedBox.x + framedBox.w &&
      y >= framedBox.y && y <= framedBox.y + framedBox.h
    )
  }

  /**
   * Where a move settles: on a snap line when it is close enough, otherwise
   * exactly where it was dropped.
   *
   * The tolerance is in *screen* pixels and converted in, which is the only
   * way it can mean the same thing on a sheet drawn at 852px and one drawn at
   * 400 — eight sheet units is a hair at one size and a shove at the other.
   * The lines are the sheet's own: its centre, the margin the type is set to,
   * and the two rules the head and the foot are drawn on.
   */
  const settle = (dx: number, dy: number) => {
    if (!layers.wordBox) return { dx, dy, lit: { x: [] as number[], y: [] as number[] } }
    const box = layers.wordBox
    const tol = toSheet(SNAP_PX)
    const lines = snapLines(format.id)
    const lit = { x: [] as number[], y: [] as number[] }

    // the word's own edges and centre are what may land on a line
    const near = (candidates: number[], edges: number[], lines: number[]) => {
      let best: { delta: number; line: number } | null = null
      for (const [i, edge] of edges.entries()) {
        for (const line of lines) {
          const delta = line - (edge + candidates[i])
          if (Math.abs(delta) <= tol && (!best || Math.abs(delta) < Math.abs(best.delta))) {
            best = { delta, line }
          }
        }
      }
      return best
    }

    const xEdges = [box.x, box.x + box.w / 2, box.x + box.w]
    const yEdges = [box.y, box.y + box.h / 2, box.y + box.h]
    const hx = near([dx, dx, dx], xEdges, lines.x)
    const hy = near([dy, dy, dy], yEdges, lines.y)
    if (hx) lit.x.push(hx.line)
    if (hy) lit.y.push(hy.line)
    return { dx: dx + (hx?.delta ?? 0), dy: dy + (hy?.delta ?? 0), lit }
  }

  /**
   * One set of handlers for moving, resizing and turning.
   *
   * Moving is the cheap one and stays a uniform: a rebuild per pointermove
   * would re-run the whole treatment chain, tens of milliseconds on the heavy
   * ones, where changing an offset is free. Scale and rotation are baked into
   * the geometry, so they rebuild — which is what the size slider always did.
   */
  const startGesture = (
    kind: 'move' | 'scale' | 'rotate',
    e: React.PointerEvent<Element>,
  ) => {
    if (layout.id !== 'word' || !framedBox) return
    e.preventDefault()
    e.stopPropagation()
    const el = viewRef.current?.canvas
    const r = el?.getBoundingClientRect()
    if (!r) return
    const cx = r.left + ((framedBox.x + framedBox.w / 2) / format.w) * r.width
    const cy = r.top + ((framedBox.y + framedBox.h / 2) / format.h) * r.height
    const from =
      kind === 'rotate'
        ? Math.atan2(e.clientY - cy, e.clientX - cx)
        : Math.hypot(e.clientX - cx, e.clientY - cy)
    dragRef.current = { kind, startX: e.clientX, startY: e.clientY, base: wordT, cx, cy, from }
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    setFramed(true)
  }

  const onStagePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (layout.id !== 'word' || !onWord(e.clientX, e.clientY)) {
      // a click on the ground puts the word down
      setFramed(false)
      return
    }
    setSelected('type')
    startGesture('move', e)
  }

  /** what a gesture makes of the pointer where it is now */
  const gestureAt = (clientX: number, clientY: number): WordTransform | null => {
    const drag = dragRef.current
    if (!drag) return null
    if (drag.kind === 'move') {
      const { dx, dy } = settle(
        drag.base.dx + toSheet(clientX - drag.startX),
        drag.base.dy + toSheet(clientY - drag.startY),
      )
      return { ...drag.base, dx, dy }
    }
    if (drag.kind === 'scale') {
      // distance from the centre, which is what keeps a corner drag
      // proportional without needing to know which corner it was
      const now = Math.hypot(clientX - drag.cx, clientY - drag.cy)
      const k = drag.from > 0 ? now / drag.from : 1
      return { ...drag.base, scale: clamp(drag.base.scale * k, 0.25, 2) }
    }
    const now = Math.atan2(clientY - drag.cy, clientX - drag.cx)
    const deg = ((drag.base.rotate ?? 0) + ((now - drag.from) * 180) / Math.PI + 360) % 360
    return { ...drag.base, rotate: deg }
  }

  const onStagePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const next = gestureAt(e.clientX, e.clientY)
    if (!next) return
    if (drag.kind === 'move') {
      // free: the offset is a uniform, so nothing is rebuilt until release
      viewRef.current?.setOffset(next.dx, next.dy)
      requestDraw()
      setGuides(settle(drag.base.dx + toSheet(e.clientX - drag.startX), drag.base.dy + toSheet(e.clientY - drag.startY)).lit)
      moveRef.current = next
    } else {
      // Shift holds a turn to fifteen degrees, the step every tool uses
      const snapped =
        drag.kind === 'rotate' && e.shiftKey
          ? { ...next, rotate: Math.round((next.rotate ?? 0) / 15) * 15 }
          : next
      // free while the hand is down: the sheet is resampled on the GPU and the
      // outlines are rebuilt once, on release
      setWordT(snapped)
    }
  }

  const onStagePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    setGuides({ x: [], y: [] })
    if (drag.kind === 'move') {
      const next = moveRef.current ?? gestureAt(e.clientX, e.clientY)
      moveRef.current = null
      if (next) {
        setWordT(next)
        setBakedT(next)
      }
      return
    }
    // the letters go back to being outlines rather than a resampled picture
    setBakedT(wordT)
  }

  const moved = wordT.dx !== 0 || wordT.dy !== 0 || wordT.scale !== 1 || (wordT.rotate ?? 0) !== 0
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

  const download = (type: 'png' | 'svg') => (type === 'svg' ? void downloadSvg() : void downloadPng())

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
        {/*
          The way out with the artefact, in the bar rather than at the foot of
          a rail you have to reach the bottom of. One type and one button: a
          second row of verbs beside a download is furniture, and the type
          already says what they said. What each type gives you rides the
          button as a tooltip, the way the workbench's download does.
        */}
        <div className="sheet-export">
          {inVideo ? (
            <>
              <span className="pill">MP4 · up to {MAX_RECORD_SECONDS}s</span>
              <span className="with-tip">
                <button
                  type="button"
                  className={recording ? 'is-live' : 'save'}
                  disabled={!soundSource && !recording}
                  onClick={() => (recording ? void finishRecording() : startRecording())}
                >
                  {recording ? `Stop · ${recSeconds}s` : 'Record & download'}
                </button>
                <span className="tip" role="tooltip">
                  {recording
                    ? 'It saves itself at the end, and closing finishes the take rather than losing it.'
                    : soundSource
                      ? 'The dials are riding the sound. The take starts when you press it.'
                      : 'Start the loop or the mic first — a clip is a recording of something moving.'}
                </span>
              </span>
            </>
          ) : (
            <Menu
              label="Download"
              busyLabel={busy ? 'Rendering…' : null}
              disabled={busy}
              items={[
                {
                  id: 'png',
                  label: 'PNG · 2×',
                  note: `${format.w} × ${format.h}, drawn again at 2× so it holds up posted large.`,
                },
                {
                  id: 'svg',
                  label: 'SVG',
                  note: 'Letterforms only — a finish is pixels, so it cannot travel in a vector file.',
                },
              ]}
              onPick={(id) => download(id as 'png' | 'svg')}
            />
          )}
        </div>

        {/* closing finishes a take rather than losing it — see handleClose */}
        <button type="button" className="sheet-close" onClick={handleClose} aria-label="Leave Compose">
          ✕
        </button>

        {/* whatever went wrong on the way out, under the control it went wrong
            for — the bar wraps it onto its own line rather than growing */}
        {exportNote && (
          <p className="sheet-problem" role="alert">
            {exportNote}
          </p>
        )}
      </header>

      <div className="sheet-body">
        <div
          className={inVideo && soundSource ? 'sheet-stage has-transport' : 'sheet-stage'}
          ref={sheetRef}
          onPointerDown={onStagePointerDown}
          onPointerMove={onStagePointerMove}
          onPointerUp={onStagePointerUp}
        >
          {recording && (
            <p className="rec-pill" role="status">
              <span className="rec-dot" aria-hidden="true" />
              Recording · 0:{String(recSeconds).padStart(2, '0')}
            </p>
          )}
          <div className="sheet-holder">
            <div
              className="sheet-live"
              /* a new size needs a new canvas, so the holder is keyed on it */
              key={format.id}
              ref={mount}
              role="img"
              aria-label={`Specimen sheet number ${number}`}
            />
            {/*
              The word, as a thing you can take hold of.

              Drawn as a DOM overlay in percentages of the sheet rather than in
              pixels, so it stays on the word at whatever size the sheet is
              being shown at, with no measuring and nothing to keep in step
              when the window moves. It is `pointer-events: none` except on the
              handles, so the drag underneath still reaches the stage.
            */}
            {layout.id === 'word' && framedBox && (
              <div className="word-frame" aria-hidden="true">
                {guides.x.map((x) => (
                  <span className="guide is-v" key={`x${x}`} style={{ left: pct(x, format.w) }} />
                ))}
                {guides.y.map((y) => (
                  <span className="guide is-h" key={`y${y}`} style={{ top: pct(y, format.h) }} />
                ))}
                {(framed || dragRef.current) && (
                  <div
                    className="word-box"
                    style={{
                      left: pct(framedBox.x, format.w),
                      top: pct(framedBox.y, format.h),
                      width: pct(framedBox.w, format.w),
                      height: pct(framedBox.h, format.h),
                      transform: `rotate(${wordT.rotate ?? 0}deg)`,
                    }}
                  >
                    {CORNERS.map(([cx, cy, cursor]) => (
                      <span
                        key={`${cx}${cy}`}
                        className="word-handle"
                        style={{ left: `${cx * 100}%`, top: `${cy * 100}%`, cursor }}
                        onPointerDown={(e) => startGesture('scale', e)}
                      />
                    ))}
                    {/* the turn, on a stalk under the box — unmissable, which
                        is the whole argument for it over an invisible hit area */}
                    <span className="word-stalk" />
                    <span
                      className="word-spin"
                      title="Drag to turn · hold Shift for 15°"
                      onPointerDown={(e) => startGesture('rotate', e)}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
          {/*
            The first gesture, on the sheet.

            Not decoration: a browser will not let an AudioContext out of
            suspended until something resumes it inside a user gesture, so a
            play control is what makes sound possible at all. It sits on the
            artefact because that is where somebody in video mode is looking,
            and it gives way to the strip the moment anything is running —
            every audio-reactive tool in the research pass does exactly this.
          */}
          {inVideo && !soundSource && (
            <button
              type="button"
              className="sheet-play"
              onClick={() => void startSound('loop')}
              title="Play the loop and let the letters ride it"
            >
              <span className="sheet-play-glyph" aria-hidden="true" />
              Play
            </button>
          )}

          {inVideo && soundSource && (
            <div className="transport">
              <button type="button" className="is-live" onClick={stopSound}>
                Stop
              </button>
              <button
                type="button"
                onClick={() => startSound(soundSource === 'mic' ? 'loop' : 'mic')}
                title={soundSource === 'mic' ? 'Back to the bubble loop' : 'Let the room drive it'}
              >
                {soundSource === 'mic' ? 'Play loop' : 'Use mic'}
              </button>
              {/* proof that sound is arriving, which the room has never had */}
              <span className="meter" role="img" aria-label={`Level ${Math.round(level * 100)} per cent`}>
                {METER_BARS.map((b, i) => (
                  <span key={i} className={level > b ? 'meter-bar is-lit' : 'meter-bar'} />
                ))}
              </span>
              <span className="transport-mode">{getMode(soundModeId).name}</span>
            </div>
          )}

          {glError && <p className="notice is-bad">{glError}</p>}
        </div>

        <aside className="sheet-rail">
          {/*
            The sheet, said as its layers.

            Everything used to be on the rail at once, which is why colour was
            a button that cycled six palettes: with nothing to belong to, that
            is the only shape the control could take. Naming the layers gives
            every property an owner — and it is the same list the workbench
            keeps, on purpose, so the two rooms are read the same way.
          */}
          <div className="group">
            <h2>Layers</h2>
            <div className="layer-list">
              {LAYERS.map((l) => {
                const on = selected === l.id
                return (
                  <button
                    type="button"
                    key={l.id}
                    className={on ? 'layer-row is-on' : 'layer-row'}
                    aria-pressed={on}
                    onClick={() => setSelected(on ? null : l.id)}
                  >
                    <span className="layer-row-text">
                      <span className="layer-row-name">{l.name(layout)}</span>
                      <span className="layer-row-sub">
                        {l.sub({ palette, finishes, layout, wordT, ground: groundId, backdrop })}
                      </span>
                    </span>
                    {l.swatch && (
                      <span className="layer-row-swatch" style={{ background: palette[l.swatch] }} aria-hidden="true" />
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Nothing selected shows what the sheet itself is: how it is laid
              out, and the two rolls that move everything at once. */}
          {selected === null && (
            <div className="group ruled">
              <h2>Sheet</h2>
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
              <div className="row">
                <button type="button" onClick={() => setSheetSeed(Math.floor(Math.random() * 9999) + 1)}>
                  Randomise
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPaletteIndex((i) => i + 1)
                    // a roll is a whole sheet, so it clears what was set by hand
                    setColours({})
                  }}
                >
                  Recolour
                </button>
              </div>
            </div>
          )}

          {selected === 'background' && (
            <div className="group ruled">
              <h2>Background</h2>
              <Swatch label="Colour" value={palette.paper} onChange={(v) => setColours((c) => ({ ...c, paper: v }))} />
              {/*
                Textures are drawn, not shipped — a gradient and a dot screen
                are a few tags each, and an asset would be a download every
                visitor pays for whether or not they open this room. They take
                their colours from the palette, so recolouring the ground
                recolours the texture with it.
              */}
              <div className="grounds">
                {GROUNDS.map((g) => {
                  const on = !backdrop && g.id === groundId
                  return (
                    <button
                      type="button"
                      key={g.id}
                      className={on ? 'ground is-on' : 'ground'}
                      aria-pressed={on}
                      onClick={() => {
                        setGroundId(g.id)
                        setBackdrop(null)
                      }}
                    >
                      <span
                        className="ground-art"
                        aria-hidden="true"
                        dangerouslySetInnerHTML={{ __html: groundArt(g.id, palette) }}
                      />
                      <span>{g.name}</span>
                    </button>
                  )
                })}
                {/* Upload sits in the row rather than beside it: it is one more
                    answer to "what is this printed on", not a separate feature. */}
                <button
                  type="button"
                  className={backdrop ? 'ground is-on' : 'ground'}
                  aria-pressed={!!backdrop}
                  onClick={() => fileRef.current?.click()}
                >
                  <span className="ground-art is-upload" aria-hidden="true">
                    {backdrop ? <img src={backdrop} alt="" /> : '+'}
                  </span>
                  <span>{backdrop ? 'Yours' : 'Upload'}</span>
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  hidden
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    // cleared so choosing the same file twice still fires
                    e.target.value = ''
                    if (file) void takeBackdrop(file)
                  }}
                />
              </div>
              {backdrop && (
                <div className="row">
                  <button type="button" className="linkish" onClick={() => setBackdrop(null)}>
                    Remove the picture
                  </button>
                </div>
              )}
            </div>
          )}

          {selected === 'type' && (
            <div className="group ruled">
              <h2>{layout.name}</h2>
              <Swatch label="Ink" value={palette.ink} onChange={(v) => setColours((c) => ({ ...c, ink: v }))} />
              {layout.id === 'word' ? (
                <div className="ctl word-place">
                  <div className="ctl-head">
                    <label htmlFor="word-size">Size</label>
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
                  <div className="ctl">
                    <div className="ctl-head">
                      <label htmlFor="word-spin">Turn</label>
                      <output
                        htmlFor="word-spin"
                        className={(wordT.rotate ?? 0) === 0 ? 'is-default' : undefined}
                      >
                        {Math.round(wordT.rotate ?? 0)}°
                      </output>
                    </div>
                    <input
                      id="word-spin"
                      type="range"
                      min={0}
                      max={359}
                      step={1}
                      value={Math.round(wordT.rotate ?? 0)}
                      onChange={(e) => setWordT((t) => ({ ...t, rotate: Number(e.target.value) }))}
                      onDoubleClick={() => setWordT((t) => ({ ...t, rotate: 0 }))}
                    />
                  </div>
                  <p className="note">
                    Click the word to take hold of it: drag to move, a corner to resize, the knob
                    to turn. Hold Shift while turning for fifteen degrees at a time.
                    {moved && ' · '}
                    {moved && (
                      <button type="button" className="linkish" onClick={() => setWordT(IDENTITY)}>
                        Put it back
                      </button>
                    )}
                  </p>
                </div>
              ) : (
                <p className="note">
                  The character set is set to the sheet, so there is nothing to place. Switch to the
                  word to move and resize it.
                </p>
              )}
            </div>
          )}

          {selected === 'caption' && (
            <div className="group ruled">
              <h2>Caption</h2>
              <Swatch
                label="Rules and labels"
                value={palette.caption ?? palette.ink}
                onChange={(v) => setColours((c) => ({ ...c, caption: v }))}
              />
              <Swatch label="Accent" value={palette.mark} onChange={(v) => setColours((c) => ({ ...c, mark: v }))} />
              <p className="note">
                What the sheet says about itself: the two rules, the name, the number, the chain and
                the address. It travels with the sheet — it is not in the font.
              </p>
            </div>
          )}

          {/*
            Every finish on the page, dimmed rather than absent when it is off,
            so you can see what you are not using and what turning it on would
            cost. Order is fixed and stated, because it is a fact about what
            they do: the two that resample the sheet run while there is still a
            sheet to read, and grain goes over whatever came out.
          */}
          {selected === 'finishes' && (
            <div className="group ruled">
              <h2>Finishes</h2>
              <p className="note">Applied top to bottom.</p>
              {FINISHES.map((f) => {
                const held = finishes[f.id]
                const on = !!held?.on
                return (
                  <div className={on ? 'finish' : 'finish is-off'} key={f.id}>
                    <div className="finish-head">
                      <span className="finish-name">{f.name}</span>
                      <input
                        type="checkbox"
                        role="switch"
                        className="ctl-switch"
                        checked={on}
                        aria-label={f.name}
                        onChange={(e) =>
                          setFinishes((v) => ({ ...v, [f.id]: { ...v[f.id], on: e.target.checked } }))
                        }
                      />
                    </div>
                    <p className="note">{f.blurb}</p>
                    {f.params.map((spec) => (
                      <div className="ctl" key={spec.key}>
                        <div className="ctl-head">
                          <label htmlFor={`finish-${f.id}-${spec.key}`}>{spec.label}</label>
                          <output
                            htmlFor={`finish-${f.id}-${spec.key}`}
                            className={(held?.params[spec.key] ?? spec.default) === spec.default ? 'is-default' : undefined}
                          >
                            {held?.params[spec.key] ?? spec.default}
                          </output>
                        </div>
                        <input
                          id={`finish-${f.id}-${spec.key}`}
                          type="range"
                          min={spec.min}
                          max={spec.max}
                          step={spec.step}
                          disabled={!on}
                          value={held?.params[spec.key] ?? spec.default}
                          onChange={(e) =>
                            setFinishes((v) => ({
                              ...v,
                              [f.id]: { ...v[f.id], params: { ...v[f.id].params, [spec.key]: Number(e.target.value) } },
                            }))
                          }
                          onDoubleClick={() =>
                            setFinishes((v) => ({
                              ...v,
                              [f.id]: { ...v[f.id], params: { ...v[f.id].params, [spec.key]: spec.default } },
                            }))
                          }
                        />
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          )}

          {/*
            Sound exists only in video. Not greyed, not collapsed — absent — so
            "does picking MP4 turn the sound on?" is a question that cannot come
            up: it is sound that makes a moving export possible, never the other
            way round.
          */}
          {inVideo && (
            <div className="group ruled sound">
              <h2>Sound</h2>
              {/* Play and the mic live under the sheet, where you are looking.
                  What is left here is what the sound does once it is running. */}
              {!soundSource && (
                <p className="note">Press play on the sheet, or switch to the mic once it is running.</p>
              )}
              {/* a refused microphone is reported beside the button that asked
                  for it, not at the far end of the rail under Export */}
              {soundNote && (
                <p className="note is-bad" role="alert">
                  {soundNote}
                </p>
              )}
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

        </aside>
      </div>
    </div>
  )
}


