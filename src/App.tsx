import { useEffect, useMemo, useRef, useState } from 'react'
import { parse } from './engine/opentype'
import type { FontType as Font } from './engine/opentype'
import { shapeText, type ShapedText } from './engine/text'
import { mosaicGlyph, DEFAULT_PARAMS, type MosaicParams } from './engine/mosaic'
import { tilesToPathD } from './engine/svg'

const INK = '#274A9C'
const PAPER = '#F2EDE2'

interface Variant {
  label: string
  note: string
  overrides: Partial<MosaicParams>
}

const VARIANTS: Variant[] = [
  { label: 'A · calçada courses', note: 'offset-band seeding, contour-following', overrides: { seeding: 'bands' } },
  {
    label: 'B · wilder courses',
    note: 'bands + high irregularity + uneven grout',
    overrides: { seeding: 'bands', irregularity: 0.85, groutJitter: 0.6 },
  },
  { label: 'C · crackle', note: 'raw poisson voronoi (shattered-glass control)', overrides: { seeding: 'poisson', relax: 0 } },
  { label: 'D · relaxed pebbles', note: 'poisson + 2× Lloyd relaxation', overrides: { seeding: 'poisson', relax: 2 } },
]

interface RenderedVariant {
  variant: Variant
  d: string
  shaped: ShapedText
  ms: number
  tileCount: number
}

function renderVariant(font: Font, text: string, base: MosaicParams, variant: Variant): RenderedVariant {
  const t0 = performance.now()
  const params: MosaicParams = { ...base, ...variant.overrides }
  const shaped = shapeText(font, text)
  let d = ''
  let tileCount = 0
  for (const g of shaped.glyphs) {
    const { tiles } = mosaicGlyph(g.rings, { ...params, seed: params.seed + g.glyphIndex * 7919 })
    tileCount += tiles.length
    d += tilesToPathD(tiles, g.x, 0)
  }
  return { variant, d, shaped, ms: performance.now() - t0, tileCount }
}

function svgDocument(r: RenderedVariant, pad = 60): string {
  const { shaped, d } = r
  const w = shaped.width + pad * 2
  const h = shaped.ascender - shaped.descender + pad * 2
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
    `<rect width="${w}" height="${h}" fill="${PAPER}"/>` +
    `<g transform="translate(${pad},${shaped.ascender + pad}) scale(1,-1)">` +
    `<path d="${d}" fill="${INK}" fill-rule="evenodd"/>` +
    `</g></svg>`
  )
}

function download(filename: string, blob: Blob) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

function downloadSvg(r: RenderedVariant) {
  download('forfontsake-mosaic.svg', new Blob([svgDocument(r)], { type: 'image/svg+xml' }))
}

function downloadPng(r: RenderedVariant, scale = 2) {
  const svg = svgDocument(r)
  const img = new Image()
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  img.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = img.width * scale
    canvas.height = img.height * scale
    const ctx = canvas.getContext('2d')!
    ctx.scale(scale, scale)
    ctx.drawImage(img, 0, 0)
    canvas.toBlob((blob) => blob && download('forfontsake-mosaic.png', blob), 'image/png')
    URL.revokeObjectURL(url)
  }
  img.src = url
}

function Slider(props: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
}) {
  return (
    <label className="slider">
      <span>
        {props.label} <b>{props.value}</b>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  )
}

const EXPORTED_FONT = '/exports/CalcadaOne-Regular.otf'

/**
 * Loads the *exported* font file and renders with it. Every competitor in this
 * category ships a download that doesn't match the preview, so proving the real
 * file works is a feature, not a debug aid.
 */
