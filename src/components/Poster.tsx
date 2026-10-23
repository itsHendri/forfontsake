import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  buildPoster,
  buildPosterLayers,
  dissolveFor,
  FORMATS,
  getFormat,
  GROUNDS,
  LAYOUTS,
  getLayout,
  liveBox,
  pictureBoxOf,
  snapAngle,
  snapLines,
  POSTER_PALETTES,
  type PosterPalette,
  type WordTransform,
} from '../lib/poster'
import { saveFile } from '../lib/exportFont'
import { buildCaption, captionFile, type Caption } from '../lib/caption'
import { copyText } from '../lib/clipboard'
import { loadLook, saveLook, type TemplateCopy } from '../lib/composeLook'
import { copyFor, copySets } from '../lib/copyBank'
import { getTemplate } from '../lib/templates'
import { TemplateGallery } from './TemplateGallery'
import { Menu } from './Menu'
import { ComposeLayers } from './ComposeLayers'
import { EffectStack, FinishPanel, FinishesPanel, Section, Seg, Swatch } from './ComposePanels'
import { finishOf, layerRows, type Selection } from '../lib/composeLayers'
import { getTreatment } from '../engine/treatments/registry'
import { DEFAULT_DEPTH, MODES, bindingsFor, getMode, modulate } from '../lib/modulate'
import {
  DEFAULT_SPEED,
  LENGTHS,
  MAX_SPEED,
  MIN_SPEED,
  FPS,
  motionAt,
} from '../lib/motion'
import { startSheetRecorder, type SheetRecorder } from '../lib/videoRecorder'
import { canRenderClips, renderClip } from '../lib/clipRender'
import {
  FINISHES,
  PICTURE_EFFECTS,
  createFinishView,
  type FinishState,
  type FinishView,
} from '../lib/finish'
import type { FontData } from '../lib/glyphData'
import type { Overrides, Step, WorkbenchState } from '../lib/urlState'

interface Props {
  font: FontData
  fontId: string
  chain: Step[]
  overrides?: Overrides
  seed: number
  word: string
  /** the whole specimen line, for the Sentence sheet; one word falls back to a pangram */
  sentence: string
  /** the whole workbench state, so a post's caption can link back to this exact font */
  state: WorkbenchState
  onClose: () => void
}

const IDENTITY: WordTransform = { dx: 0, dy: 0, scale: 1, rotate: 0 }

/** a ground drawn small, for the picker — the same function that draws the sheet */
function groundArt(id: string, palette: PosterPalette): string {
  /*
   * Drawn at a slice of the sheet's own scale rather than at the chip's size.
   *
   * The textures are patterns in user space, so drawing one into an 88×58 box
   * put an eighteen-unit tile across a third of the chip: the picker showed a
   * coarser texture than the sheet does, which is a picture of a different
   * ground. A viewBox at sheet proportions shows the same tile at the same
   * relative size, which is what a swatch is for.
   */
  return `<svg viewBox="0 0 360 240" width="100%" height="100%" preserveAspectRatio="none">${
    (GROUNDS.find((g) => g.id === id) ?? GROUNDS[0]).draw(360, 240, palette)
  }</svg>`
}

// The geometry rebuilds as fast as the chain can afford — a light chain on a
// short word reaches ~30fps and genuinely morphs; the heavy treatments sit
// nearer 7fps and lean on the cross-fade below to feel continuous.
const TICK_MS = 33
const TICK_MS_HEAVY = 140
const HEAVY = new Set(['growth', 'mosaic'])

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
 * in here is a sheet stated as its layers — a ground, the type and whatever
 * finishes are on — with the word as an object you can take hold
 * of. Everything here belongs to the sheet, never to the font: the structural
 * test that keeps finishes off the path to a font file is the same rule
 * written down.
 */
