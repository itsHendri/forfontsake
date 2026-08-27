import type { GlyphSet } from '../lib/render'

interface Props {
  set: GlyphSet
}

const CELL_INK = 46 // px of glyph height inside each cell

/**
 * Every glyph in the face, one to a cell.
 *
 * Cells are equal and ruled so wide and narrow letters line up in columns, and
 * every glyph is drawn against the same vertical range — so ascenders,
 * x-heights and descenders sit on shared lines across the whole grid rather
 * than each letter being centred in its own box.
 */
export function GlyphGrid({ set }: Props) {
  const span = set.ascender - set.descender
  const scale = CELL_INK / span

  return (
    <section className="glyphs">
      <h2>Glyphs</h2>
      <div className="glyph-grid">
        {set.glyphs.map((g) => (
          <div className="glyph-cell" key={g.ch} title={g.ch}>
            <svg
              width={Math.max(1, Math.round(g.adv * scale))}
              height={CELL_INK}
              viewBox={`0 ${-set.ascender} ${Math.max(1, g.adv)} ${span}`}
              role="img"
              aria-label={g.ch}
            >
              <g transform="scale(1,-1)">
                <path d={g.d} />
              </g>
            </svg>
          </div>
        ))}
      </div>
    </section>
  )
}
