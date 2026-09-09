import { useEffect, useRef, useState } from 'react'
import { buildFont, nameProblem, save, suggestName, type ExportResult } from '../lib/exportFont'
import { WEB_FONT_FORMATS, type WebFontFormat } from '../engine/webfont'
import type { FontData, Library } from '../lib/glyphData'
import { FAMILY_LABEL, hasRandomness, type Treatment } from '../engine/treatments/registry'
import { FONT_ACCEPT } from '../lib/importFont'
import type { Overrides, Step } from '../lib/urlState'

interface Props {
  font: FontData
  fontId: string
  library: Library
  treatments: Treatment[]
  /** the treatment being edited — always `chain[active]` */
  treatment: Treatment
  chain: Step[]
  /** "Grit + Bleed" — what the stack is called in the file name */
  chainName: string
  seed: number
  alternates: number
  /** per-character exceptions, carried into the export as-is */
  overrides?: Overrides
  onFont: (id: string) => void
  onTreatment: (id: string) => void
  onUpload: (file: File) => void
  /** set while a dropped font is being read, so the control can say so */
  importing: boolean
  onSave: () => void
  onShare: () => void
}

/** the font select's last entry — a verb among the nouns */
const UPLOAD = '__upload__'

/**
 * Group the picker by family, keeping whatever order the registry gave.
 *
 * Derived from the list it is handed rather than read from the registry, so a
 * caller passing a subset still gets sensible groups.
 */
function groupTreatments(treatments: Treatment[]) {
  const groups: { label: string; items: Treatment[] }[] = []
  for (const t of treatments) {
    const label = FAMILY_LABEL[t.family] ?? 'Other'
    const found = groups.find((g) => g.label === label)
    if (found) found.items.push(t)
    else groups.push({ label, items: [t] })
  }
  return groups
}

type State =
  | { phase: 'idle' }
  | { phase: 'building'; progress: number }
  | { phase: 'done'; result: ExportResult; saved: boolean }
  | { phase: 'failed'; message: string }

const kb = (n: number) => `${Math.round(n / 1024)} KB`

/**
 * What you can leave with. TTF is the font you install; the two web formats
 * are the same font in a smaller wrapper, which is what a stylesheet wants —
 * and asking for all three is one build, since they are containers over one
 * set of bytes rather than three exports.
 */
const ALL: WebFontFormat[] = ['ttf', 'woff2', 'woff']
const CHOICES: { id: string; formats: WebFontFormat[]; label: string; note: string }[] = [
  ...WEB_FONT_FORMATS.map((f) => ({
    id: f.id,
    formats: [f.id],
    label: `.${f.extension}`,
    note: f.note,
  })),
  {
    id: 'all',
    formats: ALL,
    label: 'all three',
    note: 'A zip of all three: the one you install, and the two a website serves.',
  },
]

/**
 * The bar the workbench is worked from: what the font is made of, what it is
 * called, and the three ways of leaving with it.
 *
 * The name field is the page title rather than a field buried next to the
 * download, because naming the thing is the first act of making it. The
 * project's mark sits in its own row above this one rather than in it: two
 * titles in the same row would argue about which of them the page is called,
 * and the answer has to be the font you are making.
 *
 * The long description of what you are about to download hangs off the button
 * as a tooltip. It is the answer to "what exactly is in this file?", which is
 * a question you ask once, immediately before pressing, and never again.
 */