export function Poster(p: Props) {
  // the look you left the room with last time, read once on the way in
  const [look] = useState(loadLook)
  const [sheetSeed, setSheetSeed] = useState(p.seed)
  const [paletteIndex, setPaletteIndex] = useState(look.paletteIndex)
  const [layoutId, setLayoutId] = useState(look.layoutId)
  /*
   * What each template says: where Shuffle has got to in the bank, and any
   * lines typed over it. Per template, so writing a cover does not cost you
   * the list you wrote last week.
   */
  const [copy, setCopy] = useState<Record<string, TemplateCopy>>(look.copy)
  /** the gallery of every sheet and template, over the stage */
  const [gallery, setGallery] = useState(false)
  /*
   * Whether the sheet moves.
   *
   * It was a mode — Static or Video in the bar, the whole room hanging off it,
   * and a second rail of settings appearing on the way in. But a still is
   * just a sheet whose motion is off: Hendri's point, and Figma's, where
   * motion is a property of the frame rather than a room you go to. So it is
   * a setting of the sheet, Still by default, and turning it on is what makes
   * the export a clip.
   */
  const [motionOn, setMotionOn] = useState(look.motionOn)
  // The sheet's size is a property of the sheet, not of the export. Every tool
  // in this category splits them that way; the download stays type and scale.
  const [formatId, setFormatId] = useState(look.formatId)
  const [motionModeId, setMotionModeId] = useState(look.motionModeId)
  const [busy, setBusy] = useState(false)
  /** the type the Export section is set to; the bar's Download asks each time */
  const [exportPick, setExportPick] = useState('png')
  // a message about the export belongs beside the export, in the bar
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
  /** whether the pointer is over the word, which is the one thing on the sheet you can take hold of */
  const [hover, setHover] = useState<'word' | null>(null)
  /** which snap lines are lit, in sheet units, while a move is in flight */
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] })
  // where the move got to, so the release commits the snapped value rather
  // than recomputing it from a pointer that may have left the canvas
  const moveRef = useRef<WordTransform | null>(null)

  /*
   * Motion. It plays whenever it is on and nobody has paused it; `clock` is
   * where in the loop it is, kept across a pause so the sheet resumes from the
   * frame it stopped on rather than jumping.
   */
  const [playing, setPlaying] = useState(look.motionOn)
  const clock = useRef(0)
  const [modChain, setModChain] = useState<Step[] | null>(null)
  // how fast the letters move: a multiplier on how many times each curve goes
  // round in the clip, rounded to whole turns so the loop always closes
  const [speed, setSpeed] = useState(look.speed)
  const speedRef = useRef(speed)
  // how long the clip is, and so how long one loop of the motion is
  const [length, setLength] = useState<number>(look.length)
  const lengthRef = useRef(length)
  // How far a driven dial swings, as a share of its span. Tuned by ear at 0.35
  // and kept as the default; adjustable because a heavy treatment on a short
  // word wants less travel than a light one on a long word.
  const [depth, setDepth] = useState(look.depth)
  const depthRef = useRef(depth)
  const motionModeRef = useRef(motionModeId)
  useEffect(() => {
    speedRef.current = speed
  }, [speed])
  useEffect(() => {
    lengthRef.current = length
  }, [length])
  useEffect(() => {
    depthRef.current = depth
  }, [depth])
  useEffect(() => {
    motionModeRef.current = motionModeId
  }, [motionModeId])
  const rafRef = useRef<number | null>(null)
  // how long the last sheet took to build, so the tick can back off adaptively
  const buildCost = useRef(0)

  // The finish belongs to the sheet, not to the font: it is pixels over the
  // rendered page and never reaches the outlines, so it lives here with the
  // palette and the layout rather than in the workbench state or the URL.
  // Any combination can be on: they are passes over a page, and a page can be
  // scanned badly, printed in two inks and still be on toothy paper.
  const [finishes, setFinishes] = useState<FinishState>(look.finishes)
  /*
   * What is being done to a picture you brought, as opposed to the sheet.
   *
   * Its own state rather than more finishes, because the scope is the point:
   * these reprint the *ground* and the word is laid over the result, so the
   * type stays letterforms on a screened photograph rather than being screened
   * with it. Kept while a picture is swapped out and back, so changing your
   * mind about the photograph does not cost you the treatment of it.
   */
  const [pictureFx, setPictureFx] = useState<FinishState>(look.pictureFx)

  /*
   * What is selected, which is what the right panel edits — the sheet when
   * nothing else is, the way Figma shows the frame.
   *
   * The room had one rail showing everything at once, so colour was a button
   * that cycled six palettes — the only shape a control can take when it has
   * nothing to belong to. With the sheet stated as its layers, every setting
   * has an owner, and selecting the owner is how you reach it.
   */
  const [selected, setSelected] = useState<Selection>('sheet')
  /** which finish is open in the Finishes list */
  const [openFinish, setOpenFinish] = useState<string | null>(null)
  /** colours set by hand, over whatever the palette roll last landed on */
  const [colours, setColours] = useState<Partial<PosterPalette>>(look.colours)
  /** what the sheet is printed on: a drawn texture, or a picture you brought */
  const [groundId, setGroundId] = useState(look.groundId)
  const [backdrop, setBackdrop] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // and kept as it changes, so next week's sheet opens looking like this one
  useEffect(() => {
    saveLook({
      paletteIndex,
      colours,
      groundId,
      finishes,
      pictureFx,
      formatId,
      motionOn,
      motionModeId,
      depth,
      speed,
      length,
      layoutId,
      copy,
    })
  }, [paletteIndex, colours, groundId, finishes, pictureFx, formatId, motionOn, motionModeId, depth, speed, length, layoutId, copy])

  // Closing must never discard work: a take in flight is finished and saved
  // on the way out.
  const closeRef = useRef<() => void>(p.onClose)
  /*
   * Escape backs out of one thing at a time.
   *
   * It used to leave the room whatever you were doing, so the reflex for
   * "close this panel" threw away the sheet instead. A layer selected is a
   * thing to back out of, and once there is nothing selected the next press
   * leaves.
   */
  const selectedRef = useRef<Selection>('sheet')
  const deselectRef = useRef<() => void>(() => {})
  const galleryRef = useRef(false)
  useEffect(() => {
    galleryRef.current = gallery
  }, [gallery])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // the gallery is over everything else, so it is the first thing out
      if (galleryRef.current) {
        setGallery(false)
        return
      }
      if (selectedRef.current !== 'sheet') {
        deselectRef.current()
        return
      }
      closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Recording. The recorder lives in refs and the finisher in a ref too, so
  // the countdown and the close can save a take without stale closures.
  const [recording, setRecording] = useState(false)
  const [recSeconds, setRecSeconds] = useState(0)
  const recorderRef = useRef<SheetRecorder | null>(null)
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const recStemRef = useRef('sheet')
  const finishRecordingRef = useRef<(() => Promise<void>) | null>(null)

  /*
   * Rendering. Whether this browser can encode a clip frame by frame is asked
   * once, on the way into video; until it has answered the button assumes it
   * can, and where it cannot the live recorder takes over the same button.
   */
  const [canRender, setCanRender] = useState<boolean | null>(null)
  const [progress, setProgress] = useState<{ label: string; done: number; total: number; eta: number | null } | null>(
    null,
  )
  const abortRef = useRef<AbortController | null>(null)
  useEffect(() => () => abortRef.current?.abort(), [])
  /**
   * The last kit made, kept so its caption can be copied and its files shared
   * after the zip has gone — posting is several apps away from this room, and
   * the caption is the thing you need again once you get there.
   */
  const [kit, setKit] = useState<{ files: File[]; caption: Caption } | null>(null)
  const [copied, setCopied] = useState(false)

  // the room closing abandons any take
  useEffect(
    () => () => {
      recorderRef.current?.cancel()
      recorderRef.current = null
      if (recTimerRef.current) clearInterval(recTimerRef.current)
    },
    [],
  )

  /*
   * The motion, live.
   *
   * The clock runs every frame, but the geometry is rebuilt only as fast as
   * the chain can afford, and the shader's cross-fade covers the gaps. The
   * renderer does not need either trick: it draws every frame of the clip at
   * its own exact time, however long that takes.
   */
  useEffect(() => {
    if (!motionOn || !playing) return
    const tier = p.chain.some((s) => HEAVY.has(s.id)) ? TICK_MS_HEAVY : TICK_MS
    let last = performance.now()
    let lastBuild = 0
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      clock.current = (clock.current + dt) % lengthRef.current
      if (now - lastBuild >= Math.max(tier, buildCost.current * 1.5)) {
        lastBuild = now
        const drive = motionAt(clock.current, lengthRef.current, speedRef.current)
        setModChain(
          modulate(p.chain, drive, bindingsFor(getMode(motionModeRef.current), p.chain), depthRef.current),
        )
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [motionOn, playing, p.chain])

  // The roll underneath, and whatever has been set by hand over it. Recolour
  // still moves all four at once, which is the fast way to a different sheet;
  // a swatch moves one, which is the way to the sheet you meant.
  //
  // Memoised, and it has to be: the sheet request below is memoised on this
  // object, so a fresh literal every render would re-run the whole treatment
  // chain on every render rather than when a colour actually moved.
  const palette = useMemo<PosterPalette>(() => {
    const rolled = POSTER_PALETTES[paletteIndex % POSTER_PALETTES.length]
    return { ...rolled, ...colours }
  }, [paletteIndex, colours])
  const layout = getLayout(layoutId)
  const template = getTemplate(layout.id)

  /** the lines a template sets: what you typed, or the bank at its shuffle position */
  const copyOf = useCallback(
    (id: string): string[] | undefined => {
      if (copySets(id) === 0) return undefined
      const held = copy[id]
      return held?.own ?? copyFor(id, held?.pick ?? 0)
    },
    [copy],
  )
  const lines = copyOf(layout.id)
  // memoised on the text, so the sheet is not rebuilt for a new array of the same lines
  const linesKey = JSON.stringify(lines ?? null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sheetCopy = useMemo(() => lines, [linesKey])
  /** the next set in the bank for one template, dropping what was typed over it */
  const shuffle = (id: string) =>
    setCopy((c) => ({ ...c, [id]: { pick: (c[id]?.pick ?? 0) + 1 } }))
  /** every template moves on one set, except those you have written yourself */
  const shuffleAll = () =>
    setCopy((c) => {
      const next = { ...c }
      for (const l of LAYOUTS) {
        if (copySets(l.id) === 0 || next[l.id]?.own) continue
        next[l.id] = { pick: (next[l.id]?.pick ?? 0) + 1 }
      }
      return next
    })
  const format = getFormat(formatId)


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

  const sheetChain = motionOn && modChain ? modChain : p.chain

  const sheetReq = useMemo(
    () => ({
      font: p.font,
      fontId: p.fontId,
      chain: sheetChain,
      overrides: p.overrides,
      seed: sheetSeed,
      word: p.word,
      sentence: p.sentence,
      layout: layout.id,
      format: format.id,
      palette,
      wordTransform: bakedT,
      ground: groundId,
      backdrop,
      copy: sheetCopy,
    }),
    [
      p.font,
      p.fontId,
      sheetChain,
      p.overrides,
      sheetSeed,
      p.word,
      p.sentence,
      layout.id,
      format.id,
      palette,
      bakedT,
      groundId,
      backdrop,
      sheetCopy,
    ],
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

  const stem = `forfontsake-${p.chain.map((c) => c.id).join('-')}-${layout.id}-${sheetSeed}`

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
   * and the motion playing — so those three re-arm it and nothing else does.
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
        fadeRef.current = Math.max(0, fadeRef.current - dt / 0.35)
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
    keepDrawing.current = recording || playing
    if (keepDrawing.current) requestDraw()
  }, [recording, playing, requestDraw])

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
    if (!view) return
    if (!box) {
      // a word layer with no word on it — a picture template's type — is
      // never moved, so whatever the last word was dragged to must not carry
      view.setWordTransform(1, 0, 0, 0)
      view.setOffset(0, 0)
      requestDraw()
      return
    }
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
   * the size the sheets need, it is a few hundred kilobytes and nothing
   * downstream has to care where it came from.
   */
  const takeBackdrop = async (file: File) => {
    setExportNote(null)
    try {
      const bitmap = await createImageBitmap(file)
      // Kept at its own shape, just big enough to cover every format: the
      // sheet crops it to whichever one it is cut to, so changing the format —
      // or the kit cutting it four ways — never stretches a picture that was
      // only ever drawn for one of them.
      const k = Math.max(...FORMATS.map((f) => Math.max(f.w / bitmap.width, f.h / bitmap.height)))
      const c = document.createElement('canvas')
      c.width = Math.round(bitmap.width * k)
      c.height = Math.round(bitmap.height * k)
      const ctx = c.getContext('2d')
      if (!ctx) throw new Error('could not read that picture')
      ctx.drawImage(bitmap, 0, 0, c.width, c.height)
      bitmap.close()
      setBackdrop(c.toDataURL('image/jpeg', 0.86))
    } catch (e) {
      setExportNote(e instanceof Error ? e.message : 'could not read that picture')
    }
  }

  const anyFinish = FINISHES.some((f) => finishes[f.id]?.on)
  /** anything the SVG cannot carry, which is all of it: these are pixels */
  const anyPictureFx = !!backdrop && PICTURE_EFFECTS.some((f) => pictureFx[f.id]?.on)
  useEffect(() => {
    viewRef.current?.setFinishes(finishes)
    requestDraw()
  }, [finishes, requestDraw])

  useEffect(() => {
    viewRef.current?.setPicture(pictureFx, !!backdrop, palette.paper, palette.ink, pictureBoxOf({ layout: layout.id, format: format.id }))
    requestDraw()
  }, [pictureFx, backdrop, palette.paper, palette.ink, layout.id, format.id, viewAge, requestDraw])

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
    abortRef.current?.abort()
    p.onClose()
  }

  // kept fresh so Escape and the countdown can finish a take
  // without closing over a stale sheet or filename
  useEffect(() => {
    finishRecordingRef.current = finishRecording
    closeRef.current = handleClose
    selectedRef.current = selected
    deselectRef.current = () => {
      setSelected('sheet')
      setFramed(false)
    }
  })

  const startRecording = () => {
    if (recorderRef.current) return
    setExportNote(null)
    try {
      const canvas = viewRef.current?.canvas
      if (!canvas) throw new Error('The sheet is not ready to record yet.')
      // from the top of the loop, so the take is exactly one loop long
      clock.current = 0
      setPlaying(true)
      recorderRef.current = startSheetRecorder(canvas)
      recStemRef.current = stem
      setRecSeconds(0)
      setRecording(true)
      const take = length
      recTimerRef.current = setInterval(() => {
        setRecSeconds((s) => {
          if (s + 1 >= take) void finishRecordingRef.current?.()
          return s + 1
        })
      }, 1000)
    } catch (e) {
      setExportNote(e instanceof Error ? e.message : String(e))
    }
  }

  /*
   * A clip of this sheet in any format and layout, rendered frame by frame.
   *
   * Everything about the sheet as it stands — colours, ground, picture,
   * finishes, the word where you put it, the motion and its length — with the
   * format and layout swappable, which is what lets the kit cut one
   * composition four ways.
   */
  const renderCut = async (
    cut: { format: string; layout: string },
    signal: AbortSignal,
    onProgress: (done: number, total: number, eta: number | null) => void,
  ) => {
    const f = getFormat(cut.format)
    const base = { ...exactReq, chain: p.chain, format: cut.format, layout: cut.layout }
    const bindings = bindingsFor(getMode(motionModeId), p.chain)
    return renderClip({
      w: f.w,
      h: f.h,
      seconds: length,
      fps: FPS,
      layersAt: (t) => {
        const chain = modulate(p.chain, motionAt(t, length, speed), bindings, depth)
        return buildPosterLayers({ ...base, chain })
      },
      prepare: (view) => {
        view.setFinishes(finishes)
        view.setPicture(pictureFx, !!backdrop, palette.paper, palette.ink, pictureBoxOf(cut))
        if (cut.layout === 'word') view.setOffset((wordT.dx / format.w) * f.w, (wordT.dy / format.h) * f.h)
      },
      onProgress,
      signal,
    })
  }

  /** the clip on screen, as an MP4 — or, where it cannot be rendered, recorded live */
  const renderVideo = async () => {
    if (canRender === false) {
      startRecording()
      return
    }
    const ac = new AbortController()
    abortRef.current = ac
    setExportNote(null)
    setProgress({ label: 'MP4', done: 0, total: 1, eta: null })
    try {
      const blob = await renderCut({ format: format.id, layout: layout.id }, ac.signal, (done, total, eta) =>
        setProgress({ label: 'MP4', done, total, eta }),
      )
      await saveFile(blob, `${stem}-${length}s.mp4`)
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError'))
        setExportNote(e instanceof Error ? e.message : String(e))
    } finally {
      abortRef.current = null
      setProgress(null)
    }
  }

  /**
   * A still of this sheet in any format and layout, through the same pipeline
   * as the screen. The word keeps its place as a share of the sheet, so a
   * word set low on a post is set low on a story.
   */
  const stillOf = async (cut: { format: string; layout: string }, scale: number) => {
    const f = getFormat(cut.format)
    const shot = createFinishView(scale, f.w, f.h)
    try {
      shot.setFinishes(finishes)
      shot.setPicture(pictureFx, !!backdrop, palette.paper, palette.ink, pictureBoxOf(cut))
      if (cut.layout === 'word') shot.setOffset((wordT.dx / format.w) * f.w, (wordT.dy / format.h) * f.h)
      const same = cut.format === format.id && cut.layout === layout.id && exactReq === sheetReq
      const built = same ? layers : buildPosterLayers({ ...exactReq, format: cut.format, layout: cut.layout })
      await shot.setSheet(built.ground, built.word)
      shot.draw()
      return await new Promise<Blob>((resolve, reject) =>
        shot.canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('could not draw the sheet'))), 'image/png'),
      )
    } finally {
      shot.destroy()
    }
  }

  /*
   * One font, every cut a week's post needs, in one press.
   *
   * This knowingly bends "the format belongs to the sheet": the kit re-cuts
   * the composition on screen to the sizes the platforms take, rather than
   * asking for four trips through the format menu. Stills for a carousel
   * and the clip twice, 4:5 for feeds and 9:16 for
   * Reels, TikTok and Shorts. Stills at 1×, the size every platform shows;
   * the PNG download stays 2×. The caption comes with it, both lengths.
   * Three stills since the poster round: the word, the set and the specimen.
   */
  const renderKit = async () => {
    const ac = new AbortController()
    abortRef.current = ac
    setExportNote(null)
    setKit(null)
    setCopied(false)
    const base = `forfontsake-${p.chain.map((c) => c.id).join('-')}-${sheetSeed}`
    // the template you are on rides along as a fourth still, since it is the post you made
    const own = template ? [{ layout: layout.id, name: `${layout.name.toLowerCase()} 4:5`, file: `${base}-${layout.id}-4x5.png` }] : []
    const stills = [
      { layout: 'word', name: 'word 4:5', file: `${base}-word-4x5.png` },
      { layout: 'chars', name: 'set 4:5', file: `${base}-set-4x5.png` },
      { layout: 'specimen', name: 'specimen 4:5', file: `${base}-specimen-4x5.png` },
      ...own,
    ]
    const steps = stills.length + 2
    const at = (n: number, label: string, done = 0, total = 1, eta: number | null = null) =>
      setProgress({ label: `Kit ${n} of ${steps} · ${label}`, done: (n - 1) * total + done, total: steps * total, eta })
    try {
      const able = canRender ?? (await canRenderClips(1080, 1920))
      setCanRender(able)
      const files: File[] = []
      for (const [i, st] of stills.entries()) {
        at(i + 1, st.name)
        files.push(new File([await stillOf({ format: 'post', layout: st.layout }, 1)], st.file, { type: 'image/png' }))
      }
      if (able) {
        const clips = [
          { n: stills.length + 1, format: 'post', name: 'feed 4:5', file: `${base}-${layout.id}-4x5.mp4` },
          { n: stills.length + 2, format: 'story', name: 'reel 9:16', file: `${base}-${layout.id}-9x16.mp4` },
        ]
        for (const c of clips) {
          at(c.n, c.name)
          const blob = await renderCut({ format: c.format, layout: layout.id }, ac.signal, (done, total, eta) =>
            at(c.n, c.name, done, total, eta),
          )
          files.push(new File([blob], c.file, { type: 'video/mp4' }))
        }
      }
      const caption = buildCaption({
        word: p.word,
        chainName,
        fontLabel: p.font.label,
        state: { ...p.state, seed: sheetSeed },
      })
      const { default: JSZip } = await import('jszip')
      const zip = new JSZip()
      // already compressed, every one of them; deflating them again buys nothing
      for (const f of files) zip.file(f.name, f, { compression: 'STORE' })
      zip.file('caption.txt', captionFile(caption))
      await saveFile(await zip.generateAsync({ type: 'blob' }), `${base}-kit.zip`)
      setKit({ files, caption })
      if (!able)
        setExportNote('This browser cannot render a clip, so the kit has the stills and the caption only.')
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError'))
        setExportNote(e instanceof Error ? e.message : String(e))
    } finally {
      abortRef.current = null
      setProgress(null)
    }
  }

  const copyCaption = async () => {
    if (!kit) return
    setCopied(await copyText(kit.caption.long))
  }

  /** the share sheet, where the platform has one that takes files — AirDrop to a phone on a Mac */
  const canShareKit =
    !!kit && typeof navigator.canShare === 'function' && navigator.canShare({ files: kit.files })
  const shareKit = async () => {
    if (!kit) return
    try {
      await navigator.share({ files: kit.files, text: kit.caption.long })
    } catch (e) {
      // closing the sheet is not a failure
      if (!(e instanceof DOMException && e.name === 'AbortError'))
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
    if (anyFinish || anyPictureFx)
      setExportNote(
        anyPictureFx && !anyFinish
          ? 'The SVG carries the letters, not the picture or what was done to it — both are pixels.'
          : 'The SVG carries the letters, not the finish — a finish is pixels.',
      )
  }

  // Drawn again at 2× so the sheet holds up posted anywhere that shows it
  // large. The same pipeline as the screen, one throwaway view wider: two ways
  // of applying a finish would be two finishes.
  const downloadPng = async () => {
    setBusy(true)
    setExportNote(null)
    try {
      await saveFile(await stillOf({ format: format.id, layout: layout.id }, 2), `${stem}.png`)
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
   * The lines are the sheet's own: its centre and the margin all round.
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

  /*
   * Clicking the sheet selects what you clicked.
   *
   * Every canvas tool in the category — Framer, Jitter, Rive, Penpot, Ditther
   * — lets the artwork be the way in and keeps the list as the second one. So:
   * the word, then the ground, which is also how they are stacked.
   */
  const onStagePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (layout.id === 'word' && onWord(e.clientX, e.clientY)) {
      setSelected('word')
      startGesture('move', e)
      return
    }
    setFramed(false)
    // the ground is the last thing under everything — a press off the sheet
    // goes back to the sheet's own settings
    const at = toPoint(e.clientX, e.clientY)
    const inside = !!at && at.x >= 0 && at.y >= 0 && at.x <= format.w && at.y <= format.h
    setSelected(inside ? 'background' : 'sheet')
  }

  /*
   * Whether the pointer is over the word, for the cursor that says it can be
   * taken hold of. Coalesced to a frame: it runs on every pointermove.
   */
  const hoverFrame = useRef<number | null>(null)
  const trackHover = (clientX: number, clientY: number) => {
    if (hoverFrame.current !== null) return
    hoverFrame.current = requestAnimationFrame(() => {
      hoverFrame.current = null
      if (dragRef.current) return
      const over = layout.id === 'word' && onWord(clientX, clientY) ? 'word' : null
      setHover((h) => (h === over ? h : over))
    })
  }
  useEffect(
    () => () => {
      if (hoverFrame.current !== null) cancelAnimationFrame(hoverFrame.current)
    },
    [],
  )

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
    if (!drag) {
      trackHover(e.clientX, e.clientY)
      return
    }
    const next = gestureAt(e.clientX, e.clientY)
    if (!next) return
    if (drag.kind === 'move') {
      // free: the offset is a uniform, so nothing is rebuilt until release
      viewRef.current?.setOffset(next.dx, next.dy)
      requestDraw()
      setGuides(settle(drag.base.dx + toSheet(e.clientX - drag.startX), drag.base.dy + toSheet(e.clientY - drag.startY)).lit)
      moveRef.current = next
    } else {
      // The turn settles on the angles worth landing on unless Shift says
      // otherwise — the opposite way round from Figma, because a word a degree
      // off level on a rectangular sheet is a mistake, not a choice.
      const snapped =
        drag.kind === 'rotate'
          ? { ...next, rotate: snapAngle(next.rotate ?? 0, e.shiftKey) }
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

  /*
   * A picture of each layout, drawn from the real engine.
   *
   * The layouts are the one choice on this screen where the difference is
   * entirely visual, so it is shown rather than named — the same argument the
   * workbench presets won on. Memoised on everything except the dials, because
   * the chain the sheet is handed does not change while you are in here (the
   * motion modulates a copy), so this is two renders per visit rather than two
   * per frame.
   */
  // The four sheets, and the template you are on if you are on one: the rest
  // of the templates live in the gallery, which draws them only when opened.
  const pickable = useMemo(
    () => [...LAYOUTS.filter((l) => l.kind === 'sheet'), ...(template ? [layout] : [])],
    [template, layout],
  )
  const layoutThumbs = useMemo(
    () =>
      pickable.map((l) => {
        try {
          const svg = buildPoster({ ...sheetReq, chain: p.chain, layout: l.id, wordTransform: IDENTITY, copy: copyOf(l.id) })
          return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
        } catch {
          return null
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pickable, p.font, p.fontId, p.chain, p.overrides, sheetSeed, p.word, p.sentence, format.id, palette, copyOf],
  )
  /** the sheet the gallery draws its tiles from: as you made it, not mid-motion */
  const galleryReq = useMemo(() => ({ ...sheetReq, chain: p.chain, wordTransform: IDENTITY }), [sheetReq, p.chain])

  /**
   * Still, or one of the motions. Still puts the sheet back to the font as you
   * made it; a motion plays at once.
   */
  const pickMotion = (id: string | null) => {
    if (id === null) {
      setMotionOn(false)
      setPlaying(false)
      setModChain(null)
      clock.current = 0
      return
    }
    setMotionModeId(id)
    setMotionOn(true)
    setPlaying(true)
  }
  // with motion on the export is a clip, so the browser is asked, once,
  // whether it can render one — on the way in, if the room opened moving
  useEffect(() => {
    if (motionOn && canRender === null) void canRenderClips(1080, 1920).then(setCanRender)
  }, [motionOn, canRender])

  /*
   * What the motion will actually get out of this chain, live.
   *
   * The rebuild rate is adaptive already — the tick backs off to the measured
   * cost — so this is that number said out loud rather than a new limit. Under
   * about six a second the letters step between shapes instead of morphing
   * through them on screen. The rendered clip draws every frame exactly, so
   * this is about the preview, not the file.
   */
  const framesPerSecond = frameMs > 0 ? 1000 / Math.max(TICK_MS, frameMs * 1.5) : null
  // three rebuilds before it is allowed an opinion; one is just the cold one
  const steppy = samples >= 3 && framesPerSecond !== null && framesPerSecond < 6

  const download = (type: string) => {
    if (type === 'kit') void renderKit()
    else if (type === 'mp4') void renderVideo()
    else if (type === 'svg') void downloadSvg()
    else void downloadPng()
  }
  const KIT_ITEM = {
    id: 'kit',
    label: 'Post kit · .zip',
    note: `Word, set and specimen${template ? ` and the ${layout.name.toLowerCase()}` : ''} at 4:5, the clip at 4:5 and 9:16 (${length}s), and a caption — one week's post.`,
  }
  /*
   * What can be downloaded, which follows the motion: a still sheet is a
   * picture or a vector, a moving one is a clip. The same list behind the
   * Download button in the bar and the Export section at the foot of the
   * sheet — both kept, the way Figma keeps both.
   */
  const exportItems = motionOn
    ? [
        {
          id: 'mp4',
          label: `${canRender === false ? 'Record' : 'Render'} MP4 · ${length}s`,
          note:
            canRender === false
              ? 'This browser cannot render a clip frame by frame, so it records the sheet as it plays — a heavy chain will step.'
              : `${format.w} × ${format.h}, ${FPS} fps, silent — every frame drawn exactly, and the last runs into the first.`,
        },
        KIT_ITEM,
      ]
    : [
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
        KIT_ITEM,
      ]
  const exportType = exportItems.some((it) => it.id === exportPick) ? exportPick : exportItems[0].id
  const exportBusy = busy || recording || !!progress

  const rows = layerRows({
    layout,
    word: p.word,
    format,
    finishes,
    wordT,
    ground: groundId,
    backdrop,
    picture: pictureFx,
    motionOn,
  })
  /** the list and the canvas select the same things; the word's frame comes with it */
  const select = (sel: Selection) => {
    setSelected(sel)
    setFramed(sel === 'word' && layout.id === 'word')
  }
  /** a finish back on, with the dials it was left at, opened where you asked for it */
  const addFinish = (id: string) => {
    setFinishes((v) => ({ ...v, [id]: { ...v[id], on: true } }))
    setOpenFinish(id)
    if (selected !== 'finishes') setSelected(`finish:${id}`)
  }
  const removeFinish = (id: string) => {
    setFinishes((v) => ({ ...v, [id]: { ...v[id], on: false } }))
    if (selected === `finish:${id}`) setSelected('finishes')
  }
  const selectedFinish = finishOf(selected)
  const wordRow = rows.find((r) => r.sel === 'word')!
  // with motion on, the sheet's first sections fold to a line so Motion fits
  const fold = (line: string) => (motionOn ? line : undefined)

  /** what the panel's head says: the kind of thing, its name, and a line about it */
  const head: [string, string, string] =
    selected === 'sheet'
      ? ['#', 'Sheet', `${layout.name.toLowerCase()} · ${format.name.toLowerCase()} · seed ${sheetSeed}`]
      : selected === 'word'
        ? ['T', wordRow.name, layout.id === 'word' ? 'the word from the workbench' : layout.note]
        : selected === 'background'
          ? ['▢', 'Background', backdrop ? 'your picture, under the type' : 'the paper under the type']
          : selectedFinish
            ? ['✦', selectedFinish.name, 'a pass over the whole printed sheet']
            : ['✦', 'Finishes', 'passes over the whole printed sheet, top to bottom']

  return (
    <div className="sheet-view">
      <header className="sheet-bar">
        <b className="sheet-name">{chainName}</b>
        <span className="sheet-font">on {p.font.label}</span>

        {/*
          The way out with the artefact, in the bar rather than at the foot of
          a rail you have to reach the bottom of. One type and one button: a
          second row of verbs beside a download is furniture, and the type
          already says what they said.
        */}
        <div className="sheet-export">
          {progress ? (
            <>
              {/* how far, and roughly how long — a clip is minutes of work on a heavy chain */}
              <span className="render-progress" role="status">
                <span className="render-bar" aria-hidden="true">
                  <span style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                </span>
                {progress.label} · {Math.round((progress.done / progress.total) * 100)}%
                {progress.eta !== null && progress.eta >= 1 && ` · ~${Math.ceil(progress.eta)}s left`}
              </span>
              <button type="button" onClick={() => abortRef.current?.abort()}>
                Cancel
              </button>
            </>
          ) : motionOn && recording ? (
            <button type="button" className="is-live" onClick={() => void finishRecording()}>
              Stop · {recSeconds}s
            </button>
          ) : (
            <Menu
              label={motionOn ? 'Download MP4' : 'Download'}
              busyLabel={busy ? 'Rendering…' : null}
              disabled={busy}
              items={exportItems}
              onPick={download}
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
        {/* after a kit: the two things you need once you are in the app you post from */}
        {kit && !progress && (
          <p className="sheet-kit" role="status">
            Kit saved — {kit.files.length} files and a caption.
            <button type="button" className="linkish" onClick={() => void copyCaption()}>
              {copied ? 'Caption copied' : 'Copy caption'}
            </button>
            {canShareKit && (
              <button type="button" className="linkish" onClick={() => void shareKit()}>
                Share…
              </button>
            )}
            <button type="button" className="linkish" onClick={() => setKit(null)} aria-label="Dismiss">
              ✕
            </button>
          </p>
        )}
      </header>

      <div className="sheet-body">
        <aside className="sheet-layers" aria-label="Layers">
          <ComposeLayers
            rows={rows}
            selected={selected}
            onSelect={select}
            finishes={finishes}
            onAdd={addFinish}
            onRemove={removeFinish}
          />
        </aside>

        <div
          className={[
            'sheet-stage',
            motionOn ? 'has-transport' : '',
            hover ? 'is-over-word' : '',
          ]
            .filter(Boolean)
            .join(' ')}
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
          <div className="sheet-holder" aria-hidden={gallery || undefined}>
            <div
              className="sheet-live"
              /* a new size needs a new canvas, so the holder is keyed on it */
              key={format.id}
              ref={mount}
              role="img"
              aria-label={`Specimen sheet, ${chainName} on ${p.font.label}`}
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
                    {dragRef.current?.kind === 'rotate' && (
                      <span className="spin-badge">{Math.round(wordT.rotate ?? 0)}°</span>
                    )}
                    <span
                      className="word-spin"
                      title="Drag to turn · it settles on the square and fifteen-degree angles · hold Shift to turn freely"
                      onPointerDown={(e) => startGesture('rotate', e)}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
          {/* the motion's transport, on the sheet where somebody watching it is looking */}
          {motionOn && (
            <div className="transport">
              <button
                type="button"
                className={playing ? 'is-live' : undefined}
                disabled={recording || !!progress}
                onClick={() => setPlaying((v) => !v)}
              >
                {playing ? 'Pause' : 'Play'}
              </button>
              <span className="transport-mode">
                {getMode(motionModeId).name} · {length}s loop
              </span>
            </div>
          )}

          {glError && <p className="notice is-bad">{glError}</p>}
        </div>

        {gallery && (
          <TemplateGallery
            req={galleryReq}
            copyOf={copyOf}
            current={layout.id}
            onPick={(id) => {
              setLayoutId(id)
              setGallery(false)
            }}
            onShuffle={shuffleAll}
            onClose={() => setGallery(false)}
          />
        )}

        {/*
          The selection's properties — Figma's right panel. Whatever is
          selected on the canvas or in the list is what this edits, and
          nothing selected means the sheet itself.
        */}
        <aside className="sheet-rail" aria-label={`${head[1]} properties`}>
          <header className="inspector-head">
            <h2>
              <span className="layer-icon" aria-hidden="true">
                {head[0]}
              </span>{' '}
              {head[1]}
            </h2>
            <p>{head[2]}</p>
          </header>

          {selected === 'sheet' && (
            <>
              <Section key={`layout-${motionOn}`} title="Layout" fold={fold(layout.name)}>
                <div className="layout-pick">
                  {pickable.map((l, i) => {
                    const on = l.id === layout.id
                    return (
                      <button
                        type="button"
                        key={l.id}
                        className={`layout-cell${on ? ' is-on' : ''}`}
                        aria-pressed={on}
                        title={l.note}
                        onClick={() => setLayoutId(l.id)}
                      >
                        {layoutThumbs[i] ? <img src={layoutThumbs[i]!} alt="" /> : <span className="layout-blank" />}
                        <span>{l.name}</span>
                      </button>
                    )
                  })}
                </div>
                <button
                  type="button"
                  className={gallery ? 'gallery-open is-live' : 'gallery-open'}
                  aria-pressed={gallery}
                  onClick={() => setGallery((g) => !g)}
                >
                  {gallery ? 'Back to the sheet' : 'Browse all templates'}
                </button>
              </Section>

              {/* The sheet's size is a property of the sheet, not of the export. */}
              <Section
                key={`format-${motionOn}`}
                title="Format"
                fold={fold(`${format.name} ${format.ratio}`)}
                aside={
                  <span className="inspector-aside">
                    {format.w} × {format.h}
                  </span>
                }
              >
                <Seg
                  label="Sheet size"
                  items={FORMATS.map((f) => ({ id: f.id, name: `${f.name} ${f.ratio}`, title: `${f.w} × ${f.h}` }))}
                  value={format.id}
                  disabled={recording || !!progress}
                  onChange={setFormatId}
                />
              </Section>

              <Section
                key={`colours-${motionOn}`}
                title="Colours"
                fold={fold(`${palette.paper.toUpperCase()} · ${palette.ink.toUpperCase()}`)}
                aside={
                  <button
                    type="button"
                    className="inspector-icon"
                    title="Recolour: the next palette, over anything set by hand"
                    aria-label="Recolour"
                    onClick={() => {
                      setPaletteIndex((i) => i + 1)
                      // a roll is a whole sheet, so it clears what was set by hand
                      setColours({})
                    }}
                  >
                    ↻
                  </button>
                }
              >
                <Swatch label="Paper" value={palette.paper} onChange={(v) => setColours((c) => ({ ...c, paper: v }))} />
                <Swatch label="Ink" value={palette.ink} onChange={(v) => setColours((c) => ({ ...c, ink: v }))} />
              </Section>

              <Section key={`seed-${motionOn}`} title="Seed" fold={fold(String(sheetSeed))}>
                <div className="row inspector-seed">
                  <span className="inspector-aside">{sheetSeed}</span>
                  <button type="button" onClick={() => setSheetSeed(Math.floor(Math.random() * 9999) + 1)}>
                    Randomise
                  </button>
                </div>
              </Section>

              {/*
                Motion is a setting of the sheet: Still, or one of the three. It
                is a loop — every curve goes round a whole number of times in the
                clip's length, so the length is part of the motion rather than a
                setting on the export — and its dials only exist while it moves.
              */}
              <Section title="Motion" className={motionOn ? 'motion is-moving' : 'motion'}>
                <Seg
                  label="Motion"
                  items={[{ id: 'still', name: 'Still' }, ...MODES.map((m) => ({ id: m.id, name: m.name, title: m.note }))]}
                  value={motionOn ? motionModeId : 'still'}
                  disabled={recording || !!progress}
                  onChange={(id) => pickMotion(id === 'still' ? null : id)}
                />
                <p className="note">
                  {motionOn
                    ? `${getMode(motionModeId).note[0].toUpperCase()}${getMode(motionModeId).note.slice(1)}.`
                    : 'The sheet holds still and downloads as a picture. Pick a motion and it moves, and the download becomes an MP4.'}
                </p>
                {motionOn && steppy && (
                  <p className="note">
                    This chain redraws {layout.id === 'chars' ? 'the character set' : 'the word'} about{' '}
                    {framesPerSecond!.toFixed(1)} times a second, so the letters will step between shapes rather
                    than morph through them here. The MP4 draws every frame exactly.
                  </p>
                )}
                {motionOn && (
                  <>
                    <div className="ctl">
                      <div className="ctl-head">
                        <label htmlFor="motion-depth">Depth</label>
                        <output htmlFor="motion-depth" className={depth === DEFAULT_DEPTH ? 'is-default' : undefined}>
                          {Math.round(depth * 100)}%
                        </output>
                      </div>
                      <input
                        id="motion-depth"
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={depth}
                        disabled={!!progress}
                        onChange={(e) => setDepth(Number(e.target.value))}
                        onDoubleClick={() => setDepth(DEFAULT_DEPTH)}
                      />
                    </div>
                    <div className="ctl">
                      <div className="ctl-head">
                        <label htmlFor="motion-speed">Speed</label>
                        <output htmlFor="motion-speed" className={speed === DEFAULT_SPEED ? 'is-default' : undefined}>
                          {speed.toFixed(2)}×
                        </output>
                      </div>
                      <input
                        id="motion-speed"
                        type="range"
                        min={MIN_SPEED}
                        max={MAX_SPEED}
                        step={0.05}
                        value={speed}
                        disabled={!!progress}
                        onChange={(e) => setSpeed(Number(e.target.value))}
                        onDoubleClick={() => setSpeed(DEFAULT_SPEED)}
                      />
                    </div>
                    <div className="ctl">
                      <div className="ctl-head">
                        <span>Length</span>
                      </div>
                      <Seg
                        label="Clip length"
                        items={LENGTHS.map((l) => ({ id: l, name: `${l} s` }))}
                        value={length}
                        disabled={recording || !!progress}
                        onChange={setLength}
                      />
                    </div>
                  </>
                )}
              </Section>

              {/* Export at the foot of the sheet, where Figma keeps it: the same
                  choices as Download in the bar, with the one picked left showing. */}
              <Section title="Export">
                <label className="visually-hidden" htmlFor="sheet-export-type">
                  Export as
                </label>
                <select
                  id="sheet-export-type"
                  className="inspector-select"
                  value={exportType}
                  disabled={exportBusy}
                  onChange={(e) => setExportPick(e.target.value)}
                >
                  {exportItems.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.label}
                    </option>
                  ))}
                </select>
                <p className="note">{exportItems.find((it) => it.id === exportType)?.note}</p>
                <button type="button" className="save inspector-export" disabled={exportBusy} onClick={() => download(exportType)}>
                  {busy ? 'Rendering…' : exportItems.find((it) => it.id === exportType)?.label}
                </button>
              </Section>
            </>
          )}

          {selected === 'word' && (
            <>
              {layout.id === 'word' && (
                <Section
                  title="Position"
                  aside={
                    moved ? (
                      <button type="button" className="linkish" onClick={() => setWordT(IDENTITY)}>
                        Put it back
                      </button>
                    ) : undefined
                  }
                >
                  {/* the numbers the drag sets, in sheet pixels from where the sheet would centre it */}
                  <div className="xy">
                    {(['dx', 'dy'] as const).map((k) => (
                      <label key={k} className="xy-field">
                        <span>{k === 'dx' ? 'X' : 'Y'}</span>
                        <input
                          type="number"
                          className="ctl-value"
                          step={1}
                          value={Math.round(wordT[k])}
                          onChange={(e) => {
                            const v = Number(e.target.value)
                            if (Number.isFinite(v)) setWordT((t) => ({ ...t, [k]: v }))
                          }}
                        />
                      </label>
                    ))}
                  </div>
                  <div className="ctl word-place">
                    <div className="ctl-head">
                      <label htmlFor="word-size">Size</label>
                      <output htmlFor="word-size" className={wordT.scale === 1 ? 'is-default' : undefined}>
                        {wordT.scale.toFixed(2)}×
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
                    {/*
                      A turn is something you do to the word, not a value you set
                      on a track — Figma, Canva and tldraw all turn from a handle
                      and keep a number beside it for the one you can name. So
                      this is the number, and the knob on the sheet is the verb.
                    */}
                    <div className="ctl-head">
                      <label htmlFor="word-spin">Turn</label>
                      <span className="stepper">
                        <button
                          type="button"
                          className="step-btn"
                          aria-label="Turn back fifteen degrees"
                          onClick={() => setWordT((t) => ({ ...t, rotate: ((t.rotate ?? 0) - 15 + 360) % 360 }))}
                        >
                          −
                        </button>
                        <input
                          id="word-spin"
                          type="number"
                          className={(wordT.rotate ?? 0) === 0 ? 'ctl-value is-default' : 'ctl-value'}
                          min={0}
                          max={359}
                          step={15}
                          value={Math.round(wordT.rotate ?? 0)}
                          onChange={(e) =>
                            setWordT((t) => ({
                              ...t,
                              rotate: ((Math.round(Number(e.target.value)) % 360) + 360) % 360,
                            }))
                          }
                        />
                        <button
                          type="button"
                          className="step-btn"
                          aria-label="Turn on fifteen degrees"
                          onClick={() => setWordT((t) => ({ ...t, rotate: ((t.rotate ?? 0) + 15) % 360 }))}
                        >
                          +
                        </button>
                      </span>
                    </div>
                    <p className="note">
                      Drag the word to move it, a corner to resize, the knob to turn. A turn settles on the square
                      and fifteen-degree angles; hold Shift to put it anywhere.
                    </p>
                  </div>
                </Section>
              )}

              <Section title="Fill">
                <Swatch label="Ink" value={palette.ink} onChange={(v) => setColours((c) => ({ ...c, ink: v }))} />
              </Section>

              <Section title="Text">
                {layout.id === 'word' ? (
                  <>
                    <p className="inspector-text">{p.word}</p>
                    <p className="note">
                      The word comes from the workbench.{' '}
                      <button type="button" className="linkish" onClick={handleClose}>
                        Edit it on the bench
                      </button>
                    </p>
                  </>
                ) : template?.lines ? (
                  <CopyLines
                    id={layout.id}
                    hint={template.lines}
                    lines={lines ?? []}
                    own={!!copy[layout.id]?.own}
                    font={p.font}
                    picture={!!template.picture}
                    hasPicture={!!backdrop}
                    onChange={(next) => setCopy((c) => ({ ...c, [layout.id]: { pick: c[layout.id]?.pick ?? 0, own: next } }))}
                    onShuffle={() => shuffle(layout.id)}
                  />
                ) : (
                  <p className="note">
                    The {layout.name.toLowerCase()} is set to the sheet, so there is nothing to place.
                    {layout.id === 'sentence' &&
                      ' It sets the line you typed on the bench, or a pangram when that is a single word.'}
                    {template && ' It sets the font itself, so there is nothing to write.'} Switch the layout to
                    Word to move and resize it.
                  </p>
                )}
              </Section>
            </>
          )}

          {selected === 'background' && (
            <>
              <Section title="Fill">
                <Swatch label="Paper" value={palette.paper} onChange={(v) => setColours((c) => ({ ...c, paper: v }))} />
              </Section>
              {/*
                Textures are drawn, not shipped — a gradient and a dot screen are
                a few tags each, and an asset would be a download every visitor
                pays for whether or not they open this room. They take their
                colours from the palette, so recolouring the ground recolours the
                texture with it. Upload sits in the row: it is one more answer to
                "what is this printed on", not a separate feature.
              */}
              <Section title="Ground">
                <div className="grounds">
                  {GROUNDS.map((g) => {
                    // a template with a picture box prints the picture in the box
                    // and the ground round it, so there both are on at once
                    const boxed = !!template?.picture
                    const on = (boxed || !backdrop) && g.id === groundId
                    return (
                      <button
                        type="button"
                        key={g.id}
                        className={on ? 'ground is-on' : 'ground'}
                        aria-pressed={on}
                        onClick={() => {
                          setGroundId(g.id)
                          if (!boxed) setBackdrop(null)
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
                    <button type="button" className="linkish" onClick={() => fileRef.current?.click()}>
                      Replace the picture
                    </button>
                    <button type="button" className="linkish" onClick={() => setBackdrop(null)}>
                      Remove it
                    </button>
                  </div>
                )}
              </Section>
              {/*
                What can be done to a picture, and only to a picture.

                A finish is a pass over the whole page; these are on the
                Background layer and reach no further than what is printed on
                it — an effect's scope is where you put it. They only appear when
                there is a photograph to put through one.
              */}
              {backdrop && (
                <Section title="Picture effects">
                  <p className="note">
                    Reprinted in the sheet&rsquo;s own two colours, under the word rather than over it — so the
                    letters stay letters.
                  </p>
                  <EffectStack list={PICTURE_EFFECTS} state={pictureFx} onChange={setPictureFx} idPrefix="picture" />
                </Section>
              )}
            </>
          )}

          {selected === 'finishes' && (
            <Section title="On this sheet">
              <FinishesPanel
                finishes={finishes}
                onChange={setFinishes}
                open={openFinish}
                onOpen={setOpenFinish}
                onRemove={removeFinish}
                onAdd={addFinish}
              />
            </Section>
          )}

          {selectedFinish && (
            <FinishPanel
              f={selectedFinish}
              finishes={finishes}
              onChange={setFinishes}
              onRemove={() => removeFinish(selectedFinish.id)}
            />
          )}
        </aside>
      </div>
    </div>
  )
}

/**
 * The lines a template sets, as one box with a line per line.
 *
 * Typed text replaces the bank for this template only, and Shuffle goes back
 * to the bank at its next set. Anything the font has no glyph for is named
 * rather than silently missing from the sheet — the engine drops it without a
 * gap, which on a poster reads as a typo you did not make.
 */
function CopyLines(p: {
  id: string
  hint: string
  lines: string[]
  own: boolean
  font: FontData
  picture: boolean
  hasPicture: boolean
  onChange: (lines: string[]) => void
  onShuffle: () => void
}) {
  const [text, setText] = useState(p.lines.join('\n'))
  // Shuffle and a template switch arrive as new lines from outside; typing
  // arrives as the same lines that were just sent, and leaves the box alone
  const sent = useRef(p.lines.join('\n'))
  useEffect(() => {
    const incoming = p.lines.join('\n')
    if (incoming !== sent.current) {
      setText(incoming)
      sent.current = incoming
    }
  }, [p.lines, p.id])
  const missing = [...new Set([...text].filter((ch) => ch !== '\n' && !p.font.glyphs[ch]))]
  return (
    <div className="ctl copy-lines">
      <div className="ctl-head">
        <label htmlFor="copy-lines">Copy</label>
        <span className="copy-hint">{p.hint}</span>
      </div>
      <textarea
        id="copy-lines"
        rows={Math.min(8, Math.max(3, p.lines.length + 1))}
        value={text}
        spellCheck
        onChange={(e) => {
          setText(e.target.value)
          const next = e.target.value.split('\n')
          sent.current = e.target.value
          p.onChange(next)
        }}
      />
      {missing.length > 0 && (
        <p className="note">
          This font has no {missing.map((c) => (c === ' ' ? 'space' : c)).join(' ')}, so{' '}
          {missing.length === 1 ? 'it is' : 'they are'} left out of the sheet.
        </p>
      )}
      <div className="row">
        <button type="button" onClick={p.onShuffle}>
          {p.own ? 'Back to ours' : 'Shuffle'}
        </button>
      </div>
      {p.picture && !p.hasPicture && (
        <p className="note">
          The box holds the picture from the Background layer. Until you upload one, a halftone keeps
          its place.
        </p>
      )}
    </div>
  )
}
