import { useEffect, useMemo, useRef, useState } from 'react'
import { getTreatment } from '../engine/treatments/registry'
import type { Library } from '../lib/glyphData'
import { render, type RenderResult } from '../lib/render'
import { wordFor, type WorkbenchState } from '../lib/urlState'

interface Kept {
  id: number
  state: WorkbenchState
  result: RenderResult
  treatmentName: string
  fontLabel: string
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
              fontLabel: library[s.fontId]?.label ?? s.fontId,
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

  return (
    <div className="saved-view">
      <header className="saved-bar">
        <h1>Saved fonts</h1>
        <p className="saved-count">
          {kept.length === 0 ? 'nothing yet' : `${kept.length} of 12`}
        </p>
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
           * without showing anything of it.
           */
          <div className="saved-empty">
            <p className="saved-empty-word">Nothing saved yet</p>
            <p className="saved-empty-line">
              <b>Save font</b> keeps the font you are working on here, and it survives a reload.
              Twelve fit; the oldest drops off after that.
            </p>
          </div>
        ) : (
          <div className="saved-grid">
            {kept.map((k) => {
              const pad = 40
              const box = [
                -pad,
                -k.result.ascender - pad,
                k.result.width + pad * 2,
                k.result.ascender - k.result.descender + pad * 2,
              ].join(' ')
              const name = k.state.text || k.treatmentName
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
                    aria-label={`Open ${name}`}
                  >
                    <span className="saved-ink">
                      <svg viewBox={box} aria-hidden="true">
                        <g transform="scale(1,-1)">
                          <path d={k.result.d} />
                        </g>
                      </svg>
                    </span>
                    <span className="saved-meta">
                      {k.treatmentName} on {k.fontLabel} · seed {k.state.seed}
                    </span>
                  </button>
                  <div className="saved-acts">
                    <button
                      type="button"
                      className="linkish saved-delete"
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
              <b>{doomed.state.text || doomed.treatmentName}</b> will be removed from your saved
              fonts.{' '}
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
              if (doomed) onDelete(doomed.id)
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
