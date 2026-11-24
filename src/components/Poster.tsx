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
import { loadLook, lookFromText, lookToText, saveLook, type ComposeLook, type TemplateCopy, type Tracks } from '../lib/composeLook'
import { copyFor, copySets } from '../lib/copyBank'
import { getTemplate } from '../lib/templates'
import { loadScan, scanReady } from '../lib/grounds'
import { ComposeLayouts } from './ComposeLayouts'
import { ComposeTimeline, PlayGlyph } from './ComposeTimeline'
import { Menu, type MenuSection } from './Menu'
import { ComposeLayers, LayerChips } from './ComposeLayers'
import { EffectStack, FinishPanel, FinishesPanel, Section, Swatch } from './ComposePanels'
import { finishOf, layerRows, sheetSummary, type Selection } from '../lib/composeLayers'
import { emptyHistory, record, redo, undo, type History } from '../lib/history'
import { getTreatment, type ParamSpec } from '../engine/treatments/registry'
import { Dial } from './Dial'
import { useScrub } from '../lib/scrub'
import {
  DEFAULT_DEPTH,
  chainKey,
  getMode,
  liveRows,
  modulate,
  resolveBindings,
  setRow,
  tracksFor,
  type Band,
  type Bindings,
} from '../lib/modulate'
import { DEFAULT_SPEED, MAX_SPEED, MIN_SPEED, FPS, clockText, motionAt } from '../lib/motion'
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

/** X or Y in sheet pixels: type it, or drag the letter sideways the way Figma's fields scrub */
function XyField({ name, value, onChange }: { name: string; value: number; onChange: (v: number) => void }) {
  const scrub = useScrub({ value, range: { min: -Infinity, max: Infinity, step: 1 }, onChange, settle: Math.round })
  return (
    <label className="xy-field">
      <span className="ctl-scrub" title="Drag sideways to move" {...scrub}>
        {name}
      </span>
      <input
        type="number"
        className="ctl-value"
        step={1}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v)) onChange(v)
        }}
      />
    </label>
  )
}

/*
 * The sheet's three sliders, as specs for the same Dial the rail uses, so they
 * scrub, step and reset the way every other dial does.
 */
const DEPTH_SPEC: ParamSpec = {
  key: 'depth',
  label: 'Depth',
  min: 0,
  max: 1,
  step: 0.05,
  default: DEFAULT_DEPTH,
  unit: '%',
  note: 'how far each moving dial swings, as a share of its range',
}
const SPEED_SPEC: ParamSpec = {
  key: 'speed',
  label: 'Speed',
  min: MIN_SPEED,
  max: MAX_SPEED,
  step: 0.05,
  default: DEFAULT_SPEED,
  unit: '×',
  note: 'how many times the motion goes round in one clip',
}
const SIZE_SPEC: ParamSpec = {
  key: 'size',
  label: 'Size',
  min: 0.25,
  max: 2,
  step: 0.05,
  default: 1,
  unit: '×',
  note: 'the word against the size the sheet gives it',
}

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

/**
 * How long the sheet has to stay still before a change becomes one step of
 * undo. A slider's whole sweep, or a held arrow key, is one step back rather
 * than sixty.
 */
const SETTLE_MS = 400

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** where the room stops having two side panels and becomes a sheet over the poster */
const PHONE = '(max-width: 900px)'

/**
 * The three heights the phone's sheet rests at: a peek that leaves the poster
 * the screen, half, and most of it. In CSS units, so they hold through a
 * rotation without anything measuring.
 */
