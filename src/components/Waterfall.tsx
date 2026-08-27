import type { RenderResult } from '../lib/render'

/**
 * Eight-point grid. The small end is the one that matters: erosion that looks
 * deliberate at 96 closes counters at 12, and this is where you catch it.
 */
const SIZES = [96, 64, 48, 32, 24, 16, 12]

interface Props {
  result: RenderResult
  text: string
}

export function Waterfall({ result, text }: Props) {
  if (!result.d) return null
  const span = result.ascender - result.descender
  const box = `0 ${-result.ascender} ${result.width} ${span}`

  return (
    <section className="waterfall">
      <h2>Sizes</h2>
      {SIZES.map((px) => {
        // the same geometry at every size, so the whole column costs one redraw
        const scale = px / result.unitsPerEm
        // the number sits on the same baseline as the line it measures, rather
        // than floating at the top or bottom of a row that is mostly air
        const baseline = result.ascender * scale
        return (
          <div className="fall-row" key={px}>
            <span className="fall-size" style={{ marginTop: Math.max(0, baseline - 8) }}>
              {px}
            </span>
            <div className="fall-ink">
              <svg
                width={Math.max(1, Math.round(result.width * scale))}
                height={Math.max(1, Math.round(span * scale))}
                viewBox={box}
                role="img"
                aria-label={`${text} at ${px} pixels`}
              >
                <g transform="scale(1,-1)">
                  <path d={result.d} />
                </g>
              </svg>
            </div>
          </div>
        )
      })}
    </section>
  )
}
