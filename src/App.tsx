import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TREATMENTS, getTreatment, defaults, type ParamValues, type Preset } from './engine/treatments/registry'
import { loadLibrary, type Library } from './lib/glyphData'
import { render } from './lib/render'
import { decodeState, encodeState, type WorkbenchState } from './lib/urlState'
import { Panel } from './components/Panel'
import { Stage } from './components/Stage'
import { Shelf, type Kept } from './components/Shelf'

const FALLBACK_TEXT = 'Grittier letters'

function initialState(library: Library): WorkbenchState {
  const fromUrl = decodeState(window.location.hash)
  if (fromUrl && library[fromUrl.fontId] && TREATMENTS.some((t) => t.id === fromUrl.treatmentId)) {
    // fill any parameter the URL omitted, so an older link still opens
    return { ...fromUrl, params: { ...defaults(getTreatment(fromUrl.treatmentId)), ...fromUrl.params } }
  }
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
  const [kept, setKept] = useState<Kept[]>([])
  const nextKeptId = useRef(1)

  useEffect(() => {
    loadLibrary()
      .then((lib) => {
        setLibrary(lib)
        setState(initialState(lib))
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

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
        text: state.text.length > 0 ? state.text : FALLBACK_TEXT,
        params: state.params,
        seed: state.seed,
        alternates: state.alternates,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return null
    }
  }, [library, state])

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

  const applyPreset = (preset: Preset) => patch({ params: { ...state.params, ...preset.values } })

  const changeTreatment = (id: string) => {
    // parameters mean different things per treatment, so carrying values across
    // would land on settings nobody chose
    patch({ treatmentId: id, params: defaults(getTreatment(id)) })
  }

  const keep = () => {
    setKept((list) =>
      [
        {
          id: nextKeptId.current++,
          state,
          result,
          treatmentName: treatment.name,
        },
        ...list,
      ].slice(0, 12),
    )
  }

  return (
    <div className="wrap">
      <header>
        <p className="eyebrow">For Font's Sake</p>
        <h1>{treatment.name}, with the dials in your hands</h1>
        <p className="lede">
          Every slider recomputes real glyph geometry here in the page — the same code that
          builds the exported font. Pick a font and a treatment, then a few dials up front with
          the rest behind “more”.
        </p>
      </header>

      <div className="layout">
        <main>
          <Stage result={result} text={state.text || FALLBACK_TEXT} />
          <Shelf
            kept={kept}
            onRestore={(s) => setState(s)}
            onForget={(id) => setKept((list) => list.filter((k) => k.id !== id))}
          />
        </main>

        <Panel
          library={library}
          treatments={TREATMENTS}
          fontId={state.fontId}
          treatment={treatment}
          params={state.params}
          seed={state.seed}
          alternates={state.alternates}
          text={state.text}
          onFont={(fontId) => patch({ fontId })}
          onTreatment={changeTreatment}
          onParam={(key, value) => patch({ params: { ...state.params, [key]: value } })}
          onPreset={applyPreset}
          onSeed={(seed) => patch({ seed })}
          onAlternates={(alternates) => patch({ alternates })}
          onText={(text) => patch({ text })}
          onRandomise={() => patch({ seed: Math.floor(Math.random() * 9999) + 1 })}
          onReset={() =>
            patch({ params: defaults(treatment), seed: 1337 })
          }
          onKeep={keep}
        />
      </div>
    </div>
  )
}

export type { ParamValues }
