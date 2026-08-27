import type { RenderResult } from '../lib/render'

const SIZES = [
  { label: '48 px', px: 48 },
  { label: '28 px', px: 28 },
  { label: '17 px', px: 17 },
  { label: '11 px', px: 11 },
]

interface Props {
  result: RenderResult
  text: string
}

function viewBox(r: RenderResult, pad = 40) {
  return [-pad, -r.ascender - pad, r.width + pad * 2, r.ascender - r.descender + pad * 2].join(' ')
}

export function Stage({ result, text }: Props) {
  // font space is y-up, so one flip here serves every view of the same path
  const box = viewBox(result)
  const path = <path d={result.d} />

  return (
    <>
      <div className="stage">
        <svg viewBox={box} role="img" aria-label={`${text} in the current treatment`}>
          <g transform="scale(1,-1)">{path}</g>
        </svg>
      </div>

      <div className="meta">
        <span>
          contours <b>{result.contours}</b>
        </span>
        <span>
          redraw <b>{Math.round(result.ms)} ms</b>
        </span>
      </div>

      <section className="sizes">
        <h2>Same font, smaller</h2>
        <div className="size-grid">
          {SIZES.map((s) => {
            // the same geometry shown small, so this costs no extra work
            const scale = s.px / (result.ascender - result.descender)
            return (
              <div className="size-cell" key={s.px}>
                <span>{s.label}</span>
                <svg
                  viewBox={box}
                  width={Math.round(result.width * scale)}
                  height={s.px}
                  role="img"
                  aria-label={`${text} at ${s.label}`}
                >
                  <g transform="scale(1,-1)">{path}</g>
                </svg>
              </div>
            )
          })}
        </div>
      </section>
    </>
  )
}
