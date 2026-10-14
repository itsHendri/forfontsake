import { useEffect, useMemo, useRef } from 'react'
import type { FontData } from '../lib/glyphData'
import type { GlyphResult, GlyphSet, RenderResult } from '../lib/render'
import { FOCUS_MAX, codePoint, glyphName, type FocusMode } from '../lib/focus'

interface Props {
  mode: FocusMode
  onMode: (mode: FocusMode) => void
  /** what is being edited, in the grid's order */
  chars: string[]
  /** the same letters, live — redrawn on every dial move */
  live: GlyphSet | null
  /** the focused letter as the style alone draws it, for Compare */
  style: GlyphSet | null
  /** the letters among their neighbours */
  context: RenderResult | null
  /** the untreated face, for the guides */
  font: FontData
  /** every glyph, for the filmstrip — the grid's own set */
  all: GlyphSet | null
  selected: Set<string>
  overridden: Set<string>
  onSelect: (next: Set<string>) => void
  onRerollOne: (ch: string) => void
  onClose: () => void
  /** the dials — the workbench's own panel, scoped to the selection as it always is */
  rail: React.ReactNode
}

/** the face's own lines, measured from its untreated letters rather than assumed */
function guidesOf(font: FontData) {
  const top = (ch: string) => {
    const g = font.glyphs[ch]
    if (!g) return null
    let m = -Infinity
    for (const r of g.rings) for (let i = 1; i < r.length; i += 2) m = Math.max(m, r[i])
    return Number.isFinite(m) ? m : null
  }
  const bottom = (ch: string) => {
    const g = font.glyphs[ch]
    if (!g) return null
    let m = Infinity
    for (const r of g.rings) for (let i = 1; i < r.length; i += 2) m = Math.min(m, r[i])
    return Number.isFinite(m) ? m : null
  }
  const out: { name: string; y: number }[] = []
  const cap = top('H')
  const x = top('x')
  const desc = bottom('p')
  if (cap !== null) out.push({ name: 'cap', y: cap })
  if (x !== null) out.push({ name: 'x-height', y: x })
  out.push({ name: 'baseline', y: 0 })
  if (desc !== null) out.push({ name: 'descender', y: desc })
  return out
}

/**
 * One glyph on the face's guides.
 *
 * Every glyph is drawn in the same vertical frame — the font's ascender to its
 * descender — so stepping from letter to letter keeps the baseline still and
 * only the letter changes. The width is the wider of the glyph and an em, so a
 * narrow letter stands in space rather than being blown up to fill it.
 */
