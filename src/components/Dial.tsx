import { useEffect, useState } from 'react'
import type { ParamSpec } from '../engine/treatments/registry'

interface Props {
  spec: ParamSpec
  value: number
  onChange: (value: number) => void
  /**
   * The value this dial started at — the landing preset's, not the spec's.
   *
   * The tick, the muted-versus-marked colour and the double-click reset all
   * measure from here. Comparing against the bare spec default would paint
   * every dial as "changed" the moment the tool opens on a preset, which is
   * every time, and the signal would mean nothing.
   */
  base?: number
  /** this dial deviates from the global settings for the glyphs in scope */
  accent?: boolean
}

/** how many decimals the step implies — 0.1 shows one, 1 shows none */
function decimals(step: number): number {
  const s = String(step)
  return s.includes('.') ? s.split('.')[1].length : 0
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** snap to the spec's step and keep it inside the range */
function settle(v: number, spec: ParamSpec): number {
  const snapped = Math.round((v - spec.min) / spec.step) * spec.step + spec.min
  return Number(clamp(snapped, spec.min, spec.max).toFixed(decimals(spec.step)))
}

/**
 * One dial: a label, a value you can type into, and a track.
 *
 * The value is an input rather than a readout because every tool a designer
 * already uses — Framer, Figma, Rive, Blender — makes it one, and because a
 * slider cannot hit 1337 on a 1–9999 range without a fight. The minus and plus
 * flanking it are the single-step nudge that dragging is bad at.
 *
 * The track carries a tick at the default, so "is this a lot?" is answerable
 * without dragging to find out, and double-clicking anywhere on it resets.
 */
export function Dial({ spec, value, onChange, base, accent }: Props) {
  const start = base ?? spec.default
  const id = `dial-${spec.key}`
  const noteId = `${id}-note`
  const range = spec.max - spec.min
  const defaultAt = range > 0 ? ((start - spec.min) / range) * 100 : 0
  const atDefault = value === start

  // The typed value is held locally while it is being typed: committing every
  // keystroke would fight the caret ("4" becoming 4 becoming "4") and would
  // rebuild the whole face on the way to a two-digit number.
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])

  const commit = (raw: string) => {
    const n = Number(raw)
    if (raw.trim() === '' || Number.isNaN(n)) {
      setDraft(String(value))
      return
    }
    onChange(settle(n, spec))
  }

  const nudge = (dir: 1 | -1) => onChange(settle(value + dir * spec.step, spec))
  const reset = () => onChange(settle(start, spec))

  const note = [spec.note, atDefault ? undefined : 'double-click the track to reset']
    .filter(Boolean)
    .join(' · ')

  return (
    <div className={accent ? 'ctl is-override' : 'ctl'}>
      <div className="ctl-head">
        <label htmlFor={id}>{spec.label}</label>
        <div className="stepper">
          <button
            type="button"
            className="step-btn"
            onClick={() => nudge(-1)}
            disabled={value <= spec.min}
            aria-label={`Less ${spec.label.toLowerCase()}`}
            tabIndex={-1}
          >
            –
          </button>
          <input
            className={atDefault ? 'ctl-value is-default' : 'ctl-value'}
            type="text"
            inputMode="decimal"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commit((e.target as HTMLInputElement).value)
              }
              if (e.key === 'Escape') setDraft(String(value))
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                nudge(1)
              }
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                nudge(-1)
              }
            }}
            aria-label={`${spec.label} value`}
            spellCheck={false}
            autoComplete="off"
          />
          <button
            type="button"
            className="step-btn"
            onClick={() => nudge(1)}
            disabled={value >= spec.max}
            aria-label={`More ${spec.label.toLowerCase()}`}
            tabIndex={-1}
          >
            +
          </button>
        </div>
      </div>
      <div className="track-wrap">
        <span className="track-default" style={{ left: `${defaultAt}%` }} aria-hidden="true" />
        <input
          id={id}
          type="range"
          min={spec.min}
          max={spec.max}
          step={spec.step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          onDoubleClick={reset}
          aria-describedby={note ? noteId : undefined}
        />
      </div>
      {note && (
        <p className="ctl-note" id={noteId}>
          {note}
        </p>
      )}
    </div>
  )
}
