import { useEffect, useRef, useState } from 'react'
import { buildFont, nameProblem, save, suggestName, type ExportResult } from '../lib/exportFont'
import type { FontData } from '../lib/glyphData'
import { hasRandomness } from '../engine/treatments/registry'
import type { Overrides, Step } from '../lib/urlState'

interface Props {
  font: FontData
  fontId: string
  chain: Step[]
  /** "Grit + Bleed" — what the stack is called in the file name */
  chainName: string
  seed: number
  alternates: number
  /** per-character exceptions, carried into the export as-is */
  overrides?: Overrides
  onSave: () => void
  onShare: () => void
}

type State =
  | { phase: 'idle' }
  | { phase: 'building'; progress: number }
  | { phase: 'done'; result: ExportResult; saved: boolean }
  | { phase: 'failed'; message: string }

const kb = (n: number) => `${Math.round(n / 1024)} KB`

/**
 * The bar the workbench is worked from: what the font is called, and the three
 * ways of leaving with it.
 *
 * The name field is the page title rather than a field buried next to the
 * download, because naming the thing is the first act of making it and the
 * workbench is not a marketing page — the brand line that used to sit here
 * belongs to an intro page that is not this one.
 *
 * The long description of what you are about to download hangs off the button
 * as a tooltip. It is the answer to "what exactly is in this file?", which is
 * a question you ask once, immediately before pressing, and never again.
 */
export function TopBar(p: Props) {
  const [name, setName] = useState(() => suggestName(p.font, p.chainName))
  const [touched, setTouched] = useState(false)
  const [state, setState] = useState<State>({ phase: 'idle' })
  const live = useRef(true)

  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  // a name nobody edited should follow the font and stack it describes
  useEffect(() => {
    if (!touched) setName(suggestName(p.font, p.chainName))
  }, [p.fontId, p.chainName, p.font, touched])

  // any change to the geometry makes a finished build stale
  useEffect(() => {
    setState((s) => (s.phase === 'done' || s.phase === 'failed' ? { phase: 'idle' } : s))
  }, [p.fontId, p.chain, p.seed, p.alternates, p.overrides])

  const problem = nameProblem(name, p.font)
  const busy = state.phase === 'building'
  // alternates only mean something if some step in the stack is random
  const varies = hasRandomness(p.chain)

  const run = async () => {
    if (problem) return
    setState({ phase: 'building', progress: 0 })
    try {
      const result = await buildFont(
        {
          font: p.font,
          fontId: p.fontId,
          chain: p.chain,
          treatmentName: p.chainName,
          seed: p.seed,
          alternates: p.alternates,
          overrides: p.overrides,
          familyName: name,
        },
        (progress) => live.current && setState({ phase: 'building', progress }),
      )
      if (!live.current) return
      const outcome = await save(result)
      if (!live.current) return
      // a refused prompt is not a failure — the font is built and still here
      setState({ phase: 'done', result, saved: outcome === 'saved' })
    } catch (e) {
      if (!live.current) return
      setState({ phase: 'failed', message: e instanceof Error ? e.message : String(e) })
    }
  }

  const label = !busy
    ? state.phase === 'done' && !state.saved
      ? 'Download again'
      : 'Download .ttf'
    : state.progress < 1
      ? `Treating… ${Math.round(state.progress * 100)}%`
      : 'Assembling…'

  return (
    <header className="topbar">
      <div className="topbar-name">
        <label className="visually-hidden" htmlFor="family">
          Font name
        </label>
        <input
          id="family"
          className="name-field"
          type="text"
          value={name}
          onChange={(e) => {
            setTouched(true)
            setName(e.target.value)
          }}
          spellCheck={false}
          autoComplete="off"
          size={Math.max(4, name.length)}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? 'name-problem' : 'font-meta'}
        />
        <p className="topbar-meta" id="font-meta">
          {state.phase === 'done' ? (
            <>
              <b>{state.result.fileName}</b> · {kb(state.result.bytes)} ·{' '}
              {state.result.glyphCount} glyphs
              {state.result.addedGlyphs > 0 && <> including {state.result.addedGlyphs} alternates</>}
            </>
          ) : (
            <>
              {p.chainName} on {p.font.label} · {p.font.sourceGlyphs.toLocaleString()} glyphs · OFL
            </>
          )}
        </p>
      </div>

      <div className="topbar-actions">
        <button type="button" onClick={p.onSave}>
          Save font
        </button>
        <button type="button" onClick={p.onShare}>
          Share
        </button>
        {/* the tooltip is the meta line, hung off the control it describes */}
        <span className="with-tip">
          <button type="button" className="save" onClick={run} disabled={busy || !!problem}>
            {label}
          </button>
          <span className="tip" role="tooltip">
            {p.font.label} · {p.chainName} ·{' '}
            {varies ? `${p.alternates} cuts on the Latin letters` : 'one cut per letter'} from{' '}
            {p.font.sourceGlyphs.toLocaleString()} glyphs · OFL
          </span>
        </span>
      </div>

      {problem && (
        <p className="export-problem" id="name-problem" role="alert">
          {problem}
        </p>
      )}
      {state.phase === 'failed' && (
        <p className="export-problem" role="alert">
          {state.message}
        </p>
      )}
    </header>
  )
}
