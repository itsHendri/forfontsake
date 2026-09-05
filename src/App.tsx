import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import {
  TREATMENTS,
  getTreatment,
  defaults,
  initialParams,
  type ParamValues,
  type Preset,
} from './engine/treatments/registry'
import { loadLibrary, type Library } from './lib/glyphData'
import { importFont, type Imported } from './lib/importFont'
import { render, renderGlyphSet } from './lib/render'
import {
  decodeState,
  encodeState,
  type GlyphOverride,
  type Overrides,
  type WorkbenchState,
  type Step,
} from './lib/urlState'
import { loadShelf, saveShelf, SHELF_LIMIT } from './lib/savedStyles'
import { Panel, type LayerThumb } from './components/Panel'
import { Plate } from './components/Plate'
import { Presets } from './components/Presets'
import { TopBar } from './components/TopBar'
import { GlyphGrid } from './components/GlyphGrid'
import { Waterfall } from './components/Waterfall'
import { Shelf, type Kept } from './components/Shelf'
import { Poster } from './components/Poster'

const FALLBACK_TEXT = 'Grittier letters'

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
  return {
    fontId,
    seed: 1337,
    alternates: 3,
    text: FALLBACK_TEXT,
    chain: [{ id: 'grit', params: initialParams(getTreatment('grit')) }],
  }
}

