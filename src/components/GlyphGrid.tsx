import { memo, useMemo, useRef } from 'react'
import type { GlyphSet } from '../lib/render'

interface Props {
  set: GlyphSet
  /** characters whose dials the panel is editing */
  selected: Set<string>
  /** characters carrying their own dial values or a reroll */
  overridden: Set<string>
  onSelect: (next: Set<string>) => void
  /** the dials have moved and this set is the one before them */
  settling?: boolean
}

const CELL_INK = 72 // px of glyph height inside each cell
const CHIP_INK = 30 // px of glyph height inside a range chip

/**
 * The quick selections worth a chip — ranges over what the grid shows, each
 * with the three letters that stand for it.
 *
 * A range is a picture of itself for the same reason a preset is: the thing
 * that tells you what `a–z` means under this style is the letters under this
 * style. `sample` is what gets drawn; `test` is what gets selected.
 */
const GROUPS: { label: string; sample: string; test: (ch: string) => boolean }[] = [
  { label: 'a–z', sample: 'abc', test: (ch) => ch >= 'a' && ch <= 'z' },
  { label: 'A–Z', sample: 'ABC', test: (ch) => ch >= 'A' && ch <= 'Z' },
  { label: '0–9', sample: '012', test: (ch) => ch >= '0' && ch <= '9' },
]

/**
 * A range's letters, laid out from glyphs the grid has already drawn.
 *
 * Deliberately not a `render()` call. The grid above treats all sixty-nine
 * glyphs on every rebuild, so the letters these chips want are sitting in the
 * set already — laying three of them out by their own advances costs nothing
 * and, more usefully, cannot disagree with the grid or arrive a beat after it.
 */
function sampleOf(set: GlyphSet, chars: string) {
  const parts: { d: string; x: number }[] = []
  let x = 0
  for (const ch of chars) {
    const g = set.glyphs.find((it) => it.ch === ch)
    if (!g) continue
    parts.push({ d: g.d, x })
    x += g.adv
  }
  return parts.length > 0 ? { parts, width: x } : null
}

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
function GlyphGridInner({ set, selected, overridden, onSelect, settling }: Props) {
  const span = set.ascender - set.descender
  const scale = CELL_INK / span
  const lastIndex = useRef<number | null>(null)

  // memoised on the set, so selecting a letter does not relay the samples
  const samples = useMemo(() => {
    const out: Record<string, ReturnType<typeof sampleOf>> = {}
    for (const g of GROUPS) out[g.label] = sampleOf(set, g.sample)
    return out
  }, [set])

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
    <section className={settling ? 'glyphs is-settling' : 'glyphs'}>
      <div className="glyphs-head">
        <h2 className="head-with-tip">
          Glyphs
          {/* what the grid is for, asked rather than announced — the standing
              line under it said the same thing to everybody forever, including
              the people already using the feature */}
          <span className="with-tip ctl-info">
            <button type="button" className="info-btn" aria-label="About the glyph grid">
              i
            </button>
            <span className="tip" role="tooltip">
              Click letters to give just them their own settings. Shift-click for a run of them.
            </span>
          </span>
        </h2>
        <div className="glyph-picks">
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
          {/* Always here, dead until there is something to clear. It used to
              appear with the first selection and push the row along under the
              pointer, so the control you were reaching for moved as you
              selected. */}
          <button
            type="button"
            className="chip"
            onClick={() => onSelect(new Set())}
            disabled={selected.size === 0}
          >
            Clear
          </button>
        </div>
      </div>
      {/*
        The ranges, drawn as themselves. They were three words in boxes, which
        said what would be selected but nothing about what it looks like — and
        this is the one tool that never has to fake that picture.
      */}
      <div className="glyph-sets">
        {GROUPS.map((g) => {
          const chars = set.glyphs.filter(({ ch }) => g.test(ch))
          const on = chars.length > 0 && chars.every(({ ch }) => selected.has(ch))
          const sample = samples[g.label]
          return (
            <button
              type="button"
              key={g.label}
              className={on ? 'glyph-set is-on' : 'glyph-set'}
              aria-pressed={on}
              onClick={() => pickGroup(g.test)}
            >
              <span className="glyph-set-ink">
                {sample && (
                  <svg
                    height={CHIP_INK}
                    viewBox={`0 ${-set.ascender} ${sample.width} ${span}`}
                    aria-hidden="true"
                    focusable="false"
                  >
                    <g transform="scale(1,-1)">
                      {sample.parts.map((p, i) => (
                        <path key={i} d={p.d} transform={`translate(${p.x} 0)`} />
                      ))}
                    </g>
                  </svg>
                )}
              </span>
              <span className="glyph-set-name">{g.label}</span>
            </button>
          )
        })}
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
    </section>
  )
}

/**
 * Sixty-nine cells is the most expensive block on the page to reconcile, and
 * nothing but its own four props can change what it draws.
 */
export const GlyphGrid = memo(GlyphGridInner)