function GlyphView({
  glyphs,
  font,
  labels,
}: {
  /** drawn over one another, first underneath — Compare's overlay is two */
  glyphs: { g: GlyphResult; ghost?: boolean }[]
  font: FontData
  labels?: boolean
}) {
  const guides = useMemo(() => guidesOf(font), [font])
  if (glyphs.length === 0) return null
  const em = font.unitsPerEm
  const adv = Math.max(...glyphs.map(({ g }) => g.adv))
  const w = Math.max(adv, em) * 1.3
  const x0 = adv / 2 - w / 2
  const pad = em * 0.08
  const top = -font.ascender - pad
  const h = font.ascender - font.descender + pad * 2
  return (
    <svg viewBox={`${x0} ${top} ${w} ${h}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {guides.map((l) => (
        <g key={l.name}>
          <line
            x1={x0}
            x2={x0 + w}
            y1={-l.y}
            y2={-l.y}
            className={l.name === 'baseline' ? 'focus-guide is-base' : 'focus-guide'}
            vectorEffect="non-scaling-stroke"
          />
          {labels && (
            <text x={x0 + w - em * 0.02} y={-l.y - em * 0.02} textAnchor="end" className="focus-guide-label" fontSize={em * 0.035}>
              {l.name}
            </text>
          )}
        </g>
      ))}
      {glyphs.map(({ g, ghost }, i) => (
        <path key={i} d={g.d} transform="scale(1,-1)" className={ghost ? 'focus-ghost' : undefined} />
      ))}
    </svg>
  )
}

/**
 * Focus: the letters you are editing, large enough to see the change.
 *
 * A room over the bench, like a lightbox over a contact sheet: the grid
 * picks, this looks. Three ways of looking, the way Lightroom splits Loupe,
 * Survey and Compare — One letter on its guides, Several side by side, and
 * Compare, the style's version beside this letter's own. The dials on the
 * right are the bench's own panel, scoped to the selection exactly as it is
 * there, so nothing here writes anything the grid does not already write.
 */
export function Focus(p: Props) {
  const lead = p.chars[0]
  const glyph = (set: GlyphSet | null, ch: string) => set?.glyphs.find((g) => g.ch === ch) ?? null

  // Escape leaves; ← → step through the face in One. Not while a dial or a
  // field has the keys — a range input moves on its own arrows.
  const order = useMemo(() => p.all?.glyphs.map((g) => g.ch) ?? [], [p.all])
  const latest = useRef(p)
  useEffect(() => {
    latest.current = p
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const q = latest.current
      const t = e.target instanceof Element ? e.target : null
      const typing = t?.closest('input, textarea, select, [contenteditable="true"]')
      if (e.key === 'Escape') {
        if (t?.closest('[role="menu"]')) return
        e.preventDefault()
        q.onClose()
        return
      }
      if (typing || q.mode !== 'one') return
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const at = order.indexOf(q.chars[0])
      if (at < 0) return
      const next = order[(at + (e.key === 'ArrowRight' ? 1 : order.length - 1)) % order.length]
      e.preventDefault()
      q.onSelect(new Set([next]))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [order])

  // the bench underneath does not scroll while this is over it
  useEffect(() => {
    const was = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = was
    }
  }, [])

  const step = (dir: 1 | -1) => {
    const at = order.indexOf(lead)
    if (at < 0) return
    p.onSelect(new Set([order[(at + dir + order.length) % order.length]]))
  }

  const title = p.chars.length === 1 ? lead : p.chars.slice(0, 8).join(' ') + (p.chars.length > 8 ? ' …' : '')
  const detail =
    p.chars.length === 1
      ? `${glyphName(lead)} · ${codePoint(lead)} · ${order.indexOf(lead) + 1} of ${order.length}`
      : `${p.chars.length} letters${p.chars.length > FOCUS_MAX ? ` · the first ${FOCUS_MAX} shown` : ''}`

  const contextBox = p.context
    ? `0 ${-p.context.ascender} ${Math.max(1, p.context.width)} ${p.context.ascender - p.context.descender}`
    : null

  return (
    <div className="focus-view" role="dialog" aria-modal="true" aria-label={`Focus: ${title}`}>
      <header className="focus-bar">
        <div className="focus-title">
          <b>{title}</b>
          <span>{detail}</span>
        </div>
        <div className="mode-switch" role="group" aria-label="How to look">
          {(
            [
              ['one', 'One'],
              ['several', 'Several'],
              ['compare', 'Compare'],
            ] as const
          ).map(([id, label]) => (
            <button
              type="button"
              key={id}
              className={p.mode === id ? 'seg is-on' : 'seg'}
              aria-pressed={p.mode === id}
              disabled={id === 'several' && p.chars.length < 2}
              onClick={() => p.onMode(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <button type="button" className="sheet-close" onClick={p.onClose} aria-label="Back to the workbench">
          ✕
        </button>
      </header>

      <div className="focus-body">
        <div className="focus-stage">
          {p.mode === 'one' && (
            <div className="focus-one">
              <button type="button" className="focus-step" onClick={() => step(-1)} aria-label="Previous letter">
                ‹
              </button>
              <div className="focus-big">
                {glyph(p.live, lead) && <GlyphView glyphs={[{ g: glyph(p.live, lead)! }]} font={p.font} labels />}
              </div>
              <button type="button" className="focus-step" onClick={() => step(1)} aria-label="Next letter">
                ›
              </button>
            </div>
          )}

          {p.mode === 'several' && (
            <div className="focus-tiles">
              {p.chars.slice(0, FOCUS_MAX).map((ch) => {
                const g = glyph(p.live, ch)
                return (
                  <div className="focus-tile" key={ch}>
                    {/* a tile opens its letter in One */}
                    <button
                      type="button"
                      className="focus-tile-open"
                      onClick={() => {
                        p.onSelect(new Set([ch]))
                        p.onMode('one')
                      }}
                      aria-label={`Look at ${glyphName(ch)} alone`}
                    >
                      {g && <GlyphView glyphs={[{ g }]} font={p.font} />}
                    </button>
                    <button
                      type="button"
                      className="focus-tile-act is-reroll"
                      onClick={() => p.onRerollOne(ch)}
                      aria-label={`Reroll ${glyphName(ch)}`}
                      title="Reroll this letter"
                    >
                      ↻
                    </button>
                    <button
                      type="button"
                      className="focus-tile-act is-drop"
                      onClick={() => {
                        const next = new Set(p.selected)
                        next.delete(ch)
                        p.onSelect(next)
                      }}
                      aria-label={`Take ${glyphName(ch)} out of the batch`}
                      title="Take out of the batch"
                    >
                      ✕
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {p.mode === 'compare' && (
            <div className="focus-compare">
              {(
                [
                  ['The style', [{ g: glyph(p.style, lead) }]],
                  ['This letter', [{ g: glyph(p.live, lead) }]],
                  ['Over the style', [{ g: glyph(p.style, lead), ghost: true }, { g: glyph(p.live, lead) }]],
                ] as const
              ).map(([label, gs]) => (
                <figure key={label}>
                  <figcaption className={label === 'This letter' ? 'is-mark' : undefined}>{label}</figcaption>
                  <div className="focus-col">
                    {gs.every((x) => x.g) && (
                      <GlyphView glyphs={gs.map((x) => ({ g: x.g!, ghost: 'ghost' in x && x.ghost }))} font={p.font} />
                    )}
                  </div>
                </figure>
              ))}
              {p.chars.length > 1 && <p className="focus-note">Comparing {glyphName(lead)}, the first of the batch.</p>}
            </div>
          )}

          {/* among its neighbours: a letter is judged in a word */}
          {p.context && contextBox && (
            <div className="focus-context">
              <span className="focus-label">In context</span>
              <svg viewBox={contextBox} preserveAspectRatio="xMinYMid meet" aria-hidden="true">
                <g transform="scale(1,-1)">
                  <path d={p.context.d} />
                </g>
              </svg>
            </div>
          )}

          {/* every other letter, one press away; Shift adds to the batch */}
          {p.all && (
            <div className="focus-strip" role="group" aria-label="Every letter">
              {p.all.glyphs.map((g) => {
                const on = p.selected.has(g.ch)
                return (
                  <button
                    type="button"
                    key={g.ch}
                    className={['focus-thumb', on ? 'is-on' : '', p.overridden.has(g.ch) ? 'is-overridden' : '']
                      .filter(Boolean)
                      .join(' ')}
                    aria-pressed={on}
                    aria-label={glyphName(g.ch)}
                    onClick={(e) => {
                      if (e.shiftKey) {
                        const next = new Set(p.selected)
                        if (next.has(g.ch) && next.size > 1) next.delete(g.ch)
                        else next.add(g.ch)
                        p.onSelect(next)
                        if (next.size > 1 && p.mode === 'one') p.onMode('several')
                      } else {
                        p.onSelect(new Set([g.ch]))
                        if (p.mode === 'several') p.onMode('one')
                      }
                    }}
                  >
                    <svg
                      viewBox={`0 ${-p.all!.ascender} ${Math.max(1, g.adv)} ${p.all!.ascender - p.all!.descender}`}
                      aria-hidden="true"
                    >
                      <g transform="scale(1,-1)">
                        <path d={g.d} />
                      </g>
                    </svg>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <aside className="focus-rail">{p.rail}</aside>
      </div>
    </div>
  )
}
