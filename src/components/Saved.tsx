import type { WorkbenchState } from '../lib/urlState'
import type { RenderResult } from '../lib/render'

export interface Kept {
  id: number
  state: WorkbenchState
  result: RenderResult
  treatmentName: string
  fontLabel: string
}

interface Props {
  kept: Kept[]
  onRestore: (state: WorkbenchState) => void
  onForget: (id: number) => void
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
export function Saved({ kept, onRestore, onForget, onClose }: Props) {
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
              return (
                <article className="saved-card" key={k.id}>
                  <div className="saved-ink">
                    <svg viewBox={box} role="img" aria-label={k.state.text || k.treatmentName}>
                      <g transform="scale(1,-1)">
                        <path d={k.result.d} />
                      </g>
                    </svg>
                  </div>
                  <p className="saved-meta">
                    {k.treatmentName} on {k.fontLabel} · seed {k.state.seed}
                  </p>
                  <div className="saved-acts">
                    <button type="button" className="save" onClick={() => onRestore(k.state)}>
                      Open
                    </button>
                    <button
                      type="button"
                      className="linkish"
                      onClick={() => onForget(k.id)}
                      aria-label={`Forget ${k.state.text || k.treatmentName}`}
                    >
                      Forget
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
