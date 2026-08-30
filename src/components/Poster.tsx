import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  buildPoster,
  chainName,
  LAYOUTS,
  POSTER_PALETTES,
  SHEET_W,
  SHEET_H,
  type WordTransform,
} from '../lib/poster'
import { saveFile } from '../lib/exportFont'
import { copyText } from '../lib/clipboard'
import { getTreatment } from '../engine/treatments/registry'
import { AudioEngine } from '../audio/AudioEngine'
import { createLoopSource, createMicSource } from '../audio/sources'
import type { AudioFrame } from '../audio/frame'
import type { FontData } from '../lib/glyphData'
import type { Overrides, Step } from '../lib/urlState'

interface Props {
  font: FontData
  fontId: string
  chain: Step[]
  overrides?: Overrides
  seed: number
  word: string
  onClose: () => void
}

const IDENTITY: WordTransform = { dx: 0, dy: 0, scale: 1 }

/**
 * The dials, ridden by the sound.
 *
 * Each step's primary dials are driven in declared order by bass (with a kick
 * on the beat), mids, highs and overall level — set point plus up to 35% of
 * the dial's span, snapped to its step and clamped to its range. The seed is
 * never touched: this is pure parameter modulation, so the frame you capture
 * is exactly reproducible from the values it was drawn with.
 */
function modulate(chain: Step[], f: AudioFrame): Step[] {
  const drive = [Math.min(1, f.bass + f.beat * 0.5), f.mid, f.high, f.level]
  return chain.map((step) => {
    const primary = getTreatment(step.id).params.filter((s) => s.primary)
    const params = { ...step.params }
    primary.slice(0, drive.length).forEach((spec, i) => {
      const span = spec.max - spec.min
      const raw = (step.params[spec.key] ?? spec.default) + drive[i] * 0.35 * span
      const snapped = Math.round(raw / spec.step) * spec.step
      params[spec.key] = Math.min(spec.max, Math.max(spec.min, snapped))
    })
    return { id: step.id, params }
  })
}

// the geometry rebuild is throttled well below the audio tick: the heavy
// treatments cost tens of milliseconds per word, and a sheet pulsing at
// ~10 Hz reads as alive where one stuttering at 60 reads as broken
const TICK_MS = 90
const TICK_MS_HEAVY = 160
const HEAVY = new Set(['growth', 'mosaic'])

/**
 * The specimen sheet, as a thing you can take away.
 *
 * A workbench screenshot is a picture of software. The same letters set on a
 * numbered sheet is a specimen, which is the form a foundry has always
 * published in — and it is the artefact somebody actually wants to post.
 * Randomise and Recolour are here rather than in the panel because they belong
 * to the sheet, not to the font. The word itself can be dragged and resized:
 * the sheet is a layout the user finishes, not a template they receive.
 */
