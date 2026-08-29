import { useEffect, useMemo, useState } from 'react'
import { buildPoster, POSTER_PALETTES } from '../lib/poster'
import { saveFile } from '../lib/exportFont'
import { copyText } from '../lib/clipboard'
import type { FontData } from '../lib/glyphData'
import type { ParamValues, Treatment } from '../engine/treatments/registry'

interface Props {
  font: FontData
  fontId: string
  treatment: Treatment
  params: ParamValues
  seed: number
  word: string
  onClose: () => void
}

/**
 * The specimen sheet, as a thing you can take away.
 *
 * A workbench screenshot is a picture of software. The same letters set on a
 * numbered sheet with the dial values in the margin is a specimen, which is the
 * form a foundry has always published in — and it is the artefact somebody
 * actually wants to post. Roll again and Recolour are here rather than in the
 * panel because they belong to the sheet, not to the font.
 */
export function Poster(p: Props) {
  const [sheetSeed, setSheetSeed] = useState(p.seed)
  const [paletteIndex, setPaletteIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && p.onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [p])

  const palette = POSTER_PALETTES[paletteIndex % POSTER_PALETTES.length]
  // the number is the seed's, so the same sheet always carries the same one
  const number = (sheetSeed % 999) + 1

  const svg = useMemo(
    () =>
      buildPoster({
        font: p.font,
        fontId: p.fontId,
        treatmentId: p.treatment.id,
        params: p.params,
        seed: sheetSeed,
        word: p.word,
        palette,
        number,
      }),
    [p.font, p.fontId, p.treatment.id, p.params, sheetSeed, p.word, palette, number],
  )

  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  const stem = `forfontsake-${p.treatment.id}-${String(number).padStart(3, '0')}`

  const downloadSvg = async () => {
    await saveFile(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `${stem}.svg`)
  }

  // Rasterised at 2× so the sheet holds up posted anywhere that shows it large.
  const downloadPng = async () => {
    setBusy(true)
    setNote(null)
    try {
      const blob = await rasterise(src, 2400, 3200)
      await saveFile(blob, `${stem}.png`)
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const copyForFigma = async () => {
    const ok = await copyText(svg)
    setNote(
      ok
        ? 'Copied — paste straight into Figma.'
        : 'The browser would not let the page use the clipboard. Download the SVG instead.',
    )
  }

  return (
    <div className="poster-backdrop" onClick={p.onClose} role="presentation">
      <div
        className="poster"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Specimen sheet"
      >
        <img className="poster-sheet" src={src} alt={`Specimen sheet number ${number}`} />

        <div className="poster-side">
          <h2>Specimen No. {String(number).padStart(3, '0')}</h2>
          <p className="muted">
            {p.treatment.name} on {p.font.label}, exactly as you have it set.
          </p>

          <div className="row">
            <button type="button" onClick={() => setSheetSeed(Math.floor(Math.random() * 9999) + 1)}>
              Roll again
            </button>
            <button type="button" onClick={() => setPaletteIndex((i) => i + 1)}>
              Recolour
            </button>
          </div>

          <div className="row">
            <button type="button" className="save" onClick={downloadPng} disabled={busy}>
              {busy ? 'Rendering…' : 'Download PNG'}
            </button>
            <button type="button" onClick={downloadSvg}>
              Download SVG
            </button>
          </div>

          <div className="row">
            <button type="button" onClick={copyForFigma}>
              Copy for Figma
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
