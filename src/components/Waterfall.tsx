import { memo } from 'react'
import type { RenderResult } from '../lib/render'

/**
 * Eight-point grid. The small end is the one that matters: erosion that looks
 * deliberate at 96 closes counters at 12, and this is where you catch it.
 */
const SIZES = [96, 64, 48, 32, 24, 16, 12]

/** the one outline every rung points at */
const FALL_ID = 'ffs-fall'

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
function WaterfallInner({ result, text }: Props) {
  if (!result.d) return null
  const span = result.ascender - result.descender
  const box = `0 ${-result.ascender} ${result.width} ${span}`

  return (
    <section className="waterfall">
      <h2>Sizes</h2>
      {/*
        The outline is written once and referenced seven times.
        
        It used to be seven copies of the same `d`, which on a treated word is
        forty kilobytes each: the browser parsed and rasterised the whole thing
        seven times over on every dial tick, for a column that shows one
        drawing at seven scales. The defs carrier is zero-sized rather than
        `display: none`, which stops Safari rendering referenced content.
      */}
      <svg width="0" height="0" className="fall-defs" aria-hidden="true" focusable="false">
        <defs>
          <path id={FALL_ID} d={result.d} />
        </defs>
      </svg>
      {SIZES.map((px) => {
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
                  <use href={`#${FALL_ID}`} />
                </g>
              </svg>
            </div>
          </div>
        )
      })}
    </section>
  )
}

/**
 * Re-rendered only when the geometry or the word changes — the ladder is the
 * most expensive block on the page to reconcile and has nothing to say about
 * the dials, the selection or the panel.
 */
export const Waterfall = memo(WaterfallInner)
