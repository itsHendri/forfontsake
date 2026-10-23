import { useEffect, useMemo, useRef, useState } from 'react'
import { buildPoster, getFormat, LAYOUTS, type PosterRequest } from '../lib/poster'

interface Props {
  /** the sheet as it stands, minus the layout and the copy, which each tile sets */
  req: PosterRequest
  /** the lines each template sets, as the room has them */
  copyOf: (id: string) => string[] | undefined
  current: string
  onPick: (id: string) => void
  /** step every template that has no lines of your own to its next set in the bank */
  onShuffle: () => void
  onClose: () => void
}

/**
 * Every sheet and template at once, set in the font you made.
 *
 * The page the templates round was drawn from is an Instagram profile — a
 * grid you scroll — so this is one: three across at 4:5, the way the posts
 * will sit on the profile they are going to. It is a way to choose, not a
 * second place to edit; a tile is pressed and the room goes back to the sheet
 * with it.
 *
 * The tiles are the real engine, and on a heavy chain a paragraph template is
 * a couple of seconds of treating, so they are drawn only once on screen and
 * one at a time when the page is idle — the grid fills in rather than the
 * room freezing on the way in. A tile keeps its last picture until the new
 * one is ready, so changing colour does not flash the grid blank.
 */
export function TemplateGallery(p: Props) {
  const format = getFormat(p.req.format)
  const [shown, setShown] = useState<Record<string, string>>({})
  const made = useRef(new Map<string, string>())
  const [visible, setVisible] = useState<Set<string>>(new Set())
  const grid = useRef<HTMLDivElement>(null)
  const measureRef = useRef<() => void>(() => {})

  // What a tile's picture depends on, besides its own id and lines. The
  // picture is long, so it is fingerprinted rather than compared whole.
  const base = useMemo(() => {
    const r = p.req
    const pic = r.backdrop ? `${r.backdrop.length}:${r.backdrop.slice(-48)}` : ''
    return [
      r.fontId,
      r.seed,
      r.word,
      r.sentence ?? '',
      r.format ?? '',
      r.ground ?? '',
      pic,
      JSON.stringify(r.palette),
      JSON.stringify(r.chain),
      JSON.stringify(r.overrides ?? null),
    ].join('|')
  }, [p.req])
  const keyOf = (id: string) => `${id}|${JSON.stringify(p.copyOf(id) ?? null)}|${base}`

  // Which tiles are on screen, with a margin so the next row is ready by the
  // time it is. Measured on scroll rather than with an IntersectionObserver:
  // an observer reports from the rendering steps, which a background tab skips,
  // and a gallery that never hears which tiles are showing draws none of them.
  useEffect(() => {
    const root = grid.current
    if (!root) return
    const measure = () => {
      const box = root.getBoundingClientRect()
      const next = new Set<string>()
      root.querySelectorAll<HTMLElement>('[data-id]').forEach((el) => {
        const r = el.getBoundingClientRect()
        if (r.bottom > box.top - 400 && r.top < box.bottom + 400) next.add(el.dataset.id!)
      })
      setVisible((prev) => (prev.size === next.size && [...next].every((id) => prev.has(id)) ? prev : next))
    }
    measureRef.current = measure
    measure()
    root.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', measure)
    return () => {
      root.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
    }
  }, [])

  // one tile per idle moment, the one nearest the top first
  useEffect(() => {
    const todo = LAYOUTS.map((l) => l.id).filter((id) => {
      const have = made.current.get(keyOf(id))
      return visible.has(id) && (have === undefined || shown[id] !== have)
    })
    const id = todo.find((t) => !made.current.has(keyOf(t))) ?? todo[0]
    if (!id) return
    const key = keyOf(id)
    const cached = made.current.get(key)
    if (cached) {
      setShown((s) => ({ ...s, [id]: cached }))
      return
    }
    // Idle, but not indefinitely: the room is rarely idle — the sheet's own
    // canvas keeps the main thread warm — and without a deadline the grid took
    // half a minute to fill a second's worth of drawing.
    const idle = window.requestIdleCallback ?? ((f: () => void) => window.setTimeout(f, 16))
    const cancel = window.cancelIdleCallback ?? window.clearTimeout
    const handle = idle(() => {
      let url = ''
      try {
        const svg = buildPoster({ ...p.req, layout: id, copy: p.copyOf(id) })
        url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
      } catch {
        // a template that cannot be drawn in this font stays a blank tile
      }
      made.current.set(key, url)
      if (made.current.size > 120) made.current.delete(made.current.keys().next().value!)
      setShown((s) => ({ ...s, [id]: url }))
      // and look again: scroll events also come from the rendering steps, so
      // a tile finishing is a second chance to notice the reader has moved on
      measureRef.current()
    }, { timeout: 60 })
    return () => cancel(handle as number)
    // keyOf reads p.copyOf and base, which are what should re-run this
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, shown, base, p.copyOf])

  const groups = [
    { name: 'Sheets', items: LAYOUTS.filter((l) => l.kind === 'sheet') },
    { name: 'Templates', items: LAYOUTS.filter((l) => l.kind === 'template') },
  ]

  return (
    <section className="template-gallery" aria-label="Sheets and templates">
      <header className="gallery-bar">
        <h2>Sheets and templates</h2>
        <span className="gallery-note">Set in your font. Pick one to go back to the sheet with it.</span>
        <button type="button" onClick={p.onShuffle}>
          Shuffle copy
        </button>
        <button type="button" className="gallery-close" onClick={p.onClose} aria-label="Close the gallery">
          ×
        </button>
      </header>
      <div className="gallery-scroll" ref={grid}>
        {groups.map((g) => (
          <div key={g.name} className="gallery-group">
            <h3>{g.name}</h3>
            <div className="gallery-grid">
              {g.items.map((l) => {
                const on = l.id === p.current
                return (
                  <button
                    type="button"
                    key={l.id}
                    data-id={l.id}
                    className={`gallery-tile${on ? ' is-on' : ''}`}
                    aria-pressed={on}
                    title={l.note}
                    onClick={() => p.onPick(l.id)}
                  >
                    {shown[l.id] ? (
                      <img src={shown[l.id]} alt="" />
                    ) : (
                      <span className="gallery-blank" style={{ aspectRatio: `${format.w} / ${format.h}` }} />
                    )}
                    <span className="gallery-name">{l.name}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
