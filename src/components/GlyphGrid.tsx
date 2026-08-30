import { useRef } from 'react'
import type { GlyphSet } from '../lib/render'

interface Props {
  set: GlyphSet
  /** characters whose dials the panel is editing */
  selected: Set<string>
  /** characters carrying their own dial values or a reroll */
  overridden: Set<string>
  onSelect: (next: Set<string>) => void
}

const CELL_INK = 72 // px of glyph height inside each cell

/** the quick selections worth a chip — ranges over what the grid shows */
const GROUPS: { label: string; test: (ch: string) => boolean }[] = [
  { label: 'a–z', test: (ch) => ch >= 'a' && ch <= 'z' },
  { label: 'A–Z', test: (ch) => ch >= 'A' && ch <= 'Z' },
  { label: '0–9', test: (ch) => ch >= '0' && ch <= '9' },
]

/**
 * Every glyph in the face, one to a cell.
 *
 * Cells are equal and ruled so wide and narrow letters line up in columns, and
 * every glyph is drawn against the same vertical range — so ascenders,
 * x-heights and descenders sit on shared lines across the whole grid rather
 * than each letter being centred in its own box.
 *
 * The cells are also the selection surface for per-glyph dials: click to pick
 * a letter, shift-click for a run of them, and the panel's dials then edit
 * just that selection. A corner dot marks glyphs that carry their own values.
 */
export function GlyphGrid({ set, selected, overridden, onSelect }: Props) {
  const span = set.ascender - set.descender
  const scale = CELL_INK / span
  const lastIndex = useRef<number | null>(null)

  const toggle = (i: number, range: boolean) => {
    const next = new Set(selected)
    const ch = set.glyphs[i].ch
    if (range && lastIndex.current !== null) {
      const [lo, hi] = [Math.min(lastIndex.current, i), Math.max(lastIndex.current, i)]
      for (let j = lo; j <= hi; j++) next.add(set.glyphs[j].ch)
    } else if (next.has(ch)) {
      next.delete(ch)
    } else {
      next.add(ch)
    }
    lastIndex.current = i
    onSelect(next)
  }

  const pickGroup = (test: (ch: string) => boolean) => {
    const chars = set.glyphs.filter((g) => test(g.ch)).map((g) => g.ch)
    const all = chars.every((ch) => selected.has(ch))
    const next = new Set(selected)
    for (const ch of chars) {
      if (all) next.delete(ch)
      else next.add(ch)
    }
    onSelect(next)
  }

  return (
    <section className="glyphs">
      <div className="glyphs-head">
        <h2>Glyphs</h2>
        <div className="glyph-picks">
          {GROUPS.map((g) => {
            const chars = set.glyphs.filter(({ ch }) => g.test(ch))
            const on = chars.length > 0 && chars.every(({ ch }) => selected.has(ch))
            return (
              <button
                type="button"
                key={g.label}
                className={on ? 'chip is-on' : 'chip'}
                aria-pressed={on}
                onClick={() => pickGroup(g.test)}
              >
                {g.label}
              </button>
            )
          })}
          {overridden.size > 0 && (
            <button
              type="button"
              className="chip"
              onClick={() => onSelect(new Set(overridden))}
              title="Select every glyph carrying its own settings"
            >
              Overridden
            </button>
          )}
          {selected.size > 0 && (
            <button type="button" className="chip" onClick={() => onSelect(new Set())}>
              Clear
            </button>
          )}
        </div>
      </div>
      <div className="glyph-grid">
        {set.glyphs.map((g, i) => (
          <button
            type="button"
            className={[
              'glyph-cell',
              selected.has(g.ch) ? 'is-selected' : '',
              overridden.has(g.ch) ? 'is-overridden' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            key={g.ch}
            title={g.ch}
            aria-label={`Glyph ${g.ch}`}
            aria-pressed={selected.has(g.ch)}
            onClick={(e) => toggle(i, e.shiftKey)}
          >
            <svg
              width={Math.max(1, Math.round(g.adv * scale))}
              height={CELL_INK}
              viewBox={`0 ${-set.ascender} ${Math.max(1, g.adv)} ${span}`}
              aria-hidden="true"
              focusable="false"
            >
              <g transform="scale(1,-1)">
                <path d={g.d} />
              </g>
            </svg>
          </button>
        ))}
      </div>
      {selected.size === 0 && (
        <p className="glyphs-hint">Click letters to give just them their own settings.</p>
      )}
    </section>
  )
}