export function TopBar(p: Props) {
  const [name, setName] = useState(() => suggestName(p.font, p.chainName))
  const [touched, setTouched] = useState(false)
  const [state, setState] = useState<State>({ phase: 'idle' })
  const [choiceId, setChoiceId] = useState('ttf')
  const choice = CHOICES.find((c) => c.id === choiceId) ?? CHOICES[0]
  const live = useRef(true)
  const bar = useRef<HTMLElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  /*
   * The bar sticks to the top, and the dial panel sticks under it. How tall
   * the bar is depends on what is in it — a long font name wraps the actions
   * onto a second row, and an export problem adds a third — so its height is
   * measured and published as a custom property rather than guessed at in the
   * stylesheet. Writing a CSS variable rather than state keeps a resize from
   * re-rendering the workbench.
   */
  useEffect(() => {
    const el = bar.current
    if (!el) return
    const publish = () =>
      document.documentElement.style.setProperty(
        '--topbar-h',
        `${Math.round(el.getBoundingClientRect().height)}px`,
      )
    publish()
    const ro = new ResizeObserver(publish)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

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

  // any change to the geometry — or to what you asked for — makes a finished
  // build stale, and "Download again" would otherwise hand over the old one
  useEffect(() => {
    setState((s) => (s.phase === 'done' || s.phase === 'failed' ? { phase: 'idle' } : s))
  }, [p.fontId, p.chain, p.seed, p.alternates, p.overrides, choiceId])

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
          formats: choice.formats,
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
      : `Download ${choice.label}`
    : state.progress < 1
      ? `Treating… ${Math.round(state.progress * 100)}%`
      : 'Assembling…'

  return (
    <header className="topbar" ref={bar}>
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
        {/*
          What the font is made of, said once and beside the name it is made
          into. These two sat unlabelled in the plate's own bar, where they
          read as settings for the specimen rather than as the two decisions
          the whole file comes from — and where the line under the name was
          left saying "Halftone on Pirata One" to a reader looking straight at
          two menus that said it better.
        */}
        <div className="setup-row">
          <span className="setup-field">
            <label htmlFor="font">Base font</label>
            {/*
              Uploading lives inside the font menu — it is one of the answers to
              "which font?", not a separate feature. A controlled select never
              actually settles on the upload entry: picking it opens the file
              dialog and the value snaps back to the current font on re-render.
            */}
            <select
              id="font"
              value={p.fontId}
              disabled={p.importing}
              onChange={(e) => {
                if (e.target.value === UPLOAD) fileRef.current?.click()
                else p.onFont(e.target.value)
              }}
            >
              {Object.entries(p.library).map(([id, f]) => (
                <option key={id} value={id}>
                  {f.label}
                </option>
              ))}
              <option value={UPLOAD}>{p.importing ? 'Reading…' : 'Upload your own…'}</option>
            </select>
            <input
              ref={fileRef}
              type="file"
              hidden
              accept={FONT_ACCEPT}
              onChange={(e) => {
                const file = e.target.files?.[0]
                // cleared so choosing the same file twice still fires
                e.target.value = ''
                if (file) p.onUpload(file)
              }}
            />
          </span>

          <span className="setup-field">
            <label htmlFor="treatment">Style</label>
            <select
              id="treatment"
              value={p.treatment.id}
              onChange={(e) => p.onTreatment(e.target.value)}
            >
              {/* Grouped: thirteen names in one list is a wall, and the family
                  answers "what sort of thing am I after" before "which one". */}
              {groupTreatments(p.treatments).map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.items.map((t) => (
                    // the blurb rides the option as hover help; as a line beside
                    // the picker it described what the letters already showed
                    <option key={t.id} value={t.id} title={t.blurb}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </span>
        </div>

        <p className="topbar-meta" id="font-meta">
          {state.phase === 'done' ? (
            <>
              <b>{state.result.fileName}</b> · {kb(state.result.bytes)} ·{' '}
              {state.result.glyphCount} glyphs
              {state.result.addedGlyphs > 0 && <> including {state.result.addedGlyphs} alternates</>}
            </>
          ) : (
            <>
              {p.font.sourceGlyphs.toLocaleString()} glyphs · OFL
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
        {/*
          The web formats are the same font in a smaller container — the tables
          inside are byte for byte the ones the sanitiser accepted — so this is
          a choice of wrapper, not of build.
        */}
        <label className="visually-hidden" htmlFor="font-format">
          File format
        </label>
        <select
          id="font-format"
          className="format-pick"
          value={choiceId}
          onChange={(e) => setChoiceId(e.target.value)}
        >
          {CHOICES.map((c) => (
            <option key={c.id} value={c.id} title={c.note}>
              {c.label}
            </option>
          ))}
        </select>
        {/* the tooltip is the meta line, hung off the control it describes */}
        <span className="with-tip">
          <button type="button" className="save" onClick={run} disabled={busy || !!problem}>
            {label}
          </button>
          <span className="tip" role="tooltip">
            {choice.note}
            <br />
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
