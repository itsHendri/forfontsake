import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  TREATMENTS,
  getTreatment,
  defaults,
  initialParams,
  specimenFor,
  type Treatment,
  type ParamValues,
  type Preset,
} from './engine/treatments/registry'
import { loadLibrary, type Library } from './lib/glyphData'
import { importFont, type Imported } from './lib/importFont'
import { render, renderGlyphSet } from './lib/render'
import {
  autoText,
  decodeState,
  encodeState,
  wordFor,
  type GlyphOverride,
  type Overrides,
  type WorkbenchState,
  type Step,
} from './lib/urlState'
import { loadShelf, saveShelf, SHELF_LIMIT } from './lib/savedStyles'
import { Panel } from './components/Panel'
import { Plate } from './components/Plate'
import { Presets } from './components/Presets'
import { TopBar } from './components/TopBar'
import { Brand, SignOff } from './components/Brand'
import type { Thumb } from './components/Thumb'
import { GlyphGrid } from './components/GlyphGrid'
import { Waterfall } from './components/Waterfall'
import { Saved } from './components/Saved'
import { Poster } from './components/Poster'

/**
 * Whether the word on the page is still ours to change.
 *
 * A flag saying "the reader typed this" would be simpler, but the text lives in
 * the URL and on the shelf, and a flag survives neither a reload nor a shared
 * link. So the text is asked instead of tracked. The one cost is that typing
 * "Bubble letters" by hand hands it back to the tool, which is invisible until
 * you switch style — and then reads as the feature working.
 */
const WRITTEN_HERE = new Set(TREATMENTS.map(specimenFor))
function ours(text: string): boolean {
  return WRITTEN_HERE.has(text.trim())
}

/** a step sitting on its treatment's landing preset, and knowing that it is */
function landed(t: Treatment): Step {
  const params = initialParams(t)
  return { id: t.id, params, origin: params }
}

/**
 * A small picture of one treatment step: a word or two put through it alone.
 *
 * The layer cards and the preset chips both want this, and both want the same
 * y-flipped viewBox the rest of the app draws outlines in, so it is written
 * once. Null when the step erases the letter or throws — a thumbnail is never
 * worth taking the page down for.
 */
function thumbnail(
  library: Library,
  fontId: string,
  step: Step,
  text: string,
  seed: number,
): Thumb | null {
  try {
    const r = render({ library, fontId, chain: [step], text, seed, alternates: 1 })
    return r.d ? { d: r.d, box: `0 ${-r.ascender} ${r.width} ${r.ascender - r.descender}` } : null
  } catch {
    return null
  }
}

/**
 * Three is as deep as the stack goes.
 *
 * Not an arbitrary round number: every step re-treats what the last one
 * produced, so cost compounds, and so does illegibility — by the third pass a
 * letter is usually at the edge of being a letter. The cap keeps the tool from
 * offering a way to make something slow and unreadable at the same time.
 */
const MAX_STEPS = 3

/**
 * A state is usable only if the font and every treatment it names still exist,
 * since any of them can vanish between the link (or the shelf entry) being
 * written and being opened. Missing parameters are filled from the treatment's
 * defaults so an entry written before a dial was added still opens.
 *
 * A stack with one unknown treatment in it is rejected whole rather than
 * quietly applied without that step — silently showing something other than
 * what the link says is worse than not opening it.
 */
/** an override that says nothing is noise in the URL and the shelf — drop it */
function overrideEmpty(o: GlyphOverride): boolean {
  return !o.nudge && o.params.every((p) => !p || Object.keys(p).length === 0)
}