export function Poster(p: Props) {
  const [sheetSeed, setSheetSeed] = useState(p.seed)
  const [paletteIndex, setPaletteIndex] = useState(0)
  const [layoutIndex, setLayoutIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [wordT, setWordT] = useState<WordTransform>(IDENTITY)

  const sheetRef = useRef<HTMLDivElement>(null)
  // a drag in flight: committed transform at pointerdown, plus where it started
  const dragRef = useRef<{ startX: number; startY: number; base: WordTransform } | null>(null)
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // wheel events arrive in bursts faster than the commit; accumulate here
  const pendingScale = useRef<number | null>(null)

  // Sound. The engine is created in a click handler, never on mount — an
  // AudioContext made outside a user gesture starts suspended, and StrictMode
  // would make one twice.
  const [soundSource, setSoundSource] = useState<'loop' | 'mic' | null>(null)
  const [modChain, setModChain] = useState<Step[] | null>(null)
  const engineRef = useRef<AudioEngine | null>(null)
  const rafRef = useRef<number | null>(null)
  // how long the last sheet took to build, so the tick can back off adaptively
  const buildCost = useRef(0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && p.onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [p])

  const stopSound = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    engineRef.current?.setSource(null)
    setSoundSource(null)
    setModChain(null)
  }, [])

  // the overlay closing takes the sound with it
  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      engineRef.current?.dispose()
      engineRef.current = null
    },
    [],
  )

  const startTicking = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    const tier = p.chain.some((s) => HEAVY.has(s.id)) ? TICK_MS_HEAVY : TICK_MS
    let last = performance.now()
    let lastBuild = 0
    const loop = (now: number) => {
      const engine = engineRef.current
      if (!engine) return
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      // tick every frame so the envelopes and detectors stay accurate...
      const frame = engine.tick(dt)
      // ...but rebuild the geometry at a pace the chain can afford
      if (now - lastBuild >= Math.max(tier, buildCost.current * 2)) {
        lastBuild = now
        setModChain(modulate(p.chain, frame))
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
  }, [p.chain])

  const startSound = async (kind: 'loop' | 'mic') => {
    setNote(null)
    try {
      const engine = engineRef.current ?? new AudioEngine()
      engineRef.current = engine
      await engine.resume()
      const source =
        kind === 'loop' ? await createLoopSource(engine.context) : await createMicSource(engine.context)
      engine.setSource(source)
      setSoundSource(kind)
      startTicking()
    } catch (e) {
      stopSound()
      setNote(e instanceof Error ? e.message : String(e))
    }
  }

  const palette = POSTER_PALETTES[paletteIndex % POSTER_PALETTES.length]
  const layout = LAYOUTS[layoutIndex % LAYOUTS.length]
  // the number is the seed's, so the same sheet always carries the same one
  const number = (sheetSeed % 999) + 1

  // the sound rides the word sheet only — 69 glyphs re-treated at 10 Hz is
  // more than the heavy chains can afford
  useEffect(() => {
    if (layout.id !== 'word') stopSound()
  }, [layout.id, stopSound])

  const sheetChain = layout.id === 'word' && modChain ? modChain : p.chain

  const svg = useMemo(() => {
    const t0 = performance.now()
    const out = buildPoster({
      font: p.font,
      fontId: p.fontId,
      chain: sheetChain,
      overrides: p.overrides,
      seed: sheetSeed,
      word: p.word,
      layout: layout.id,
      palette,
      number,
      wordTransform: wordT,
    })
    buildCost.current = performance.now() - t0
    return out
  }, [p.font, p.fontId, sheetChain, p.overrides, sheetSeed, p.word, layout.id, palette, number, wordT])

  const stem = `forfontsake-${p.chain.map((c) => c.id).join('-')}-${layout.id}-${String(number).padStart(3, '0')}`

  const downloadSvg = async () => {
    await saveFile(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `${stem}.svg`)
  }

  // Rasterised at 2× so the sheet holds up posted anywhere that shows it large.
  const downloadPng = async () => {
    setBusy(true)
    setNote(null)
    try {
      const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
      const blob = await rasterise(src, SHEET_W * 2, SHEET_H * 2)
      await saveFile(blob, `${stem}.png`)
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const copySvg = async () => {
    const ok = await copyText(svg)
    setNote(
      ok
        ? 'Copied as SVG — paste into Figma or any editor.'
        : 'The browser would not let the page use the clipboard. Download the SVG instead.',
    )
  }

  /** one client-space delta, in sheet pixels */
  const toSheet = (px: number) => {
    const el = sheetRef.current?.querySelector('svg')
    return el ? px * (SHEET_W / el.clientWidth) : px
  }

  const wordGroup = () =>
    sheetRef.current?.querySelector<SVGGElement>('[data-part="word"]') ?? null

  /**
   * Dragging mutates the live group's transform and commits on release. A full
   * rebuild per pointermove would re-run the whole treatment chain — tens of
   * milliseconds on the heavy ones — where moving one attribute is free.
   */
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (layout.id !== 'word') return
    const target = e.target as Element
    if (!target.closest?.('[data-part="word"]')) return
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startY: e.clientY, base: wordT }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    const g = wordGroup()
    if (!drag || !g) return
    const dx = drag.base.dx + toSheet(e.clientX - drag.startX)
    const dy = drag.base.dy + toSheet(e.clientY - drag.startY)
    const rest = g.dataset.baseTransform ?? g.getAttribute('transform') ?? ''
    // remember the untouched transform so each move replaces, not accumulates
    if (!g.dataset.baseTransform) g.dataset.baseTransform = rest
    g.setAttribute(
      'transform',
      `translate(${dx - drag.base.dx}, ${dy - drag.base.dy}) ${rest}`,
    )
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    const dx = drag.base.dx + toSheet(e.clientX - drag.startX)
    const dy = drag.base.dy + toSheet(e.clientY - drag.startY)
    setWordT({ ...drag.base, dx, dy })
  }

  /** wheel over the word resizes it; committed on a short trailing debounce */
  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (layout.id !== 'word') return
    const target = e.target as Element
    if (!target.closest?.('[data-part="word"]')) return
    const factor = Math.exp(-e.deltaY * 0.0012)
    const next = clamp((pendingScale.current ?? wordT.scale) * factor, 0.25, 2)
    pendingScale.current = next
    if (wheelTimer.current) clearTimeout(wheelTimer.current)
    wheelTimer.current = setTimeout(() => {
      pendingScale.current = null
      setWordT((t) => ({ ...t, scale: next }))
    }, 90)
  }

  const moved = wordT.dx !== 0 || wordT.dy !== 0 || wordT.scale !== 1

  return (
    <div className="poster-backdrop" onClick={p.onClose} role="presentation">
      <div
        className="poster"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Specimen sheet"
      >
        <div
          className="poster-sheet"
          ref={sheetRef}
          role="img"
          aria-label={`Specimen sheet number ${number}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onWheel={onWheel}
          dangerouslySetInnerHTML={{ __html: svg }}
        />

        <div className="poster-side">
          <h2>Specimen No. {String(number).padStart(3, '0')}</h2>
          <p className="muted">
            {chainName(p.chain)} on {p.font.label}, exactly as you have it set.
          </p>

          {/* The sheets, paged rather than listed — two is not a menu. */}
          <div className="sheets">
            {LAYOUTS.map((l, i) => (
              <button
                type="button"
                key={l.id}
                className={i === layoutIndex % LAYOUTS.length ? 'chip is-on' : 'chip'}
                onClick={() => setLayoutIndex(i)}
                title={l.note}
              >
                {l.name}
              </button>
            ))}
          </div>
          <p className="muted sheet-note">{layout.note}</p>

          <div className="row">
            <button type="button" onClick={() => setSheetSeed(Math.floor(Math.random() * 9999) + 1)}>
              Randomise
            </button>
            <button type="button" onClick={() => setPaletteIndex((i) => i + 1)}>
              Recolour
            </button>
          </div>

          {layout.id === 'word' && (
            <div className="word-place ctl">
              <div className="ctl-head">
                <label htmlFor="word-size">Word size</label>
                <output htmlFor="word-size">{wordT.scale.toFixed(2)}</output>
              </div>
              <input
                id="word-size"
                type="range"
                min={0.25}
                max={2}
                step={0.05}
                value={wordT.scale}
                onChange={(e) => setWordT((t) => ({ ...t, scale: Number(e.target.value) }))}
                onDoubleClick={() => setWordT((t) => ({ ...t, scale: 1 }))}
              />
              <p className="muted sheet-note">
                Drag the word to place it{moved ? ' · ' : '.'}
                {moved && (
                  <button type="button" className="linkish" onClick={() => setWordT(IDENTITY)}>
                    Reset position
                  </button>
                )}
              </p>
            </div>
          )}

          {layout.id === 'word' && (
            <div className="sound">
              <h2>Sound</h2>
              <div className="row">
                <button
                  type="button"
                  className={soundSource === 'loop' ? 'is-live' : undefined}
                  onClick={() => (soundSource === 'loop' ? stopSound() : startSound('loop'))}
                >
                  {soundSource === 'loop' ? 'Stop' : 'Play loop'}
                </button>
                <button
                  type="button"
                  className={soundSource === 'mic' ? 'is-live' : undefined}
                  onClick={() => (soundSource === 'mic' ? stopSound() : startSound('mic'))}
                >
                  {soundSource === 'mic' ? 'Stop mic' : 'Use mic'}
                </button>
              </div>
              {soundSource && (
                <p className="muted sheet-note">
                  The dials are riding the sound. Download or copy to capture the moment.
                </p>
              )}
            </div>
          )}

          <div className="row">
            <button type="button" className="save" onClick={downloadPng} disabled={busy}>
              {busy ? 'Rendering…' : 'Download PNG'}
            </button>
            <button type="button" onClick={downloadSvg}>
              Download SVG
            </button>
          </div>

          <div className="row">
            <button type="button" onClick={copySvg}>
              Copy SVG
            </button>
            <button type="button" onClick={p.onClose}>
              Close
            </button>
          </div>

          {note && <p className="muted">{note}</p>}
        </div>
      </div>
    </div>
  )
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * SVG string to PNG, through an image and a canvas.
 *
 * The canvas stays untainted because the source is a data URI of our own
 * making with nothing external in it — which is also why the poster embeds no
 * fonts it did not draw as outlines.
 */
function rasterise(src: string, width: number, height: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) return reject(new Error('no 2d canvas'))
      ctx.drawImage(img, 0, 0, width, height)
      canvas.toBlob((blob) => {
        if (blob) resolve(blob)
        else reject(new Error('the sheet could not be rendered'))
      }, 'image/png')
    }
    img.onerror = () => reject(new Error('the sheet could not be rendered'))
    img.src = src
  })
}