function ExportProof({ text }: { text: string }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading')
  const [detail, setDetail] = useState('')

  useEffect(() => {
    let cancelled = false
    const face = new FontFace('CalcadaOneProof', `url(${EXPORTED_FONT})`)
    fetch(EXPORTED_FONT, { method: 'HEAD' })
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`)
        const kb = Number(r.headers.get('content-length') ?? 0) / 1024
        return face.load().then(() => {
          if (cancelled) return
          document.fonts.add(face)
          setDetail(`${kb ? kb.toFixed(1) + ' KB · ' : ''}loaded via FontFace`)
          setStatus('ready')
        })
      })
      .catch((e) => {
        if (cancelled) return
        setDetail(String(e))
        setStatus(String(e).includes('404') ? 'missing' : 'error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <section className="proof">
      <figcaption>
        proof of export — the built .otf, re-loaded as a real webfont{' '}
        {status === 'ready' && <span className="ok">✓ {detail}</span>}
        {status === 'missing' && <span className="warn">not built yet — run npm run build:font</span>}
        {status === 'error' && <span className="warn">failed: {detail}</span>}
      </figcaption>
      <p className="proofline" style={{ fontFamily: 'CalcadaOneProof, serif' }}>
        {text || 'For font’s sake'}
      </p>
      <p className="proofwaterfall" style={{ fontFamily: 'CalcadaOneProof, serif' }}>
        <span style={{ fontSize: 42 }}>Handgloves 42</span>
        <span style={{ fontSize: 28 }}>Handgloves 28</span>
        <span style={{ fontSize: 18 }}>Handgloves 18</span>
        <span style={{ fontSize: 12 }}>Handgloves 12</span>
      </p>
    </section>
  )
}

export default function App() {
  const [font, setFont] = useState<Font | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState('LisbonTag')
  const [params, setParams] = useState<MosaicParams>(DEFAULT_PARAMS)
  const [selected, setSelected] = useState(0)
  const renderCache = useRef<Map<string, RenderedVariant>>(new Map())

  useEffect(() => {
    fetch('/fonts/pirata-one/PirataOne-Regular.ttf')
      .then((r) => r.arrayBuffer())
      .then((buf) => setFont(parse(buf)))
      .catch((e) => setError(String(e)))
  }, [])

  const rendered = useMemo(() => {
    if (!font) return []
    const cache = renderCache.current
    return VARIANTS.map((v) => {
      const key = JSON.stringify([text, params, v.overrides])
      let r = cache.get(key)
      if (!r) {
        r = renderVariant(font, text, params, v)
        cache.set(key, r)
        if (cache.size > 60) cache.delete(cache.keys().next().value!)
      }
      return r
    })
  }, [font, text, params])

  const set = (patch: Partial<MosaicParams>) => setParams((p) => ({ ...p, ...patch }))

  if (error) return <p style={{ padding: 32 }}>Failed to load font: {error}</p>
  if (!font) return <p style={{ padding: 32 }}>Loading Pirata One…</p>

  const sel = rendered[selected]

  return (
    <div className="bakeoff">
      <header>
        <h1>FOR FONT'S SAKE — M1a bake-off</h1>
        <span className="hint">Pirata One × Mosaic · pick the algorithm that matches the PROMT spec</span>
      </header>

      <div className="controls">
        <input className="text" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
        <Slider label="tile" value={params.tileSize} min={30} max={140} step={2} onChange={(v) => set({ tileSize: v })} />
        <Slider label="grout" value={params.grout} min={2} max={30} step={1} onChange={(v) => set({ grout: v })} />
        <Slider
          label="grout jitter"
          value={params.groutJitter}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => set({ groutJitter: v })}
        />
        <Slider
          label="irregularity"
          value={params.irregularity}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => set({ irregularity: v })}
        />
        <Slider
          label="corner round"
          value={params.cornerRound}
          min={0}
          max={16}
          step={1}
          onChange={(v) => set({ cornerRound: v })}
        />
        <Slider
          label="min tile"
          value={params.minTileArea}
          min={0}
          max={0.3}
          step={0.01}
          onChange={(v) => set({ minTileArea: v })}
        />
        <button onClick={() => set({ seed: Math.floor(Math.random() * 1e6) })}>reroll seed ({params.seed})</button>
      </div>

      <div className="grid">
        {rendered.map((r, i) => {
          const w = r.shaped.width
          const h = r.shaped.ascender - r.shaped.descender
          return (
            <figure key={r.variant.label} className={i === selected ? 'cell selected' : 'cell'} onClick={() => setSelected(i)}>
              <figcaption>
                <b>{r.variant.label}</b> — {r.variant.note} · {r.tileCount} tiles · {Math.round(r.ms)}ms
              </figcaption>
              <svg viewBox={`-40 -40 ${w + 80} ${h + 80}`}>
                <g transform={`translate(0, ${r.shaped.ascender}) scale(1,-1)`}>
                  <path d={r.d} fill={INK} fillRule="evenodd" />
                </g>
              </svg>
            </figure>
          )
        })}
      </div>

      <ExportProof text={text} />

      <div className="reference">
        <figure>
          <figcaption>reference — Figma badge (target vibe)</figcaption>
          <img src="/reference/badge.png" alt="LisbonTag mosaic badge reference" />
        </figure>
        <figure>
          <figcaption>reference — brand cards</figcaption>
          <img src="/reference/cards.png" alt="LisbonTag brand cards reference" />
        </figure>
      </div>

      {sel && (
        <div className="exportbar">
          <span>
            selected: <b>{sel.variant.label}</b>
          </span>
          <button onClick={() => downloadSvg(sel)}>Download SVG</button>
          <button onClick={() => downloadPng(sel)}>Download PNG @2x</button>
        </div>
      )}
    </div>
  )
}