/** overrides trimmed to the chain and stripped of empty entries, or absent */
function pruneOverrides(overrides: Overrides | undefined, chainLength: number): Overrides | undefined {
  if (!overrides) return undefined
  const out: Overrides = {}
  for (const [ch, o] of Object.entries(overrides)) {
    const trimmed: GlyphOverride = {
      params: o.params.slice(0, chainLength).map((p) => p ?? {}),
      ...(o.nudge ? { nudge: o.nudge } : {}),
    }
    if (!overrideEmpty(trimmed)) out[ch] = trimmed
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function usable(state: WorkbenchState, library: Library): WorkbenchState | null {
  if (!library[state.fontId]) return null
  if (state.chain.length === 0) return null
  if (!state.chain.every((step) => TREATMENTS.some((t) => t.id === step.id))) return null
  const overrides = pruneOverrides(state.overrides, state.chain.length)
  return {
    ...state,
    chain: state.chain.map((step) => ({
      id: step.id,
      params: { ...defaults(getTreatment(step.id)), ...step.params },
    })),
    ...(overrides ? { overrides } : { overrides: undefined }),
  }
}

function initialState(library: Library): WorkbenchState {
  const fromUrl = decodeState(window.location.hash)
  const valid = fromUrl && usable(fromUrl, library)
  if (valid) return valid
  const fontId = library.pirataone ? 'pirataone' : Object.keys(library)[0]
  // The face the tool shows first, chosen because it is the better
  // introduction to what this does — a letter rebuilt out of marks reads as a
  // decision, where erosion reads as damage. It lands on the classic screen
  // rather than the coarse one because that is the picture people have of a
  // halftone; the finer grid costs more (about 3,100 points on "Wedge" in
  // Archivo Black against 1,250) but still opens at half the weight of Grit's
  // Sandblast, and well inside the preset budget.
  const chain = [landed(getTreatment('halftone'))]
  return { fontId, seed: 1337, alternates: 3, text: autoText(chain), chain }
}

/**
 * How long the dials have to be still before the glyph grid, the layer
 * thumbnails and the address bar catch up.
 *
 * A tenth of a second is under the threshold at which a pause reads as a
 * pause, and long enough that no tick of a drag is ever paid for twice.
 */
const GRID_SETTLE_MS = 120
const URL_SETTLE_MS = 250

export default function App() {
  const [library, setLibrary] = useState<Library | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [state, setState] = useState<WorkbenchState | null>(null)
  // The shelf is stored as states, not as rendered outlines — see savedStyles.
  const [saved, setSaved] = useState<WorkbenchState[]>([])
  /*
   * Which room you are in. Both the sheet and the saved fonts replace the
   * workbench rather than opening over it — same URL, same state on either
   * side of the line — so this is one piece of state rather than a boolean
   * per room, and adding a third cannot leave two of them open at once.
   */
  const [view, setView] = useState<'bench' | 'compose' | 'saved'>('bench')
  // which step in the stack the dials are editing
  const [active, setActive] = useState(0)
  // which glyphs the dials are editing — empty means the whole face
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [importing, setImporting] = useState(false)
  // what the last uploaded font said about its own licence
  const [licence, setLicence] = useState<Imported['licence'] | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const hydrated = useRef(false)

  useEffect(() => {
    loadLibrary()
      .then((lib) => {
        setLibrary(lib)
        setState(initialState(lib))
        // dropped rather than repaired if the font or treatment is gone
        setSaved(loadShelf().flatMap((s) => usable(s, lib) ?? []))
        hydrated.current = true
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  // Guarded on hydration: without it the first render writes its empty shelf
  // over the stored one before the load has had a chance to fill it.
  useEffect(() => {
    if (hydrated.current) saveShelf(saved)
  }, [saved])

  /*
   * The address bar mirrors the state rather than driving it, so typing stays
   * responsive and the link is always current.
   *
   * Trailing, not immediate. A dial drag produces an event a frame, and Safari
   * throws SecurityError past a hundred replaceState calls in thirty seconds —
   * which a drag reaches in ten, and a throw inside an effect takes the tree
   * with it. The pending hash is flushed when the page is hidden, so a reload
   * or a copied link is never behind what is on screen.
   */
  const pendingHash = useRef<string | null>(null)
  const flushHash = useCallback(() => {
    const hash = pendingHash.current
    pendingHash.current = null
    if (hash && hash !== window.location.hash) window.history.replaceState(null, '', hash)
  }, [])
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushHash()
    }
    window.addEventListener('pagehide', flushHash)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('pagehide', flushHash)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [flushHash])
  useEffect(() => {
    if (!state) return
    pendingHash.current = `#${encodeState(state)}`
    const t = setTimeout(flushHash, URL_SETTLE_MS)
    return () => clearTimeout(t)
  }, [state, flushHash])

  // Everything except the stack. The stack goes through patchChain, which is
  // where the word rule lives; typing that out here means a handler cannot
  // quietly reach past it.
  const patch = useCallback((next: Partial<Omit<WorkbenchState, 'chain'>>) => {
    setState((s) => (s ? { ...s, ...next } : s))
  }, [])

  /**
   * Edit the stack, and let the word follow it.
   *
   * Every stack edit comes through here — adding a layer, removing one,
   * swapping a treatment, moving a dial — so the reading stays true without
   * three handlers each remembering the same rule, and so the word is decided
   * from the chain that is landing rather than the one before it. `patch`
   * cannot write the chain, which is what keeps that "every" honest.
   *
   * An emptied field is left empty: refilling it as somebody deletes their way
   * back to a blank would fight them.
   */
  const patchChain = useCallback((edit: (chain: Step[]) => Step[]) => {
    setState((s) => {
      if (!s) return s
      const chain = edit(s.chain)
      return { ...s, chain, text: ours(s.text) ? autoText(chain) : s.text }
    })
  }, [])

  /** edit one step of the stack, leaving the others alone */
  const patchStep = useCallback(
    (i: number, next: Partial<Step>) => {
      patchChain((chain) => chain.map((step, j) => (j === i ? { ...step, ...next } : step)))
    },
    [patchChain],
  )

  /**
   * Edit the overrides map as one unit, pruning as it goes so an override that
   * has been dialled back to nothing disappears from the URL and the shelf
   * rather than lingering as an empty exception.
   */
  const patchOverrides = useCallback(
    (fn: (overrides: Overrides, chainLength: number) => void) => {
      setState((s) => {
        if (!s) return s
        const next: Overrides = Object.fromEntries(
          Object.entries(s.overrides ?? {}).map(([ch, o]) => [
            ch,
            { ...o, params: o.params.map((p) => ({ ...p })) },
          ]),
        )
        fn(next, s.chain.length)
        return { ...s, overrides: pruneOverrides(next, s.chain.length) }
      })
    },
    [],
  )

  /** one glyph's override, grown to the chain's length on demand */
  const overrideFor = (overrides: Overrides, ch: string, chainLength: number): GlyphOverride => {
    const o = overrides[ch] ?? { params: [] }
    while (o.params.length < chainLength) o.params.push({})
    overrides[ch] = o
    return o
  }

  // Restoring a shorter stack from the shelf can leave the selection past the
  // end of it, which would read as the dials editing nothing.
  const step = state ? Math.min(active, state.chain.length - 1) : 0
  const treatment = state ? getTreatment(state.chain[step].id) : null

  const result = useMemo(() => {
    if (!library || !state) return null
    try {
      return render({
        library,
        fontId: state.fontId,
        chain: state.chain,
        text: state.text,
        seed: state.seed,
        alternates: state.alternates,
        overrides: state.overrides,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return null
    }
  }, [library, state])

  // The grid treats every glyph in the face, which is far more work than one
  // line — deferring it lets typing and dragging stay smooth while the grid
  // catches up a beat later.
  // Memoised on the state object: a fresh literal every render would give
  // useDeferredValue a new identity each time, so selecting a layer or opening
  // the sheet would re-run the whole glyph set over byte-identical input.
  const gridKey = useMemo(
    () =>
      state
        ? { fontId: state.fontId, chain: state.chain, seed: state.seed, overrides: state.overrides }
        : null,
    [state],
  )
  /*
   * They wait for the hand to come off the dial.
   *
   * useDeferredValue re-ran them *between* input events, and React cannot
   * abandon a useMemo part way through, so every tick of a drag paid for the
   * whole sixty-nine-glyph set — 52ms on Halftone, 1.7s on a stack, which is
   * most of what made a drag feel like ten frames a second. A trailing timer
   * runs them once, when the value settles, and the grid says it is behind by
   * going pale rather than holding the page still to stay level.
   */
  const [settledKey, setSettledKey] = useState(gridKey)
  useEffect(() => {
    const t = setTimeout(() => startTransition(() => setSettledKey(gridKey)), GRID_SETTLE_MS)
    return () => clearTimeout(t)
  }, [gridKey])
  const settling = gridKey !== settledKey
  const settledFontId = settledKey?.fontId
  const glyphSet = useMemo(() => {
    if (!library || !settledKey) return null
    try {
      return renderGlyphSet(
        library,
        settledKey.fontId,
        settledKey.chain,
        settledKey.seed,
        settledKey.overrides,
      )
    } catch {
      return null // the line above is the one worth surfacing an error for
    }
  }, [library, settledKey])

  // the glyphs carrying their own settings — the grid's corner dots
  const overriddenChars = useMemo(
    () => new Set(Object.keys(state?.overrides ?? {})),
    [state?.overrides],
  )

  /**
   * One picture per layer: the letter A with only that step applied.
   *
   * Deferred with the grid, because a stack of three redraws three letters on
   * every dial move and the line being typed into matters more. Overrides are
   * deliberately left out — a layer's thumbnail describes the layer, not what
   * one selected glyph does to it.
   */
  const layerThumbs = useMemo(() => {
    if (!library || !settledKey) return []
    const key = settledKey
    return key.chain.map((step) => thumbnail(library, key.fontId, step, 'A', key.seed))
  }, [library, settledKey])

  /**
   * One picture per preset: the same two letters treated at that preset.
   *
   * A button is a word and a preset is a picture, which is the whole reason
   * they can no longer be mistaken for each other. Deferred and keyed on the
   * font and the treatment alone: the live dials must not redraw these, and a
   * treatment with several presets is tens of milliseconds of geometry that
   * should not stand between a click and the next paint.
   */
  const deferredTreatmentId = useDeferredValue(treatment?.id)
  const presetThumbs = useMemo(() => {
    const t = deferredTreatmentId ? getTreatment(deferredTreatmentId) : null
    if (!library || !settledFontId || !t?.presets) return []
    return t.presets.map((preset) =>
      thumbnail(library, settledFontId, { id: t.id, params: { ...defaults(t), ...preset.values } }, 'Ag', 1337),
    )
  }, [library, settledFontId, deferredTreatmentId])

  /** the specimen's own handler, stable so the plate can skip a render */
  const onText = useCallback((text: string) => patch({ text }), [patch])

  /**
   * The word the ladder is set in: what was typed, or ours when the field is
   * empty.
   *
   * Memoised, and above the early returns where the hooks have to live. It was
   * a bare `render()` in the render body, so it ran a second full treatment of
   * the word on every render the field was empty for — including renders that
   * had nothing to do with the word, like selecting a glyph.
   */
  const specimenText = state ? wordFor(state) : ''
  const specimen = useMemo(() => {
    if (!library || !state || !result) return null
    if (state.text.trim().length > 0) return result
    try {
      return render({
        library,
        fontId: state.fontId,
        chain: state.chain,
        text: specimenText,
        seed: state.seed,
        alternates: state.alternates,
        overrides: state.overrides,
      })
    } catch {
      return result // the typed line is the one worth surfacing an error for
    }
  }, [library, state, result, specimenText])

  if (error) {
    return (
      <main className="shell">
        <h1>Something went wrong</h1>
        <p className="muted">{error}</p>
      </main>
    )
  }
  if (!library || !state || !treatment || !result) {
    return (
      <main className="shell">
        <p className="muted">Loading outlines…</p>
      </main>
    )
  }

  // With glyphs selected, the dials write per-glyph deltas instead of the
  // global chain — the scope switcher. Everything else stays global.
  const scoped = selected.size > 0
  const scopeChars = [...selected].sort()

  const setParam = (key: string, value: number) => {
    if (!scoped) {
      patchStep(step, { params: { ...state.chain[step].params, [key]: value } })
      return
    }
    patchOverrides((overrides, chainLength) => {
      for (const ch of scopeChars) {
        const o = overrideFor(overrides, ch, chainLength)
        // a delta equal to the global value says nothing — remove it instead
        if (state.chain[step].params[key] === value) delete o.params[step][key]
        else o.params[step][key] = value
      }
    })
  }

  const applyPreset = (preset: Preset) => {
    if (!scoped) {
      // over the dial defaults, not over whatever is currently set — the same
      // composition initialParams and the preset thumbnails use, so a preset's
      // picture and its click cannot mean different things
      const params = { ...defaults(treatment), ...preset.values }
      patchStep(step, { params, origin: params })
      return
    }
    patchOverrides((overrides, chainLength) => {
      for (const ch of scopeChars) {
        const o = overrideFor(overrides, ch, chainLength)
        for (const [key, value] of Object.entries(preset.values)) {
          if (state.chain[step].params[key] === value) delete o.params[step][key]
          else o.params[step][key] = value
        }
      }
    })
  }


  /** drop every exception the selected glyphs carry, reroll nudge included */
  const resetOverrides = () => {
    patchOverrides((overrides) => {
      for (const ch of scopeChars) delete overrides[ch]
    })
  }

  /** new randomness for just the selected glyphs — everything else stays put */
  const reroll = () => {
    patchOverrides((overrides, chainLength) => {
      for (const ch of scopeChars) {
        const o = overrideFor(overrides, ch, chainLength)
        o.nudge = (o.nudge ?? 0) + 1
      }
    })
  }

  /**
   * Detail: one dial over the whole stack.
   *
   * `simplify` stays a parameter of every step — in the URL, on the shelf and
   * in the CLI — so nothing about the state changes shape; the dial writes the
   * same value into all of them. Scoped, it writes the delta into every
   * selected glyph at every step, the way a single dial does at one step.
   */
  const setSimplify = (value: number) => {
    if (!scoped) {
      patchChain((chain) => chain.map((s) => ({ ...s, params: { ...s.params, simplify: value } })))
      return
    }
    patchOverrides((overrides, chainLength) => {
      for (const ch of scopeChars) {
        const o = overrideFor(overrides, ch, chainLength)
        state.chain.forEach((s, i) => {
          if (s.params.simplify === value) delete o.params[i].simplify
          else o.params[i].simplify = value
        })
      }
    })
  }

  /**
   * Put one layer back to the named setting it is sitting on.
   *
   * The card's own control, so it names the layer it acts on rather than
   * acting on whichever one happens to be selected — which is what the old
   * footer Reset did. It goes back to the step's `origin`, the preset that was
   * actually chosen, and takes that layer's per-glyph exceptions with it:
   * leaving them behind would mean pressing Reset and still seeing letters
   * that disagree with the dials.
   */
  const resetStep = (i: number) => {
    const t = getTreatment(state.chain[i].id)
    patchStep(i, { params: state.chain[i].origin ?? initialParams(t) })
    patchOverrides((overrides) => {
      for (const o of Object.values(overrides)) o.params[i] = {}
    })
  }

  const changeTreatment = (id: string) => {
    // parameters mean different things per treatment, so carrying values across
    // would land on settings nobody chose — the per-glyph deltas at this step
    // go for the same reason
    patchStep(step, landed(getTreatment(id)))
    patchOverrides((overrides) => {
      for (const o of Object.values(overrides)) o.params[step] = {}
    })
  }

  // What the dials show. For a selection it is the first glyph's effective
  // values — predictable, and any slider you then move applies to all of them.
  const panelParams = scoped
    ? { ...state.chain[step].params, ...(state.overrides?.[scopeChars[0]]?.params[step] ?? {}) }
    : state.chain[step].params

  // which dials deviate somewhere in the selection — the panel's accents
  const overriddenKeys = new Set<string>()
  if (scoped) {
    for (const ch of scopeChars) {
      const delta = state.overrides?.[ch]?.params[step]
      if (delta) for (const k of Object.keys(delta)) overriddenKeys.add(k)
    }
  }

  /**
   * Add a step, defaulting to a treatment not already in the stack — repeating
   * one is legitimate but is never the obvious next thing somebody wants.
   */
  const addStep = () => {
    if (state.chain.length >= MAX_STEPS) return
    const used = new Set(state.chain.map((c) => c.id))
    const next = TREATMENTS.find((t) => !used.has(t.id)) ?? TREATMENTS[0]
    patchChain((chain) => [...chain, landed(next)])
    setActive(state.chain.length)
  }

  const removeStep = (i: number) => {
    if (state.chain.length <= 1) return
    patchChain((chain) => chain.filter((_, j) => j !== i))
    // per-glyph deltas are aligned with the chain by index, so they move too
    patchOverrides((overrides) => {
      for (const o of Object.values(overrides)) o.params.splice(i, 1)
    })
    setActive((a) => (a > i || a >= state.chain.length - 1 ? Math.max(0, a - 1) : a))
  }

  const chainName = state.chain.map((c) => getTreatment(c.id).name).join(' + ')

  /**
   * Take a font off the file input.
   *
   * The library grows rather than being replaced, so an uploaded face sits
   * beside the shipped ones and switching away and back does not lose it. It
   * is not persisted: these are whole font binaries and somebody else's
   * property as often as not.
   */
  const onUpload = async (file: File) => {
    setImporting(true)
    setNotice(null)
    try {
      const added = await importFont(file)
      setLibrary((lib) => (lib ? { ...lib, [added.id]: added.data } : lib))
      setLicence(added.licence)
      patch({ fontId: added.id })
    } catch (e) {
      // a font that will not parse is an ordinary thing to hand a tool, not a
      // crash — say so in the strip and leave the workbench as it was
      setNotice(e instanceof Error ? e.message : String(e))
      setLicence(null)
    } finally {
      setImporting(false)
    }
  }

  const save = () => {
    // Saving the same settings twice is a slip, not an intent, and on a shelf
    // that now outlives the session the duplicates would accumulate. The
    // existing copy moves to the front rather than a second one appearing.
    const key = encodeState(state)
    setSaved((list) => [state, ...list.filter((s) => encodeState(s) !== key)].slice(0, SHELF_LIMIT))
  }

  /*
   * The sheet is a room, not a dialog.
   *
   * It used to open as an overlay over the workbench, which cost it half its
   * width for a rail the workbench could not use anyway — 702px of a 1080×1350
   * artefact. It replaces the workbench instead and brings its own bar, so the
   * specimen gets the window and closing brings the bench back exactly as it
   * was. The state lives on either side of this line, so nothing is rebuilt.
   */
  if (view === 'compose') {
    return (
      <Poster
        font={library[state.fontId]}
        fontId={state.fontId}
        chain={state.chain}
        overrides={state.overrides}
        seed={state.seed}
        // one word sets a sheet; a sentence would come out too small to read
        word={specimenText.split(/\s+/)[0] || treatment.name}
        onClose={() => setView('bench')}
      />
    )
  }

  /* The same arrangement for the shelf, for the same reason: a saved font is
     what a session produced, and it was living in a 44px strip under the
     footer that you had to already know about. */
  if (view === 'saved') {
    return (
      <Saved
        saved={saved}
        library={library}
        onRestore={(s) => {
          setState(s)
          setView('bench')
        }}
        onForget={(id) => setSaved((list) => list.filter((_, i) => i !== id))}
        onClose={() => setView('bench')}
      />
    )
  }

  return (
    <div className="wrap">
      <Brand />
      <TopBar
        font={library[state.fontId]}
        fontId={state.fontId}
        library={library}
        treatments={TREATMENTS}
        treatment={treatment}
        chain={state.chain}
        chainName={chainName}
        seed={state.seed}
        alternates={state.alternates}
        overrides={state.overrides}
        onFont={(fontId) => patch({ fontId })}
        onTreatment={changeTreatment}
        onUpload={onUpload}
        importing={importing}
        savedCount={saved.length}
        onSave={save}
        onCompose={() => setView('compose')}
        onOpenSaved={() => setView('saved')}
      />

      <div className="layout">
        <main>
          <Presets
            presets={treatment.presets ?? []}
            thumbs={presetThumbs}
            params={panelParams}
            onPreset={applyPreset}
          />
          <Plate fontId={state.fontId} text={state.text} result={result} onText={onText} />
          {notice && <p className="notice is-bad">{notice}</p>}
          {licence && state.fontId.startsWith('upload') && (
            <p className={`notice licence-${licence.verdict}`}>
              <strong>
                {licence.verdict === 'open'
                  ? 'Licence looks open'
                  : licence.verdict === 'restricted'
                    ? 'Licence is restricted'
                    : 'Licence unknown'}
              </strong>{' '}
              {licence.note}
            </p>
          )}
          {glyphSet && (
            <GlyphGrid
              set={glyphSet}
              selected={selected}
              overridden={overriddenChars}
              onSelect={setSelected}
              settling={settling}
            />
          )}
          {/*
            The ladder stays in this column rather than running the width of
            the page, so the dials are still on screen while you look at what
            the treatment does to 12px.
          */}
          <Waterfall result={specimen ?? result} text={specimenText} />
        </main>

        <Panel
          treatment={treatment}
          chain={state.chain}
          active={step}
          canAdd={state.chain.length < MAX_STEPS}
          params={panelParams}
          seed={state.seed}
          alternates={state.alternates}
          thumbs={layerThumbs}
          onParam={setParam}
          onSimplify={setSimplify}
          onSelectStep={setActive}
          onAddStep={addStep}
          onRemoveStep={removeStep}
          onResetStep={resetStep}
          onSeed={(seed) => patch({ seed })}
          onAlternates={(alternates) => patch({ alternates })}
          scope={scopeChars}
          overriddenKeys={overriddenKeys}
          scopeHasOverrides={scopeChars.some((ch) => overriddenChars.has(ch))}
          onClearScope={() => setSelected(new Set())}
          onResetOverrides={resetOverrides}
          onReroll={reroll}
        />
      </div>

      <SignOff />
    </div>
  )
}

export type { ParamValues }
