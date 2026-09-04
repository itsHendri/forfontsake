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

/**
 * The size ladder.
 *
 * The number sits *above* each line rather than in a gutter beside it, which
 * is what every foundry that shows a size at all does — Fontshare and Google
 * Fonts both put the label at the identical x as the specimen. A gutter reads
 * as a column and pushes the type off the page grid, so the one block on the
 * page made entirely of the thing being sold is the one block that does not
 * line up with anything above it.
 */
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
        return (
          <div className="fall-row" key={px}>
            <span className="fall-size">{px} px</span>
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
