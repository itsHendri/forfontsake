import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RenderResult } from '../lib/render'
import type { Library } from '../lib/glyphData'
import type { Treatment } from '../engine/treatments/registry'
import { FONT_ACCEPT } from '../lib/importFont'

interface Props {
  library: Library
  treatments: Treatment[]
  fontId: string
  treatment: Treatment
  text: string
  result: RenderResult
  onFont: (id: string) => void
  onTreatment: (id: string) => void
  onText: (text: string) => void
  onUpload: (file: File) => void
  /** set while a dropped font is being read, so the control can say so */
  importing: boolean
}

/**
 * The specimen and its controls in one object.
 *
 * The big line is not a preview of an input somewhere else — it *is* the input.
 * A transparent text field lies over the treated outlines, so the caret,
 * selection, click-to-position and every keyboard and IME behaviour are the
 * browser's own. That only works if the field lays its text out on the same
 * advance widths the outlines were drawn with, which is why the source font is
 * loaded as a metrics-only subset (`public/fonts/preview/`) and applied here.
 * Treatments preserve advance widths, so the two agree glyph for glyph.
 */
export function Plate(p: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const probeRef = useRef<HTMLSpanElement>(null)
  const strutRef = useRef<HTMLSpanElement>(null)

  // measured rather than derived: the type size comes from CSS (so it stays
  // responsive) and the baseline from real layout (so no font-metric guesswork)
  const [metrics, setMetrics] = useState({ px: 64, baseline: 64, boxWidth: 0 })

  useLayoutEffect(() => {
    const measure = () => {
      const input = inputRef.current
      const probe = probeRef.current
      const strut = strutRef.current
      const box = boxRef.current
      if (!input || !probe || !strut || !box) return
      const px = parseFloat(getComputedStyle(input).fontSize) || 64
      const baseline = strut.getBoundingClientRect().top - probe.getBoundingClientRect().top
      const boxWidth = box.clientWidth
      setMetrics((m) =>
        m.px === px && Math.abs(m.baseline - baseline) < 0.5 && m.boxWidth === boxWidth
          ? m
          : { px, baseline, boxWidth },
      )
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (boxRef.current) ro.observe(boxRef.current)
    return () => ro.disconnect()
  }, [p.fontId])

  // a webfont arriving after first paint changes the metrics under us
  useEffect(() => {
    let live = true
    document.fonts?.ready.then(() => {
      if (!live) return
      const probe = probeRef.current
      const strut = strutRef.current
      if (!probe || !strut) return
      const baseline = strut.getBoundingClientRect().top - probe.getBoundingClientRect().top
      setMetrics((m) => (Math.abs(m.baseline - baseline) < 0.5 ? m : { ...m, baseline }))
    })
    return () => {
      live = false
    }
  }, [p.fontId])

  const family = `"ffs-${p.fontId}", ui-monospace, monospace`
  const scale = metrics.px / p.result.unitsPerEm
  const inkWidth = Math.max(1, p.result.width * scale)
  const inkHeight = Math.max(1, (p.result.ascender - p.result.descender) * scale)
  // the field is stretched to the ink so it never scrolls independently — the
  // container does the scrolling, and the two stay locked together
  const lineWidth = Math.max(inkWidth, metrics.boxWidth)

  return (
    <section className="plate">
      <div className="plate-bar">
        <label className="visually-hidden" htmlFor="font">
          Font
        </label>
        <select id="font" value={p.fontId} onChange={(e) => p.onFont(e.target.value)}>
          {Object.entries(p.library).map(([id, f]) => (
            <option key={id} value={id}>
              {f.label}
            </option>
          ))}
        </select>

        <label className="visually-hidden" htmlFor="treatment">
          Treatment
        </label>
        <select
          id="treatment"
          value={p.treatment.id}
          onChange={(e) => p.onTreatment(e.target.value)}
        >
          {p.treatments.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>

        {/*
          A label rather than a button, because the file input has to be the
          thing that is clicked — a button that forwards a click to a hidden
          input works until a keyboard or a screen reader meets it.
        */}
        <label className={p.importing ? 'upload is-busy' : 'upload'}>
          {p.importing ? 'Reading…' : 'Use your own'}
          <input
            type="file"
            accept={FONT_ACCEPT}
            disabled={p.importing}
            onChange={(e) => {
              const file = e.target.files?.[0]
              // cleared so choosing the same file twice still fires
              e.target.value = ''
              if (file) p.onUpload(file)
            }}
          />
        </label>

        <p className="plate-note">{p.treatment.blurb}</p>
      </div>

      <div className="plate-type" ref={boxRef}>
        <div className="type-line" style={{ width: lineWidth }}>
          <span
            className="type-probe"
            ref={probeRef}
            aria-hidden="true"
            style={{ fontFamily: family }}
          >
            H<span className="type-strut" ref={strutRef} />
          </span>

          {p.result.d && (
            <svg
              className="type-ink"
              width={inkWidth}
              height={inkHeight}
              viewBox={`0 ${-p.result.ascender} ${p.result.width} ${p.result.ascender - p.result.descender}`}
              style={{ top: metrics.baseline - p.result.ascender * scale }}
              aria-hidden="true"
              focusable="false"
            >
              <g transform="scale(1,-1)">
                <path d={p.result.d} />
              </g>
            </svg>
          )}

          <input
            className="type-input"
            ref={inputRef}
            type="text"
            value={p.text}
            onChange={(e) => p.onText(e.target.value)}
            style={{ fontFamily: family }}
            placeholder="Type here"
            aria-label="Specimen text"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
          />
        </div>
      </div>
    </section>
  )
}
