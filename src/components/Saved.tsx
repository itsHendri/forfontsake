import { useEffect, useMemo, useRef, useState } from 'react'
import { getTreatment, presetMatches, type Step } from '../engine/treatments/registry'
import type { Library } from '../lib/glyphData'
import { SHELF_LIMIT } from '../lib/savedStyles'
import { render, renderGlyphSet, type GlyphSet, type RenderResult } from '../lib/render'
import { encodeState, wordFor, type WorkbenchState } from '../lib/urlState'

interface Kept {
  id: number
  /** the state, encoded — what a card's letters are filed under */
  key: string
  state: WorkbenchState
  result: RenderResult
  treatmentName: string
  /** what it is and what it is on, e.g. "Halftone: Punched out · Anton" */
  caption: string
}

/**
 * A step by the preset it still matches, when it does.
 *
 * The caption was treatment, face and seed, so three fonts made from three
 * Halftone presets on one face read identically, and only the picture told
 * them apart — which a screen reader does not get. The seed is gone too: it
 * is the engine's word, and it was the same on every card anyway.
 */
function stepLabel(step: Step): string {
  const t = getTreatment(step.id)
  const preset = t.presets?.find((p) => presetMatches(p, step.params))
  return preset ? `${t.name}: ${preset.name}` : t.name
}

/**
 * The letters a saved font shows of itself: capitals, lowercase and figures,
 * thirteen of each so they sit on one grid. Thirty-six of the sixty-nine,
 * because twelve fonts' worth of the whole set is seconds of treating on a
 * heavy chain, and these are enough to see the face.
 */
const SAMPLE = 'ABCDEFGHIJKLMabcdefghijklm0123456789'
const COLS = 13
/** the list's line of letters, from the same sample */
const STRIP = 'Aa Bb Cc Dd Ee Ff 0123'

/** cards or a list, remembered in this browser — a convenience, so it may fail quietly */
type View = 'cards' | 'list'
const VIEW_KEY = 'ffs:saved-view'
function loadView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'cards'
  } catch {
    return 'cards'
  }
}

const EMPTY: GlyphSet = { glyphs: [], ascender: 0, descender: 0, unitsPerEm: 1000, ms: 0 }

/**
 * The sample on a grid, unruled: every letter in a square cell an em wide,
 * centred on its own advance. Larger in its cell than the sheet's 62%: with no
 * rules between them the letters are the only thing marking the grid, and a
 * card's cells are a thirteenth of a card.
 */
function SetGrid({ set }: { set: GlyphSet }) {
  const cell = set.unitsPerEm
  const k = 0.78
  return (
    <svg viewBox={`0 0 ${COLS * cell} ${3 * cell}`} preserveAspectRatio="xMinYMid meet" aria-hidden="true">
      {set.glyphs.map((g, i) => {
        const x = (i % COLS) * cell + (cell - g.adv * k) / 2
        const y = Math.floor(i / COLS) * cell + cell / 2 + (set.ascender * k) / 2
        return <path key={g.ch} d={g.d} transform={`translate(${x} ${y}) scale(${k} ${-k})`} />
      })}
    </svg>
  )
}

/** a line of the sample, set as a word would be */
function Strip({ set }: { set: GlyphSet }) {
  const by = new Map(set.glyphs.map((g) => [g.ch, g]))
  const parts: React.ReactNode[] = []
  let x = 0
  for (const ch of STRIP) {
    if (ch === ' ') {
      x += set.unitsPerEm * 0.35
      continue
    }
    const g = by.get(ch)
    if (!g) continue
    parts.push(<path key={ch} d={g.d} transform={`translate(${x} 0) scale(1 -1)`} />)
    x += g.adv
  }
  if (x === 0) return null
  return (
    <svg viewBox={`0 ${-set.ascender} ${x} ${set.ascender - set.descender}`} aria-hidden="true">
      {parts}
    </svg>
  )
}

/**
 * The box the name's ink actually reaches, as a viewBox.
 *
 * It was the font's box plus a margin, so the space above a name was the
 * card's padding plus the gap between the ascender and the capitals plus the
 * margin — and the top of every card looked deeper than its foot. Framed by
 * its ink, the name starts where the padding ends.
 */
function inkBox(d: string, fallback: RenderResult): string {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const nums = d.match(/-?\d+(?:\.\d+)?/g) ?? []
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = Number(nums[i]), y = Number(nums[i + 1])
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  if (!Number.isFinite(x0)) return `0 ${-fallback.ascender} ${fallback.width || 1} ${fallback.ascender - fallback.descender}`
  // a hair of room so an outline's antialiasing is not cut by the edge
  const m = (y1 - y0) * 0.02
  return [x0 - m, -y1 - m, x1 - x0 + m * 2, y1 - y0 + m * 2].join(' ')
}

function CardsIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <rect x="2" y="2" width="5" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <rect x="9" y="2" width="5" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <rect x="2" y="9" width="5" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <rect x="9" y="9" width="5" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

function ListIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M2 3.5h12M2 8h12M2 12.5h12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        d="M2.5 4.5h11M6.5 2.5h3M4 4.5l.7 9h6.6l.7-9M6.7 7v4.5M9.3 7v4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

interface Props {
  /** the shelf as stored: states, never outlines — see savedStyles */
  saved: WorkbenchState[]
  library: Library
  onRestore: (state: WorkbenchState) => void
  onDelete: (id: number) => void
  onClose: () => void
}

/**
 * The fonts you kept, as a room rather than a strip.
 *
 * It used to be a scrolling row of 44px thumbnails under the footer, which
 * meant the only way to find a saved font was to already know it was down
 * there — and once you did, the picture of it was smaller than the preset chip
 * that made it. A saved font is the output of a session's work; it deserves to
 * be looked at, not glanced past.
 *
 * So it replaces the workbench the way the sheet does: same URL, same state on
 * either side of the line, and a close × because it is somewhere you leave
 * rather than somewhere you navigated to.
 */
export function Saved({ saved, library, onRestore, onDelete, onClose }: Props) {
  /*
   * The cards are drawn here, on the way in, rather than by the workbench.
   *
   * They were a memo in App keyed on the shelf, which meant pressing Save
   * re-treated up to twelve words on the main thread while you were still at
   * the bench looking at something else — and again on load, before anyone had
   * opened this room. Drawing them where they are shown costs the same work
   * once, at the only moment it is wanted. An entry that throws is dropped
   * rather than taking the shelf with it.
   */
  const kept = useMemo<Kept[]>(
    () =>
      saved.flatMap((s, i) => {
        try {
          return [
            {
              id: i,
              key: encodeState(s),
              state: s,
              result: render({
                library,
                fontId: s.fontId,
                chain: s.chain,
                text: wordFor(s),
                seed: s.seed,
                alternates: s.alternates,
                overrides: s.overrides,
              }),
              treatmentName: s.chain.map((c) => getTreatment(c.id).name).join(' + '),
              caption: `${s.chain.map(stepLabel).join(' + ')} · ${library[s.fontId]?.label ?? s.fontId}`,
            },
          ]
        } catch {
          return []
        }
      }),
    [library, saved],
  )

  /*
   * Delete asks first. A saved font is a session's work and there is no undo,
   * so the press that removes it opens a native modal dialog — which brings
   * its own focus trap, Escape and inert page — with Cancel focused, so a
   * stray Return keeps the font rather than losing it.
   */
  const [doomed, setDoomed] = useState<Kept | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (doomed && !dialog.current?.open) dialog.current?.showModal()
  }, [doomed])

  /*
   * Where focus goes once a font is gone. The dialog hands it back to the
   * Delete that opened it, which no longer exists, so it fell to the body and
   * a keyboard started again from the top. It goes to the card that took the
   * deleted one's place instead — the one before it at the end of the row, or
   * the way back once there is nothing left — and the deletion is said aloud.
   */
  const refocus = useRef<number | null>(null)
  const grid = useRef<HTMLDivElement>(null)
  const back = useRef<HTMLButtonElement>(null)
  const [said, setSaid] = useState('')
  useEffect(() => {
    const at = refocus.current
    if (at === null) return
    refocus.current = null
    const cards = grid.current?.querySelectorAll<HTMLButtonElement>('.saved-open')
    ;(cards?.[Math.min(at, cards.length - 1)] ?? back.current)?.focus()
  }, [kept])

  const nameOf = (k: Kept) => k.state.text || k.treatmentName

  /*
   * Each font's letters, one font per turn of the event loop.
   *
   * The names are drawn on the way in, as before; the letters follow a font
   * at a time, so the room opens at once and fills in rather than holding
   * the page while twelve fonts are treated. Filed by the encoded state, so a
   * deletion does not shift them onto the wrong card.
   */
  const [sets, setSets] = useState<Record<string, GlyphSet>>({})
  useEffect(() => {
    const next = kept.find((k) => !(k.key in sets))
    if (!next) return
    const id = setTimeout(() => {
      let set = EMPTY
      try {
        const s = next.state
        set = renderGlyphSet(library, s.fontId, s.chain, s.seed, s.overrides, SAMPLE)
      } catch {
        // a font that will not treat keeps its name and loses its letters
      }
      setSets((prev) => ({ ...prev, [next.key]: set }))
    }, 0)
    return () => clearTimeout(id)
  }, [kept, sets, library])

  const [view, setView] = useState<View>(loadView)
  const pick = (v: View) => {
    setView(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      // the view still changes; it just will not be remembered
    }
  }

  return (
    <div className="saved-view">
      <header className="saved-bar">
        <div className="saved-title">
          <h1>Saved fonts</h1>
          {/* Nothing until it matters. The count said what the cards already
              show, and the room left is not news until there is none: only a
              full shelf gets a line, because the next save will push one off. */}
          {kept.length >= SHELF_LIMIT && <p className="saved-count">Full · the oldest goes when you save another</p>}
        </div>
        {kept.length > 0 && (
          <div className="mode-switch" role="group" aria-label="Show saved fonts as">
            {(['cards', 'list'] as const).map((v) => (
              <button
                type="button"
                key={v}
                className={view === v ? 'seg is-on' : 'seg'}
                aria-pressed={view === v}
                aria-label={v === 'cards' ? 'Cards' : 'List'}
                title={v === 'cards' ? 'Cards' : 'List'}
                onClick={() => pick(v)}
              >
                {v === 'cards' ? <CardsIcon /> : <ListIcon />}
              </button>
            ))}
          </div>
        )}
        <button type="button" className="sheet-close" onClick={onClose} aria-label="Back to the workbench">
          ✕
        </button>
      </header>

      <div className="saved-body">
        {kept.length === 0 ? (
          /*
           * The empty state says what fills it, in the tool's own voice and at
           * the size the thing being described is actually shown — a line of
           * small grey text under an empty box would describe the feature
           * without showing anything of it. It is reached by deleting the
           * last one, so it also offers the way back rather than leaving that
           * to the ✕ in the corner.
           */
          <div className="saved-empty">
            <p className="saved-empty-word">Nothing saved yet</p>
            <p className="saved-empty-line">
              <b>Save font</b> keeps the font you are working on here, and it survives a reload.
              Twelve fit; the oldest drops off after that.
            </p>
            <button type="button" ref={back} onClick={onClose}>
              Back to the workbench
            </button>
          </div>
        ) : (
          <div className={view === 'list' ? 'saved-list' : 'saved-grid'} ref={grid}>
            {kept.map((k) => {
              const box = inkBox(k.result.d, k.result)
              const name = nameOf(k)
              const set = sets[k.key]
              return (
                <article className={view === 'list' ? 'saved-row' : 'saved-card'} key={k.key}>
                  {/*
                   * The whole card opens the font. One button holds the name,
                   * its letters and its line, and stretches over the card, so
                   * the press lands anywhere; Delete sits above it rather than
                   * inside, because a button cannot hold another.
                   */}
                  <button
                    type="button"
                    className="saved-open"
                    onClick={() => onRestore(k.state)}
                    aria-label={`Open ${name}, ${k.caption}`}
                  >
                    <span className="saved-ink">
                      {/* set from the left and the top, on the same edges as the
                          card's padding — a wide name leaves its spare height
                          below it, not above */}
                      <svg viewBox={box} preserveAspectRatio="xMinYMin meet" aria-hidden="true">
                        <g transform="scale(1,-1)">
                          <path d={k.result.d} />
                        </g>
                      </svg>
                    </span>
                    {/* the space is held while the letters are drawn, so nothing jumps */}
                    {view === 'list' ? (
                      <span className="saved-strip">{set && <Strip set={set} />}</span>
                    ) : (
                      <span className="saved-set">{set && <SetGrid set={set} />}</span>
                    )}
                    <span className="saved-meta">{k.caption}</span>
                  </button>
                  {/*
                   * Out of the way until you reach for it: shown on hover and
                   * on focus, and always on a touch screen, which has no hover.
                   */}
                  <button
                    type="button"
                    className="saved-delete"
                    onClick={() => setDoomed(k)}
                    aria-label={`Delete ${name}`}
                    title="Delete"
                  >
                    <TrashIcon />
                  </button>
                </article>
              )
            })}
          </div>
        )}
        <p className="visually-hidden" role="status">
          {said}
        </p>
      </div>

      <dialog
        ref={dialog}
        className="saved-confirm"
        aria-labelledby="saved-confirm-title"
        aria-describedby="saved-confirm-line"
        onClose={() => setDoomed(null)}
        onClick={(e) => {
          // a press on the backdrop lands on the dialog itself
          if (e.target === e.currentTarget) e.currentTarget.close()
        }}
      >
        <h2 id="saved-confirm-title">Delete this font?</h2>
        <p id="saved-confirm-line">
          {doomed && (
            <>
              <b>{nameOf(doomed)}</b> will be removed from your saved fonts.{' '}
            </>
          )}
          Are you sure? This can’t be undone.
        </p>
        <div className="saved-confirm-acts">
          <button type="button" autoFocus onClick={() => dialog.current?.close()}>
            Cancel
          </button>
          <button
            type="button"
            className="saved-confirm-delete"
            onClick={() => {
              if (doomed) {
                refocus.current = kept.indexOf(doomed)
                setSaid(`${nameOf(doomed)} deleted`)
                onDelete(doomed.id)
              }
              dialog.current?.close()
            }}
          >
            Delete
          </button>
        </div>
      </dialog>
    </div>
  )
}
