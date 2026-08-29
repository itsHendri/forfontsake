import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { TREATMENTS, getTreatment, defaults, type ParamValues, type Preset } from './engine/treatments/registry'
import { loadLibrary, type Library } from './lib/glyphData'
import { render, renderGlyphSet } from './lib/render'
import { decodeState, encodeState, type WorkbenchState } from './lib/urlState'
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
 * A state is usable only if the font and treatment it names still exist, since
 * either can vanish between the link (or the shelf entry) being written and
 * being opened. Missing parameters are filled from the treatment's defaults so
 * an entry written before a dial was added still opens.
 */
function usable(state: WorkbenchState, library: Library): WorkbenchState | null {
  if (!library[state.fontId]) return null
  if (!TREATMENTS.some((t) => t.id === state.treatmentId)) return null
  return { ...state, params: { ...defaults(getTreatment(state.treatmentId)), ...state.params } }
}

function initialState(library: Library): WorkbenchState {
  const fromUrl = decodeState(window.location.hash)
  const valid = fromUrl && usable(fromUrl, library)
  if (valid) return valid
  const fontId = library.pirataone ? 'pirataone' : Object.keys(library)[0]
  return {
    fontId,
    treatmentId: 'grit',
    seed: 1337,
    alternates: 3,
    text: FALLBACK_TEXT,
    params: defaults(getTreatment('grit')),
  }
}

export default function App() {
  const [library, setLibrary] = useState<Library | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [state, setState] = useState<WorkbenchState | null>(null)
  // The shelf is stored as states, not as rendered outlines — see savedStyles.
  const [saved, setSaved] = useState<WorkbenchState[]>([])
  const [posterOpen, setPosterOpen] = useState(false)
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

  const treatment = state ? getTreatment(state.treatmentId) : null

  const result = useMemo(() => {
    if (!library || !state) return null
    try {
      return render({
        library,
        fontId: state.fontId,
        treatmentId: state.treatmentId,
        text: state.text,
        params: state.params,
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
              treatmentId: s.treatmentId,
              text: s.text.trim() || FALLBACK_TEXT,
              params: s.params,
              seed: s.seed,
              alternates: s.alternates,
            }),
            treatmentName: getTreatment(s.treatmentId).name,
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
    ? { fontId: state.fontId, treatmentId: state.treatmentId, params: state.params, seed: state.seed }
    : null
  const deferredKey = useDeferredValue(gridKey)
  const glyphSet = useMemo(() => {
    if (!library || !deferredKey) return null
    try {
      return renderGlyphSet(
        library,
        deferredKey.fontId,
        deferredKey.treatmentId,
        deferredKey.params,
        deferredKey.seed,
      )
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
          treatmentId: state.treatmentId,
          text: FALLBACK_TEXT,
          params: state.params,
          seed: state.seed,
          alternates: state.alternates,
        })

  const applyPreset = (preset: Preset) => patch({ params: { ...state.params, ...preset.values } })

  const changeTreatment = (id: string) => {
    // parameters mean different things per treatment, so carrying values across
    // would land on settings nobody chose
    patch({ treatmentId: id, params: defaults(getTreatment(id)) })
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
          />
          <ExportBar
            font={library[state.fontId]}
            fontId={state.fontId}
            treatment={treatment}
            params={state.params}
            seed={state.seed}
            alternates={state.alternates}
            specimen={specimen}
            onPoster={() => setPosterOpen(true)}
          />
          {glyphSet && <GlyphGrid set={glyphSet} />}
        </main>

        <Panel
          treatment={treatment}
          params={state.params}
          seed={state.seed}
          alternates={state.alternates}
          onParam={(key, value) => patch({ params: { ...state.params, [key]: value } })}
          onPreset={applyPreset}
          onSeed={(seed) => patch({ seed })}
          onAlternates={(alternates) => patch({ alternates })}
          onRandomise={() => patch({ seed: Math.floor(Math.random() * 9999) + 1 })}
          onReset={() => patch({ params: defaults(treatment), seed: 1337 })}
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
          treatment={treatment}
          params={state.params}
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
