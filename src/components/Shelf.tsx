import type { WorkbenchState } from '../lib/urlState'
import type { RenderResult } from '../lib/render'

export interface Kept {
  id: number
  state: WorkbenchState
  result: RenderResult
  treatmentName: string
}

interface Props {
  kept: Kept[]
  onRestore: (state: WorkbenchState) => void
  onForget: (id: number) => void
}

/**
 * Somewhere for results worth returning to. Without this a good result is lost
 * the moment the seed moves, which makes Randomise feel expensive to press.
 */
export function Shelf({ kept, onRestore, onForget }: Props) {
  if (kept.length === 0) return null

  return (
    <section className="shelf">
      <h2>Saved styles</h2>
      <div className="shelf-strip">
        {kept.map((k) => {
          const pad = 40
          const box = [
            -pad,
            -k.result.ascender - pad,
            k.result.width + pad * 2,
            k.result.ascender - k.result.descender + pad * 2,
          ].join(' ')
          return (
            <div className="kept" key={k.id}>
              <button type="button" onClick={() => onRestore(k.state)} title="Restore this style">
                <svg viewBox={box} height="44" role="img" aria-label={`Restore ${k.state.text}`}>
                  <g transform="scale(1,-1)">
                    <path d={k.result.d} />
                  </g>
                </svg>
                <span>
                  {k.treatmentName} · {k.state.seed}
                </span>
              </button>
              <button
                type="button"
                className="forget"
                onClick={() => onForget(k.id)}
                aria-label={`Forget ${k.state.text}`}
                title="Forget"
              >
                ×
              </button>
            </div>
          )
        })}
      </div>
    </section>
  )
}
