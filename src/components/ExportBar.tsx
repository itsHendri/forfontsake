import { useEffect, useRef, useState } from 'react'
import { buildFont, nameProblem, save, suggestName, type ExportResult } from '../lib/exportFont'
import { copyText } from '../lib/clipboard'
import type { FontData } from '../lib/glyphData'
import type { RenderResult } from '../lib/render'
import { getTreatment } from '../engine/treatments/registry'
import type { Step } from '../lib/urlState'

interface Props {
  font: FontData
  fontId: string
  chain: Step[]
  /** "Grit + Bleed" — what the stack is called in the strip and the file name */
  chainName: string
  seed: number
  alternates: number
  /** the line as drawn, for handing to a drawing tool rather than a font menu */
  specimen: RenderResult
  onPoster: () => void
}

type State =
  | { phase: 'idle' }
  | { phase: 'building'; progress: number }
  | { phase: 'done'; result: ExportResult; saved: boolean }
  | { phase: 'failed'; message: string }

const kb = (n: number) => `${Math.round(n / 1024)} KB`

/**
 * The download, given its own strip rather than a menu item.
 *
 * Every tool in this category ships a broken one, so this is the promise the
 * whole thing rests on — it should be the most visible control on the page,
 * and it should say what you are getting before you press it.
 */
export function ExportBar(p: Props) {
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
  }, [p.fontId, p.chain, p.seed, p.alternates])

  const problem = nameProblem(name, p.font)
  const busy = state.phase === 'building'
  // alternates only mean something if some step in the stack is random
  const varies = p.chain.some((step) => !getTreatment(step.id).deterministic)
  const [copied, setCopied] = useState(false)

  /**
   * The line on the plate as standalone SVG, on the clipboard.
   *
   * Not everything wants to be a font. Half the time the treated word is going
   * into a layout, and pasting SVG markup is how it gets into Figma, Illustrator
   * or a page — without waiting for a whole face to be built first.
   */
  const copyForFigma = async () => {
    const s = p.specimen
    const height = s.ascender - s.descender
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.round(s.width)} ${Math.round(height)}" ` +
      `width="${Math.round(s.width)}" height="${Math.round(height)}">` +
      `<g transform="translate(0, ${Math.round(s.ascender)}) scale(1, -1)">` +
      `<path d="${s.d}" fill="currentColor" fill-rule="evenodd"/></g></svg>`
    if (await copyText(svg)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

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

  return (
    <section className="export">
      <div className="export-row">
        <label className="visually-hidden" htmlFor="family">
          Font name
        </label>
        <input
          id="family"
          className="export-name"
          type="text"
          value={name}
          onChange={(e) => {
            setTouched(true)
            setName(e.target.value)
          }}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? 'export-problem' : 'export-meta'}
        />

        <button type="button" className="export-go" onClick={run} disabled={busy || !!problem}>
          {/* the glyph loop is only part of the wait — writing the substitutions
              and checksumming a few megabytes takes as long again on a big
              face, and a bar stuck at 100% reads as a hang */}
          {!busy
            ? state.phase === 'done' && !state.saved
              ? 'Download again'
              : 'Download .ttf'
            : state.progress < 1
              ? `Treating… ${Math.round(state.progress * 100)}%`
              : 'Assembling…'}
        </button>

        <p className="export-meta" id="export-meta">
          {state.phase === 'done' ? (
            <>
              <b>{state.result.fileName}</b> · {kb(state.result.bytes)} ·{' '}
              {state.result.glyphCount} glyphs
              {state.result.addedGlyphs > 0 && <> including {state.result.addedGlyphs} alternates</>}
            </>
          ) : (
            <>
              {p.font.label} · {p.chainName} ·{' '}
              {varies ? `${p.alternates} cuts on the Latin letters` : 'one cut per letter'}{' '}
              {/* the whole face gets treated, not just what is on screen, so
                  say how much of it there is before the wait starts */}
              · from {p.font.sourceGlyphs.toLocaleString()} glyphs · OFL
            </>
          )}
        </p>

        <p className="export-checks">TrueType · installs and shapes</p>
      </div>

      {/* The font is the promise; these two are the ways out of it that do not
          need a whole face built first. */}
      <div className="export-aside">
        <button type="button" onClick={p.onPoster}>
          Make a specimen sheet
        </button>
        <button type="button" onClick={copyForFigma}>
          {copied ? 'Copied' : 'Copy for Figma'}
        </button>
      </div>

      {problem && (
        <p className="export-problem" id="export-problem" role="alert">
          {problem}
        </p>
      )}
      {state.phase === 'failed' && (
        <p className="export-problem" role="alert">
          {state.message}
        </p>
      )}
    </section>
  )
}
