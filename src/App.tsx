import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { TREATMENTS, getTreatment, defaults, type ParamValues, type Preset } from './engine/treatments/registry'
import { loadLibrary, type Library } from './lib/glyphData'
import { importFont, type Imported } from './lib/importFont'
import { render, renderGlyphSet } from './lib/render'
import { decodeState, encodeState, type WorkbenchState, type Step } from './lib/urlState'
import { loadShelf, saveShelf, SHELF_LIMIT } from './lib/savedStyles'
import { Panel } from './components/Panel'
import { Plate } from './components/Plate'
import { ExportBar } from './components/ExportBar'
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
function usable(state: WorkbenchState, library: Library): WorkbenchState | null {
  if (!library[state.fontId]) return null
  if (state.chain.length === 0) return null
  if (!state.chain.every((step) => TREATMENTS.some((t) => t.id === step.id))) return null
  return {
    ...state,
    chain: state.chain.map((step) => ({
      id: step.id,
      params: { ...defaults(getTreatment(step.id)), ...step.params },
    })),
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
    chain: [{ id: 'grit', params: defaults(getTreatment('grit')) }],
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
  const gridKey = state ? { fontId: state.fontId, chain: state.chain, seed: state.seed } : null
  const deferredKey = useDeferredValue(gridKey)
  const glyphSet = useMemo(() => {
    if (!library || !deferredKey) return null
    try {
      return renderGlyphSet(library, deferredKey.fontId, deferredKey.chain, deferredKey.seed)
    } catch {
      return null // the line above is the one worth surfacing an error for
    }
  }, [library, deferredKey])

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
        })

  const applyPreset = (preset: Preset) =>
    patchStep(step, { params: { ...state.chain[step].params, ...preset.values } })

  const changeTreatment = (id: string) => {
    // parameters mean different things per treatment, so carrying values across
    // would land on settings nobody chose
    patchStep(step, { id, params: defaults(getTreatment(id)) })
  }

  /**
   * Add a step, defaulting to a treatment not already in the stack — repeating
   * one is legitimate but is never the obvious next thing somebody wants.
   */
  const addStep = () => {
    if (state.chain.length >= MAX_STEPS) return
    const used = new Set(state.chain.map((c) => c.id))
    const next = TREATMENTS.find((t) => !used.has(t.id)) ?? TREATMENTS[0]
    patch({ chain: [...state.chain, { id: next.id, params: defaults(next) }] })
    setActive(state.chain.length)
  }

  const removeStep = (i: number) => {
    if (state.chain.length <= 1) return
    patch({ chain: state.chain.filter((_, j) => j !== i) })
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
      <header>
        <p className="eyebrow">For Font's Sake</p>
        <h1>Type it, treat it, take it away</h1>
      </header>

      <div className="layout">
        <main>
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
          <ExportBar
            font={library[state.fontId]}
            fontId={state.fontId}
            chain={state.chain}
            chainName={chainName}
            seed={state.seed}
            alternates={state.alternates}
            specimen={specimen}
            onPoster={() => setPosterOpen(true)}
          />
          {glyphSet && <GlyphGrid set={glyphSet} />}
        </main>

        <Panel
          treatment={treatment}
          chain={state.chain}
          active={step}
          canAdd={state.chain.length < MAX_STEPS}
          params={state.chain[step].params}
          seed={state.seed}
          alternates={state.alternates}
          onParam={(key, value) =>
            patchStep(step, { params: { ...state.chain[step].params, [key]: value } })
          }
          onPreset={applyPreset}
          onSelectStep={setActive}
          onAddStep={addStep}
          onRemoveStep={removeStep}
          onSeed={(seed) => patch({ seed })}
          onAlternates={(alternates) => patch({ alternates })}
          onRandomise={() => patch({ seed: Math.floor(Math.random() * 9999) + 1 })}
          onReset={() => patchStep(step, { params: defaults(treatment) })}
          onSave={save}
        />
      </div>

      <Waterfall result={specimen} text={specimenText} />

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