export default function App() {
  const [library, setLibrary] = useState<Library | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [state, setState] = useState<WorkbenchState | null>(null)
  // The shelf is stored as states, not as rendered outlines — see savedStyles.
  const [saved, setSaved] = useState<WorkbenchState[]>([])
  const [posterOpen, setPosterOpen] = useState(false)
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

  // the address bar mirrors the state rather than driving it, so typing stays
  // responsive and the link is always current
  useEffect(() => {
    if (!state) return
    const hash = `#${encodeState(state)}`
    if (hash !== window.location.hash) {
      window.history.replaceState(null, '', hash)
    }
  }, [state])

  const patch = useCallback((next: Partial<WorkbenchState>) => {
    setState((s) => (s ? { ...s, ...next } : s))
  }, [])

  /** edit one step of the stack, leaving the others alone */
  const patchStep = useCallback((i: number, next: Partial<Step>) => {
    setState((s) =>
      s ? { ...s, chain: s.chain.map((step, j) => (j === i ? { ...step, ...next } : step)) } : s,
    )
  }, [])

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

  /**
   * The shelf's thumbnails, drawn from the stored states.
   *
   * Rebuilt whenever the shelf changes rather than stored alongside it, so a
   * thumbnail always shows what those settings produce *now*. An entry that
   * throws is dropped instead of taking the shelf with it.
   */
  const kept = useMemo<Kept[]>(() => {
    if (!library) return []
    return saved.flatMap((s, i) => {
      try {
        return [
          {
            id: i,
            state: s,
            result: render({
              library,
              fontId: s.fontId,
              chain: s.chain,
              text: s.text.trim() || FALLBACK_TEXT,
              seed: s.seed,
              alternates: s.alternates,
              overrides: s.overrides,
            }),
            treatmentName: s.chain.map((c) => getTreatment(c.id).name).join(' + '),
          },
        ]
      } catch {
        return []
      }
    })
  }, [library, saved])

  // The grid treats every glyph in the face, which is far more work than one
  // line — deferring it lets typing and dragging stay smooth while the grid
  // catches up a beat later.
  const gridKey = state
    ? { fontId: state.fontId, chain: state.chain, seed: state.seed, overrides: state.overrides }
    : null
  const deferredKey = useDeferredValue(gridKey)
  const glyphSet = useMemo(() => {
    if (!library || !deferredKey) return null
    try {
      return renderGlyphSet(
        library,
        deferredKey.fontId,
        deferredKey.chain,
        deferredKey.seed,
        deferredKey.overrides,
      )
    } catch {
      return null // the line above is the one worth surfacing an error for
    }
  }, [library, deferredKey])

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
  const layerThumbs = useMemo<(LayerThumb | null)[]>(() => {
    if (!library || !deferredKey) return []
    return deferredKey.chain.map((step) => {
      try {
        const r = render({
          library,
          fontId: deferredKey.fontId,
          chain: [step],
          text: 'A',
          seed: deferredKey.seed,
          alternates: 1,
        })
        return r.d ? { d: r.d, box: `0 ${-r.ascender} ${r.width} ${r.ascender - r.descender}` } : null
      } catch {
        return null
      }
    })
  }, [library, deferredKey])

  /**
   * One picture per preset: the same two letters treated at that preset.
   *
   * A button is a word and a preset is a picture, which is the whole reason
   * they can no longer be mistaken for each other. Keyed on the font and the
   * treatment alone — the live dials must not redraw these, or every drag
   * would rebuild the row underneath the pointer.
   */
  const presetThumbs = useMemo(() => {
    if (!library || !state || !treatment?.presets) return []
    return treatment.presets.map((preset) => {
      try {
        const r = render({
          library,
          fontId: state.fontId,
          chain: [{ id: treatment.id, params: { ...defaults(treatment), ...preset.values } }],
          text: 'Ag',
          seed: 1337,
          alternates: 1,
        })
        return { d: r.d, box: `0 ${-r.ascender} ${r.width} ${r.ascender - r.descender}` }
      } catch {
        return { d: '', box: '0 0 1 1' }
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library, state?.fontId, treatment])

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

  const specimenText = state.text.trim() || FALLBACK_TEXT
  const specimen =
    state.text.trim().length > 0
      ? result
      : render({
          library,
          fontId: state.fontId,
          chain: state.chain,
          text: FALLBACK_TEXT,
          seed: state.seed,
          alternates: state.alternates,
          overrides: state.overrides,
        })

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
      patchStep(step, { params: { ...state.chain[step].params, ...preset.values } })
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

  const resetDials = () => {
    if (!scoped) {
      // back to the named starting point, not to an unnamed baseline
      patchStep(step, { params: initialParams(treatment) })
      return
    }
    // reset for a selection means "back to the global settings", not defaults
    patchOverrides((overrides) => {
      for (const ch of scopeChars) if (overrides[ch]) overrides[ch].params[step] = {}
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

  /** a layer card's own dial — global by definition, never scoped */
  const setLayerParam = (i: number, key: string, value: number) => {
    patchStep(i, { params: { ...state.chain[i].params, [key]: value } })
  }

  /** the last layer cannot be removed, so its control puts the dials back */
  const clearStep = (i: number) => {
    patchStep(i, { params: initialParams(getTreatment(state.chain[i].id)) })
    patchOverrides((overrides) => {
      for (const o of Object.values(overrides)) o.params[i] = {}
    })
  }

  const changeTreatment = (id: string) => {
    // parameters mean different things per treatment, so carrying values across
    // would land on settings nobody chose — the per-glyph deltas at this step
    // go for the same reason
    patchStep(step, { id, params: initialParams(getTreatment(id)) })
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
    patch({ chain: [...state.chain, { id: next.id, params: initialParams(next) }] })
    setActive(state.chain.length)
  }

  const removeStep = (i: number) => {
    if (state.chain.length <= 1) return
    patch({ chain: state.chain.filter((_, j) => j !== i) })
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

  return (
    <div className="wrap">
      <TopBar
        font={library[state.fontId]}
        fontId={state.fontId}
        chain={state.chain}
        chainName={chainName}
        seed={state.seed}
        alternates={state.alternates}
        overrides={state.overrides}
        onSave={save}
        onShare={() => setPosterOpen(true)}
      />

      <div className="layout">
        <main>
          <Presets
            presets={treatment.presets ?? []}
            thumbs={presetThumbs}
            params={panelParams}
            onPreset={applyPreset}
          />
          <Plate
            library={library}
            treatments={TREATMENTS}
            fontId={state.fontId}
            treatment={treatment}
            text={state.text}
            result={result}
            onFont={(fontId) => patch({ fontId })}
            onTreatment={changeTreatment}
            onText={(text) => patch({ text })}
            onUpload={onUpload}
            importing={importing}
            seed={state.seed}
            alternates={state.alternates}
            canRandomise={state.chain.some((s) => !getTreatment(s.id).deterministic)}
            onRandomise={() => patch({ seed: Math.floor(Math.random() * 9999) + 1 })}
            onReset={resetDials}
          />
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
            />
          )}
          {/*
            The ladder stays in this column rather than running the width of
            the page, so the dials are still on screen while you look at what
            the treatment does to 12px.
          */}
          <Waterfall result={specimen} text={specimenText} />
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
          onLayerParam={setLayerParam}
          onSelectStep={setActive}
          onAddStep={addStep}
          onRemoveStep={removeStep}
          onClearStep={clearStep}
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

      <Shelf
        kept={kept}
        onRestore={(s) => setState(s)}
        onForget={(id) => setSaved((list) => list.filter((_, i) => i !== id))}
      />

      {posterOpen && (
        <Poster
          font={library[state.fontId]}
          fontId={state.fontId}
          chain={state.chain}
          overrides={state.overrides}
          seed={state.seed}
          // one word sets a sheet; a sentence would come out too small to read
          word={specimenText.split(/\s+/)[0] || treatment.name}
          onClose={() => setPosterOpen(false)}
        />
      )}
    </div>
  )
}

export type { ParamValues }