const SNAPS = { peek: '176px', half: '46dvh', full: '86dvh' } as const
type Snap = keyof typeof SNAPS

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
  /*
   * The sheet draws with the workbench's seed. It had a Randomise of its own,
   * but a re-rolled sheet could differ from the font you then downloaded, so
   * re-rolling stays on the bench, where it changes the real font (Hendri,
   * 24 November).
   */
  const sheetSeed = p.seed
  const [paletteIndex, setPaletteIndex] = useState(look.paletteIndex)
  const [layoutId, setLayoutId] = useState(look.layoutId)
  /*
   * What each template says: where Shuffle has got to in the bank, and any
   * lines typed over it. Per template, so writing a cover does not cost you
   * the list you wrote last week.
   */
  const [copy, setCopy] = useState<Record<string, TemplateCopy>>(look.copy)
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
  /*
   * The timeline's rows changed by hand, over the preset. Kept with the chain
   * they were set on, since a row names a dial by its place in the stack: a
   * look from another chain opens on the preset alone.
   */
  const [custom, setCustom] = useState<Bindings>(() =>
    look.tracks.chain === chainKey(p.chain) ? liveRows(p.chain, look.tracks.rows) : {},
  )
  const [busy, setBusy] = useState(false)
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
  useEffect(() => {
    speedRef.current = speed
  }, [speed])
  useEffect(() => {
    lengthRef.current = length
  }, [length])
  useEffect(() => {
    depthRef.current = depth
  }, [depth])
  /** what each dial follows: the preset, with the rows changed by hand over it */
  const bindings = useMemo(
    () => resolveBindings(getMode(motionModeId), p.chain, custom),
    [motionModeId, p.chain, custom],
  )
  const bindingsRef = useRef(bindings)
  useEffect(() => {
    bindingsRef.current = bindings
  }, [bindings])
  /** the rows as the look keeps them, with the chain they mean something on */
  const tracks = useMemo<Tracks>(() => ({ chain: chainKey(p.chain), rows: custom }), [p.chain, custom])
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
   * Finishes hidden for a look without them — Figma's eye. Not removed: the
   * finish stays in the list with its dials, and comes back with one click.
   * Hidden means not drawn and not exported, as a hidden layer is in every
   * tool, and it is a way of looking rather than part of the look, so it is
   * neither remembered nor undone.
   */
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
  const shownFinishes = useMemo<FinishState>(() => {
    if (hidden.size === 0) return finishes
    const out: FinishState = {}
    for (const [id, f] of Object.entries(finishes)) out[id] = hidden.has(id) ? { ...f, on: false } : f
    return out
  }, [finishes, hidden])
  const toggleHidden = (id: string) =>
    setHidden((h) => {
      const next = new Set(h)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

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

  /*
   * The phone's sheet: how far up it is. It rests at one of three heights and
   * follows the hand between them, written straight to a CSS variable while
   * the finger is down so a drag is not a render a pixel.
   */
  const [snap, setSnap] = useState<Snap>('peek')
  const viewEl = useRef<HTMLDivElement>(null)
  /*
   * Whether the room is a phone's: one sheet over the poster rather than two
   * side columns and a dock. Asked of the media query rather than left to CSS
   * alone because the layouts column and the timeline each live in one place
   * at a time (beside the stage on a desktop, inside the sheet on a phone),
   * and each draws its own thumbnails and lanes.
   */
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia(PHONE).matches)
  useEffect(() => {
    const mq = window.matchMedia(PHONE)
    const on = () => setPhone(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  /**
   * The playhead and the clock, painted straight into the room: `--t` is
   * where in the loop it is, as a share, and every `.tl-now` says the time.
   * They move every frame, and a render a frame would be the whole room's.
   */
  const paint = useCallback((share: number) => {
    const el = viewEl.current
    if (!el) return
    el.style.setProperty('--t', share.toFixed(4))
    const text = clockText(share * lengthRef.current)
    el.querySelectorAll('.tl-now').forEach((n) => {
      n.textContent = text
    })
  }, [])
  const gripRef = useRef<{ y: number; h: number; moved: boolean } | null>(null)
  useEffect(() => {
    viewEl.current?.style.setProperty('--sheet-h', SNAPS[snap])
  }, [snap])
  const onGripDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    const rail = e.currentTarget.closest('.sheet-rail')
    if (!rail) return
    gripRef.current = { y: e.clientY, h: rail.getBoundingClientRect().height, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
    viewEl.current?.classList.add('is-dragging')
  }
  const onGripMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const g = gripRef.current
    if (!g) return
    const dy = g.y - e.clientY
    if (Math.abs(dy) > 4) g.moved = true
    if (!g.moved) return
    viewEl.current?.style.setProperty('--sheet-h', `${clamp(g.h + dy, 120, window.innerHeight * 0.9)}px`)
  }
  const onGripUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const g = gripRef.current
    gripRef.current = null
    viewEl.current?.classList.remove('is-dragging')
    if (!g) return
    let next: Snap
    if (!g.moved) {
      // a tap is the short way: up to half, or back down to the peek
      next = snap === 'peek' ? 'half' : 'peek'
    } else {
      // wherever it was let go, it settles on the nearest of the three
      const h = clamp(g.h + (g.y - e.clientY), 120, window.innerHeight * 0.9)
      const px = { peek: 176, half: window.innerHeight * 0.46, full: window.innerHeight * 0.86 }
      next = (Object.keys(px) as Snap[]).reduce((a, b) => (Math.abs(px[b] - h) < Math.abs(px[a] - h) ? b : a))
    }
    setSnap(next)
    // set here as well: letting go at the height it already had changes no state
    viewEl.current?.style.setProperty('--sheet-h', SNAPS[next])
  }
  /** colours set by hand, over whatever the palette roll last landed on */
  const [colours, setColours] = useState<Partial<PosterPalette>>(look.colours)
  /** what the sheet is printed on: a drawn texture, or a picture you brought */
  const [groundId, setGroundId] = useState(look.groundId)
  const [backdrop, setBackdrop] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  /*
   * A scanned ground is fetched the first time it is chosen, not before: it is
   * the one ground that is a download. The sheet draws plain paper for the
   * moment it takes, and this count redraws it once the scan is in.
   */
  const [scansIn, setScansIn] = useState(0)
  useEffect(() => {
    if (scanReady(groundId)) return
    let live = true
    loadScan(groundId)
      .then(() => live && setScansIn((n) => n + 1))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [groundId])

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
      tracks,
    })
  }, [paletteIndex, colours, groundId, finishes, pictureFx, formatId, motionOn, motionModeId, depth, speed, length, layoutId, copy, tracks])

  /*
   * Undo. A snapshot of everything that makes the sheet what it is — the look,
   * the timeline's rows, the word's place and the picture, taken once a change has
   * settled. Not the selection or whether it is playing: those are where you
   * are looking, not what you made.
   */
  const doc = useMemo(
    () => ({
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
      custom,
      wordT,
      backdrop,
    }),
    [paletteIndex, colours, groundId, finishes, pictureFx, formatId, motionOn, motionModeId, depth, speed, length, layoutId, copy, custom, wordT, backdrop],
  )
  type Doc = typeof doc
  const historyRef = useRef<History<Doc>>(emptyHistory())
  const [steps, setSteps] = useState({ back: 0, forward: 0 })
  /** the snapshot the history last knew: what an undo goes back past */
  const settledRef = useRef(doc)
  const docRef = useRef(doc)
  /** set while an undo is being applied, so applying it is not itself a change */
  const restoringRef = useRef(false)
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const setHistory = (h: History<Doc>) => {
    historyRef.current = h
    setSteps({ back: h.past.length, forward: h.future.length })
  }
  const commitStep = () => {
    if (settleTimer.current !== null) clearTimeout(settleTimer.current)
    settleTimer.current = null
    const before = settledRef.current
    const now = docRef.current
    settledRef.current = now
    // a change made and taken back before it settled is no step at all
    const same = (Object.keys(now) as (keyof Doc)[]).every((k) => now[k] === before[k])
    if (!same) setHistory(record(historyRef.current, before))
  }
  const commitRef = useRef(commitStep)
  useEffect(() => {
    commitRef.current = commitStep
  })
  useEffect(() => {
    docRef.current = doc
    if (restoringRef.current) {
      restoringRef.current = false
      settledRef.current = doc
      return
    }
    if (doc === settledRef.current) return
    if (settleTimer.current !== null) clearTimeout(settleTimer.current)
    settleTimer.current = setTimeout(() => commitRef.current(), SETTLE_MS)
  }, [doc])
  useEffect(
    () => () => {
      if (settleTimer.current !== null) clearTimeout(settleTimer.current)
    },
    [],
  )

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
  /** every other key the room answers to — undo, nudge, delete — kept fresh below */
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {})
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') {
        keyRef.current(e)
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
  /*
   * A clip rendering reads the sheet, so the live motion stands still under
   * it and the playhead shows the frame being drawn instead.
   */
  const rendering = !!progress
  useEffect(() => {
    if (!motionOn || !playing || rendering) return
    const tier = p.chain.some((s) => HEAVY.has(s.id)) ? TICK_MS_HEAVY : TICK_MS
    let last = performance.now()
    let lastBuild = 0
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      clock.current = (clock.current + dt) % lengthRef.current
      paint(clock.current / lengthRef.current)
      if (now - lastBuild >= Math.max(tier, buildCost.current * 1.5)) {
        lastBuild = now
        const drive = motionAt(clock.current, lengthRef.current, speedRef.current)
        setModChain(modulate(p.chain, drive, bindingsRef.current, depthRef.current))
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [motionOn, playing, rendering, p.chain, paint])

  /*
   * Paused, the sheet shows the frame at the playhead, and shows it again
   * when a row, the depth or the speed changes under it, so an edit is seen
   * without pressing play.
   */
  useEffect(() => {
    if (!motionOn || playing) return
    clock.current %= length
    setModChain(modulate(p.chain, motionAt(clock.current, length, speed), bindings, depth))
    paint(clock.current / length)
  }, [motionOn, playing, bindings, depth, speed, length, p.chain, paint])

  /** the playhead put somewhere in the loop, from the ruler */
  const seek = (share: number) => {
    clock.current = share * length
    paint(share)
    if (!playing) setModChain(modulate(p.chain, motionAt(clock.current, length, speed), bindings, depth))
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
      // a scanned ground draws from a cache that fills after the fetch, so the
      // count of scans in is what tells this to draw the sheet again
      scansIn,
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
      scansIn,
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
  /** what moves in a clip, in its file name: the preset, or custom once a row is changed by hand */
  const motionTag = Object.keys(custom).length > 0 ? 'custom' : motionModeId

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

  const anyFinish = FINISHES.some((f) => shownFinishes[f.id]?.on)
  /** anything the SVG cannot carry, which is all of it: these are pixels */
  const anyPictureFx = !!backdrop && PICTURE_EFFECTS.some((f) => pictureFx[f.id]?.on)
  useEffect(() => {
    viewRef.current?.setFinishes(shownFinishes)
    requestDraw()
  }, [shownFinishes, requestDraw])

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
        view.setFinishes(shownFinishes)
        view.setPicture(pictureFx, !!backdrop, palette.paper, palette.ink, pictureBoxOf(cut))
        if (cut.layout === 'word') view.setOffset((wordT.dx / format.w) * f.w, (wordT.dy / format.h) * f.h)
      },
      onProgress: (done, total, eta) => {
        // the dock's playhead follows the frame being drawn
        paint(total > 0 ? Math.min(0.999, done / total) : 0)
        onProgress(done, total, eta)
      },
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
      await saveFile(blob, `${stem}-${motionTag}-${length}s.mp4`)
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
      shot.setFinishes(shownFinishes)
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
          { n: stills.length + 1, format: 'post', name: 'feed 4:5', file: `${base}-${layout.id}-${motionTag}-4x5.mp4` },
          { n: stills.length + 2, format: 'story', name: 'reel 9:16', file: `${base}-${layout.id}-${motionTag}-9x16.mp4` },
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
  /*
   * Two fingers on the stage take hold of the word wherever they landed: they
   * spread to resize, twist to turn and travel together to move it — the
   * gesture every photo editor on a phone has taught. The first finger may
   * already have started a move; the second takes over from wherever that had
   * got to. The turn settles on the square and fifteen-degree angles as the
   * knob's does, and the outlines are rebuilt once the fingers stop.
   */
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const pinchRef = useRef<{ base: WordTransform; dist: number; angle: number; mx: number; my: number } | null>(null)
  const pair = () => {
    const [a, b] = [...touches.current.values()]
    return {
      dist: Math.hypot(b.x - a.x, b.y - a.y),
      angle: Math.atan2(b.y - a.y, b.x - a.x),
      mx: (a.x + b.x) / 2,
      my: (a.y + b.y) / 2,
    }
  }
  const startPinch = (e: React.PointerEvent<HTMLDivElement>) => {
    const base = moveRef.current ?? wordT
    moveRef.current = null
    dragRef.current = null
    setGuides({ x: [], y: [] })
    pinchRef.current = { base, ...pair() }
    e.currentTarget.setPointerCapture(e.pointerId)
    setSelected('word')
    setFramed(true)
    setWordT(base)
  }

  const onStagePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // a first finger is a new gesture, whatever a lost pointerup left behind
    if (e.isPrimary) {
      touches.current.clear()
      pinchRef.current = null
    }
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (touches.current.size >= 2) {
      if (touches.current.size === 2 && layout.id === 'word' && framedBox) startPinch(e)
      return
    }
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
    if (touches.current.has(e.pointerId)) touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pinch = pinchRef.current
    if (pinch && touches.current.size >= 2) {
      const now = pair()
      const k = pinch.dist > 0 ? now.dist / pinch.dist : 1
      setWordT({
        ...pinch.base,
        scale: clamp(pinch.base.scale * k, 0.25, 2),
        rotate: snapAngle((pinch.base.rotate ?? 0) + ((now.angle - pinch.angle) * 180) / Math.PI),
        dx: pinch.base.dx + toSheet(now.mx - pinch.mx),
        dy: pinch.base.dy + toSheet(now.my - pinch.my),
      })
      return
    }
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
    touches.current.delete(e.pointerId)
    // the pinch ends with the first finger off; the outlines catch up on their
    // own once the word stops changing (BAKE_MS)
    if (pinchRef.current) {
      if (touches.current.size < 2) pinchRef.current = null
      return
    }
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

  /** the sheet the layout tiles are drawn from: as you made it, not mid-motion */
  const layoutsReq = useMemo(() => ({ ...sheetReq, chain: p.chain, wordTransform: IDENTITY }), [sheetReq, p.chain])
  /**
   * Still, or one of the motions. Still puts the sheet back to the font as you
   * made it; a motion plays at once. Either clears the rows changed by hand.
   */
  const pickMotion = (id: string | null) => {
    // a preset fills every row afresh, so rows changed by hand go with the old one
    setCustom({})
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
    else if (type === 'copy-look') void copyLook()
    else if (type === 'paste-look') void pasteLook()
    else void downloadPng()
  }
  /*
   * One Download, in the bar, its choices grouped by what they make (the
   * picture, the clip, the week's kit) with the look's copy and paste at the
   * foot. It used to be two: this and an Export section at the foot of the
   * sheet's panel, the way Figma keeps both. D (November) keeps the one.
   */

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
  /**
   * The list and the canvas select the same things; the word's frame comes
   * with it. On a phone a chip is also a request to see the panel, so a
   * sheet sitting at its peek comes up to half.
   */
  const select = (sel: Selection) => {
    setSelected(sel)
    setFramed(sel === 'word' && layout.id === 'word')
    if (snap === 'peek' && window.matchMedia(PHONE).matches) setSnap('half')
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

  /** a snapshot put back: every part of the sheet set to what it was */
  const applyDoc = (d: Doc) => {
    restoringRef.current = true
    setPaletteIndex(d.paletteIndex)
    setColours(d.colours)
    setGroundId(d.groundId)
    setFinishes(d.finishes)
    setPictureFx(d.pictureFx)
    setFormatId(d.formatId)
    if (d.motionOn !== motionOn) pickMotion(d.motionOn ? d.motionModeId : null)
    setMotionModeId(d.motionModeId)
    setCustom(d.custom)
    setDepth(d.depth)
    setSpeed(d.speed)
    setLength(d.length)
    setLayoutId(d.layoutId)
    setCopy(d.copy)
    setWordT(d.wordT)
    setBakedT(d.wordT)
    setBackdrop(d.backdrop)
  }
  /** nothing is undone while a clip renders or records: the export is reading the sheet */
  const historyLocked = recording || !!progress
  const step = (dir: 'undo' | 'redo') => {
    if (historyLocked) return
    // whatever is still settling counts as done before stepping over it
    if (settleTimer.current !== null) commitStep()
    const r = (dir === 'undo' ? undo : redo)(historyRef.current, docRef.current)
    if (!r) return
    setHistory(r.history)
    applyDoc(r.to)
  }

  /*
   * Copy and paste the look: the colours, ground, finishes, format, motion and
   * template, as text. Pasting is a change like any other, so undo takes it
   * back. The word's place, the seed and the picture stay, because they belong
   * to this sheet and not to the series.
   */
  const [lookSaid, setLookSaid] = useState<string | null>(null)
  useEffect(() => {
    if (!lookSaid) return
    const t = setTimeout(() => setLookSaid(null), 5000)
    return () => clearTimeout(t)
  }, [lookSaid])
  const copyLook = async () => {
    const look: ComposeLook = {
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
      tracks,
    }
    const ok = await copyText(lookToText(look))
    setLookSaid(
      ok
        ? 'Look copied. Paste it into Compose in another browser, or send it to somebody.'
        : 'The browser would not let us copy it.',
    )
  }
  const applyLook = (l: ComposeLook) => {
    // whatever is still settling becomes its own step, so undo lands before the paste
    if (settleTimer.current !== null) commitStep()
    setPaletteIndex(l.paletteIndex)
    setColours(l.colours)
    setGroundId(l.groundId)
    setFinishes(l.finishes)
    setPictureFx(l.pictureFx)
    setFormatId(l.formatId)
    if (l.motionOn !== motionOn) pickMotion(l.motionOn ? l.motionModeId : null)
    setMotionModeId(l.motionModeId)
    // rows name dials by their place in the stack: only a look from this chain brings them
    setCustom(l.tracks.chain === chainKey(p.chain) ? liveRows(p.chain, l.tracks.rows) : {})
    setDepth(l.depth)
    setSpeed(l.speed)
    setLength(l.length)
    setLayoutId(l.layoutId)
    setCopy(l.copy)
    setLookSaid('Look pasted. Undo takes it back.')
  }
  const pasteLook = async () => {
    if (historyLocked) return
    let text: string
    try {
      text = await navigator.clipboard.readText()
    } catch {
      // Reading the clipboard needs permission, and some browsers never give
      // it. An ordinary paste needs none, so that is the way round.
      setLookSaid('The browser would not hand over the clipboard. Press ⌘V or Ctrl+V on the sheet instead.')
      return
    }
    const l = lookFromText(text)
    if (!l) {
      setLookSaid('The clipboard has no look in it. Copy one with Copy look first.')
      return
    }
    applyLook(l)
  }
  /*
   * ⌘V anywhere in the room that is not a text field pastes a look, when the
   * clipboard holds one. A paste event carries its text without asking.
   */
  const pasteRef = useRef<(text: string) => boolean>(() => false)
  useEffect(() => {
    pasteRef.current = (text) => {
      if (historyLocked) return false
      const l = lookFromText(text)
      if (!l) return false
      applyLook(l)
      return true
    }
  })
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t?.closest('textarea, input, select, [contenteditable="true"]')) return
      if (pasteRef.current(e.clipboardData?.getData('text/plain') ?? '')) e.preventDefault()
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [])

  /*
   * The keys a design tool answers to. ⌘Z and ⇧⌘Z (or ⌘Y) everywhere except
   * in a text field, which has its own; the arrows nudge the word a sheet
   * pixel, ten with Shift, as Figma's do; Delete takes off the selected finish.
   * None of them while a control has the keyboard — an arrow on a slider
   * moves the slider.
   */
  useEffect(() => {
    keyRef.current = (e: KeyboardEvent) => {
      const t = e.target instanceof Element ? e.target : null
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()
      if (mod && (key === 'z' || key === 'y')) {
        if (t?.closest('textarea, input[type="text"], input[type="number"], [contenteditable="true"]')) return
        e.preventDefault()
        step(key === 'y' || e.shiftKey ? 'redo' : 'undo')
        return
      }
      if (mod || e.altKey || t?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (e.key.startsWith('Arrow') && selected === 'word' && layout.id === 'word') {
        e.preventDefault()
        const n = e.shiftKey ? 10 : 1
        const dx = e.key === 'ArrowLeft' ? -n : e.key === 'ArrowRight' ? n : 0
        const dy = e.key === 'ArrowUp' ? -n : e.key === 'ArrowDown' ? n : 0
        setWordT((w) => ({ ...w, dx: w.dx + dx, dy: w.dy + dy }))
        return
      }
      const f = finishOf(selected)
      if (f && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault()
        removeFinish(f.id)
      }
    }
  })
  const stillCount = 3 + (template ? 1 : 0)
  const downloadSections: MenuSection[] = [
    {
      title: 'Image',
      items: [
        { id: 'png', label: 'PNG · 2×', note: 'The sheet as it looks, sharp enough to post' },
        { id: 'svg', label: 'SVG', note: 'Letterforms only, for print and editing. Finishes stay out' },
      ],
    },
    {
      title: 'Video',
      items: motionOn
        ? [
            {
              id: 'mp4',
              label: `MP4 · ${length} s loop`,
              badge: 'Suggested',
              note:
                canRender === false
                  ? 'This browser cannot render a clip frame by frame, so it records the sheet as it plays. A heavy chain will step'
                  : `Rendered frame by frame, ${FPS} fps, silent`,
            },
          ]
        : [],
      empty: 'MP4 · pick a motion to make a clip',
    },
    {
      rule: true,
      items: [
        {
          id: 'kit',
          label: 'Post kit · zip',
          note: `${stillCount === 4 ? 'Four' : 'Three'} 4:5 PNGs, the clip at 4:5 and 9:16, a caption`,
        },
      ],
    },
    {
      rule: true,
      inline: true,
      items: [
        { id: 'copy-look', label: 'Copy look' },
        { id: 'paste-look', label: 'Paste look', disabled: historyLocked },
      ],
    },
  ]
  /*
   * The timeline: a row per drivable dial, filled by the preset, any of them
   * changed by hand. One component in one place at a time: the dock under
   * the stage, or the phone's sheet when Motion is the chip selected.
   */
  const trackList = tracksFor(getMode(motionModeId), p.chain, custom)
  const isCustom = Object.keys(custom).length > 0
  const motionName = motionOn ? (isCustom ? 'Custom' : getMode(motionModeId).name) : 'Still'
  const lockNote = rendering
    ? 'Rendering. The timeline waits until the clip is done.'
    : recording
      ? 'Recording. The timeline waits until the take is saved.'
      : null
  const steppyNote =
    motionOn && steppy
      ? `This chain redraws ${layout.id === 'chars' ? 'the character set' : 'the word'} about ${framesPerSecond!.toFixed(1)} times a second, so the letters step between shapes here rather than morph. The MP4 draws every frame exactly.`
      : null
  const timeline = (variant: 'dock' | 'stacked') => (
    <ComposeTimeline
      variant={variant}
      motionOn={motionOn}
      modeId={motionModeId}
      custom={isCustom}
      tracks={trackList}
      stacked={p.chain.length > 1}
      playing={playing}
      locked={lockNote}
      now={clock.current}
      length={length}
      speed={speed}
      depth={depth}
      depthSpec={DEPTH_SPEC}
      speedSpec={SPEED_SPEC}
      steppy={steppyNote}
      onPlay={() => setPlaying((v) => !v)}
      onPreset={pickMotion}
      onRow={(key: string, band: Band | null) =>
        setCustom((c) => setRow(getMode(motionModeId), p.chain, c, key, band))
      }
      onDepth={setDepth}
      onSpeed={setSpeed}
      onLength={setLength}
      onSeek={seek}
    />
  )
  // the Motion chip is a phone's; a desktop has the dock, so it backs out to the sheet
  useEffect(() => {
    if (!phone && selected === 'motion') setSelected('sheet')
  }, [phone, selected])

  const selectedFinish = finishOf(selected)
  const wordRow = rows.find((r) => r.sel === 'word')!

  /** what the panel's head says: the kind of thing, its name, and a line about it */
  const head: [string, string, string] =
    selected === 'sheet'
      ? [
          '#',
          'Sheet',
          sheetSummary({ layout, format, motion: motionOn ? (Object.keys(custom).length > 0 ? 'Custom' : getMode(motionModeId).name) : null }),
        ]
      : selected === 'word'
        ? ['T', wordRow.name, layout.id === 'word' ? 'the word from the workbench' : layout.note]
        : selected === 'background'
          ? ['▢', 'Background', backdrop ? 'your picture, under the type' : 'the paper under the type']
          : selected === 'motion'
            ? ['~', 'Motion', motionOn ? `${motionName} · a ${length} s loop` : 'still · pick a preset to make it move']
          : selectedFinish
            ? ['✦', selectedFinish.name, 'a pass over the whole printed sheet']
            : ['✦', 'Finishes', 'passes over the whole printed sheet, top to bottom']

  return (
    <div className="sheet-view" ref={viewEl}>
      <header className="sheet-bar">
        <div className="sheet-bar-side is-start">
          <b className="sheet-name">{chainName}</b>
          <span className="sheet-font">on {p.font.label}</span>
        </div>

        {/* The sheet's size is a property of the sheet, not of the export, so it
            sits in the bar over the sheet it shapes, as Vimeo's and VEED's do. */}
        <div className="sheet-bar-mid">
          <div
            className="format-seg"
            role="radiogroup"
            aria-label="Format"
            onKeyDown={(e) => {
              const by = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
              if (!by || historyLocked) return
              e.preventDefault()
              const i = FORMATS.findIndex((f) => f.id === format.id)
              const next = FORMATS[(i + by + FORMATS.length) % FORMATS.length]
              setFormatId(next.id)
              e.currentTarget.querySelector<HTMLButtonElement>(`[data-id="${next.id}"]`)?.focus()
            }}
          >
            {FORMATS.map((f) => {
              const on = f.id === format.id
              return (
                <button
                  type="button"
                  key={f.id}
                  data-id={f.id}
                  role="radio"
                  aria-checked={on}
                  tabIndex={on ? 0 : -1}
                  className={on ? 'is-on' : undefined}
                  title={`${f.w} × ${f.h}`}
                  disabled={historyLocked}
                  onClick={() => setFormatId(f.id)}
                >
                  {f.name} {f.ratio}
                </button>
              )
            })}
          </div>
          <span className="format-size">
            {format.w} × {format.h}
          </span>
        </div>

        <div className="sheet-bar-side is-end">
          {/* undo where a phone can reach it too: it has no ⌘Z */}
          <div className="sheet-history" role="group" aria-label="History">
            <button
              type="button"
              className="sheet-history-btn"
              aria-label="Undo"
              title="Undo · ⌘Z"
              disabled={steps.back === 0 || historyLocked}
              onClick={() => step('undo')}
            >
              <HistoryIcon />
            </button>
            <button
              type="button"
              className="sheet-history-btn"
              aria-label="Redo"
              title="Redo · ⇧⌘Z"
              disabled={steps.forward === 0 || historyLocked}
              onClick={() => step('redo')}
            >
              <HistoryIcon redo />
            </button>
          </div>
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
                className="save dl-btn"
                title={motionOn ? 'Download MP4' : 'Download'}
                label={
                  <>
                    {motionOn ? 'Download MP4' : 'Download'}
                    <span className="dl-caret" aria-hidden="true">
                      ▾
                    </span>
                  </>
                }
                busyLabel={busy ? 'Rendering…' : null}
                disabled={busy}
                sections={downloadSections}
                onPick={download}
                sheet
              />
            )}
          </div>

          {/* closing finishes a take rather than losing it — see handleClose */}
          <button type="button" className="sheet-close" onClick={handleClose} aria-label="Leave Compose">
            ✕
          </button>
        </div>

        {/* whatever went wrong on the way out, under the control it went wrong
            for — the bar wraps it onto its own line rather than growing */}
        {exportNote && (
          <p className="sheet-problem" role="alert">
            {exportNote}
          </p>
        )}
        {lookSaid && (
          <p className="sheet-kit" role="status">
            {lookSaid}
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

      <div className={motionOn ? 'sheet-body is-moving' : 'sheet-body'}>
        {!phone && (
          <aside className="sheet-layers" aria-label="Layers and layouts">
            <div className="sheet-layers-top">
              <ComposeLayers
                rows={rows}
                selected={selected}
                onSelect={select}
                finishes={finishes}
                onAdd={addFinish}
                onRemove={removeFinish}
                hidden={hidden}
                onToggleHidden={toggleHidden}
              />
            </div>
            <div className="layouts-head">
              <h2 className="layers-title">Layouts</h2>
              <span className="layouts-count">{LAYOUTS.length}</span>
            </div>
            <div className="layouts-scroll">
              <ComposeLayouts req={layoutsReq} copyOf={copyOf} current={layout.id} onPick={setLayoutId} />
            </div>
          </aside>
        )}

        <div
          className={[
            'sheet-stage',
            phone && motionOn ? 'has-transport' : '',
            hover ? 'is-over-word' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          ref={sheetRef}
          onPointerDown={onStagePointerDown}
          onPointerMove={onStagePointerMove}
          onPointerUp={onStagePointerUp}
          onPointerCancel={onStagePointerUp}
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
          {/* a phone's transport: the dock is in the sheet below, so play and the
              time stay where somebody watching the motion is looking */}
          {phone && motionOn && (
            <div className="transport">
              <button
                type="button"
                className="tl-play"
                aria-label={playing ? 'Pause' : 'Play'}
                disabled={recording || rendering}
                onClick={() => setPlaying((v) => !v)}
              >
                <PlayGlyph playing={playing && !rendering} />
              </button>
              <span className="tl-time">
                <span className="tl-now">{clockText(clock.current)}</span>
                <span className="tl-total"> / {clockText(length, false)}</span>
              </span>
              <button type="button" className="transport-mode" onClick={() => select('motion')}>
                {motionName} ›
              </button>
            </div>
          )}

          {glError && <p className="notice is-bad">{glError}</p>}
        </div>

        {/*
          The selection's properties — Figma's right panel. Whatever is
          selected on the canvas or in the list is what this edits, and
          nothing selected means the sheet itself.
        */}
        <aside className="sheet-rail" aria-label={`${head[1]} properties`}>
          {/* a phone's way in: the grip that sizes the sheet, and the layers as chips */}
          <div className="sheet-rail-top">
            <button
              type="button"
              className="sheet-grip"
              aria-label={snap === 'peek' ? 'Show more of the panel' : 'Show less of the panel'}
              onPointerDown={onGripDown}
              onPointerMove={onGripMove}
              onPointerUp={onGripUp}
              onPointerCancel={onGripUp}
            />
            <LayerChips rows={rows} selected={selected} onSelect={select} finishes={finishes} motion={motionName} />
          </div>
          <header className={selected === 'sheet' ? 'inspector-head is-sheet' : 'inspector-head'}>
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
              {/* a phone has no left column, so the layouts come up with the sheet */}
              {phone && (
                <Section
                  title="Layouts"
                  aside={<span className="inspector-aside">{LAYOUTS.length}</span>}
                >
                  <ComposeLayouts req={layoutsReq} copyOf={copyOf} current={layout.id} onPick={setLayoutId} />
                </Section>
              )}
              <Section
                title="Colours"
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
              <p className="note inspector-hint">
                {phone
                  ? 'Pick a layout above, a format in the bar. Tap the word or the background to change them.'
                  : 'Pick a layout on the left, a format in the bar. Click the word or the background to change them.'}
              </p>
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
                      <XyField
                        key={k}
                        name={k === 'dx' ? 'X' : 'Y'}
                        value={Math.round(wordT[k])}
                        onChange={(v) => setWordT((t) => ({ ...t, [k]: v }))}
                      />
                    ))}
                  </div>
                  <div className="word-place">
                    <Dial
                      id="word-size"
                      spec={SIZE_SPEC}
                      value={wordT.scale}
                      onChange={(scale) => setWordT((t) => ({ ...t, scale }))}
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

          {selected === 'motion' && phone && timeline('stacked')}

          {selected === 'finishes' && (
            <Section title="On this sheet">
              <FinishesPanel
                finishes={finishes}
                onChange={setFinishes}
                open={openFinish}
                onOpen={setOpenFinish}
                onRemove={removeFinish}
                onAdd={addFinish}
                hidden={hidden}
                onToggleHidden={toggleHidden}
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

        {/* the motion's dock, under the stage and the panel, the way a video editor keeps its timeline */}
        {!phone && <div className="sheet-dock">{timeline('dock')}</div>}
      </div>
    </div>
  )
}

/** a curved arrow back, or mirrored, forward — drawn, because the ↶ glyph comes out a hairline */
function HistoryIcon({ redo }: { redo?: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={redo ? { transform: 'scaleX(-1)' } : undefined}
    >
      <path d="M5.5 3.5 2.5 6.5l3 3" />
      <path d="M2.5 6.5h7a4 4 0 0 1 0 8H7" />
    </svg>
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
