import { useEffect, useMemo, useRef, useState } from 'react'
import { getTreatment, presetMatches, type Step } from '../engine/treatments/registry'
import type { Library } from '../lib/glyphData'
import { SHELF_LIMIT } from '../lib/savedStyles'
import { render, type RenderResult } from '../lib/render'
import { wordFor, type WorkbenchState } from '../lib/urlState'

interface Kept {
  id: number
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
          <div className="saved-grid" ref={grid}>
            {kept.map((k) => {
              const pad = 40
              const box = [
                -pad,
                -k.result.ascender - pad,
                k.result.width + pad * 2,
                k.result.ascender - k.result.descender + pad * 2,
              ].join(' ')
              const name = nameOf(k)
              return (
                <article className="saved-card" key={k.id}>
                  {/*
                   * The whole card opens the font. One button holds the word
                   * and its line, and stretches over the card, so the press
                   * lands anywhere; Delete sits above it rather than inside,
                   * because a button cannot hold another.
                   */}
                  <button
                    type="button"
                    className="saved-open"
                    onClick={() => onRestore(k.state)}
                    aria-label={`Open ${name}, ${k.caption}`}
                  >
                    <span className="saved-ink">
                      {/* set from the left, on the same edge as the line under it */}
                      <svg viewBox={box} preserveAspectRatio="xMinYMid meet" aria-hidden="true">
                        <g transform="scale(1,-1)">
                          <path d={k.result.d} />
                        </g>
                      </svg>
                    </span>
                    <span className="saved-meta">{k.caption}</span>
                  </button>
                  <div className="saved-acts">
                    <button
                      type="button"
                      className="saved-delete"
                      onClick={() => setDoomed(k)}
                      aria-label={`Delete ${name}`}
                    >
                      Delete
                    </button>
                  </div>
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
