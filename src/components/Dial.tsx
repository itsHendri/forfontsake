import { useState } from 'react'
import type { ParamSpec } from '../engine/treatments/registry'
import { useScrub } from '../lib/scrub'
import { shown, typed } from '../lib/units'

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
  /** the element id, when the same key can appear twice on a page (finishes, Compose) */
  id?: string
  disabled?: boolean
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
export function Dial({ spec, value, onChange, base, accent, id: idProp, disabled }: Props) {
  const start = base ?? spec.default
  const id = idProp ?? `dial-${spec.key}`
  const noteId = `${id}-note`
  const range = spec.max - spec.min
  const defaultAt = range > 0 ? ((start - spec.min) / range) * 100 : 0
  const atDefault = value === start

  // Held locally only while it is being typed: committing every keystroke would
  // fight the caret ("4" becoming 4 becoming "4") and would rebuild the whole
  // face on the way to a two-digit number. `null` means "show the prop", so a
  // value arriving from a preset or a drag needs no effect to sync it back.
  const [draft, setDraft] = useState<string | null>(null)

  const commit = (raw: string) => {
    setDraft(null)
    const n = typed(raw, spec)
    if (n !== null) onChange(settle(n, spec))
  }

  // a nudge supersedes whatever half-typed draft is on screen
  const nudge = (dir: 1 | -1) => {
    setDraft(null)
    onChange(settle(value + dir * spec.step, spec))
  }
  const reset = () => onChange(settle(start, spec))
  const scrub = useScrub({ value, range: spec, onChange, settle: (v) => settle(v, spec), disabled })

  // What the tip says depends on the spec and the landing value only — never on
  // the value in hand. A caption that grew a "double-click to reset" clause the
  // moment the value moved changed under the pointer mid-drag and read as a
  // glitch; now it sits behind an (i) and says the same thing every time.
  const resetTo = shown(settle(start, spec), spec)
  const howTo = spec.kind
    ? `Double-click the name to reset to ${spec.kind === 'segment' && spec.options ? spec.options[Math.round((settle(start, spec) - spec.min) / spec.step)] : resetTo}.`
    : `Drag the name sideways to change it, with Shift for fine steps and Alt for big ones. Double-click the name or the track to reset to ${resetTo}.`
  const note = spec.note ? `${spec.note[0].toUpperCase()}${spec.note.slice(1)}. ${howTo}` : howTo

  /*
   * Off its starting value, the name is tinted and set on a plate, the way
   * Webflow marks a property you have changed. That reads better than the tick
   * on the track. The plate is there so the mark is a change of shape and not
   * only of colour.
   */
  const cls = ['ctl', accent && 'is-override', !atDefault && 'is-changed', disabled && 'is-disabled']
    .filter(Boolean)
    .join(' ')

  // The label and its (i), which every shape of this control wants: help you
  // ask for, not help that follows the pointer.
  const info = (
    <span className="with-tip ctl-info">
      <button type="button" className="info-btn" aria-label={`About ${spec.label.toLowerCase()}`}>
        i
      </button>
      <span className="tip" role="tooltip" id={noteId}>
        {note}
      </span>
    </span>
  )

  /*
   * On or off, drawn as on or off.
   *
   * Invert is a 0–1 dial only because every parameter here is a number. As a
   * track it showed a tick, a percentage and a thumb you had to drag to
   * discover the range was two stops long — three pieces of furniture for a
   * question with two answers.
   */
  if (spec.kind === 'switch') {
    const on = value >= spec.max
    return (
      <div className={cls}>
        <div className="ctl-head">
          <span className="ctl-label">
            <label htmlFor={id} onDoubleClick={reset}>
              {spec.label}
            </label>
            {info}
          </span>
          <input
            id={id}
            disabled={disabled}
            className="ctl-switch"
            type="checkbox"
            role="switch"
            checked={on}
            onChange={(e) => onChange(e.target.checked ? spec.max : spec.min)}
            aria-describedby={noteId}
          />
        </div>
      </div>
    )
  }

  /*
   * A short list of named alternatives, drawn as the list.
   *
   * These are the `steady` dials by another name — the ones that pick *which*
   * picture rather than moving within one — so a track was always the wrong
   * promise: the values in between do not exist.
   */
  if (spec.kind === 'segment' && spec.options) {
    const options = spec.options
    return (
      <div className={cls}>
        <div className="ctl-head">
          <span className="ctl-label">
            <label htmlFor={id} onDoubleClick={reset}>
              {spec.label}
            </label>
            {info}
          </span>
        </div>
        <div className="segmented" role="group" aria-label={spec.label} id={id}>
          {options.map((name, i) => {
            const v = settle(spec.min + i * spec.step, spec)
            const on = value === v
            return (
              <button
                type="button"
                key={name}
                className={on ? 'seg-btn is-on' : 'seg-btn'}
                aria-pressed={on}
                disabled={disabled}
                onClick={() => onChange(v)}
              >
                {name}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className={cls}>
      <div className="ctl-head">
        <span className="ctl-label">
          <label htmlFor={id} className="ctl-scrub" onDoubleClick={reset} {...scrub}>
            {spec.label}
          </label>
          {info}
        </span>
        <div className="stepper">
          <button
            type="button"
            className="step-btn"
            onClick={() => nudge(-1)}
            disabled={disabled || value <= spec.min}
            aria-label={`Less ${spec.label.toLowerCase()}`}
            tabIndex={-1}
          >
            –
          </button>
          <input
            className={['ctl-value', atDefault && 'is-default', spec.unit && 'has-unit'].filter(Boolean).join(' ')}
            type="text"
            inputMode="decimal"
            value={draft ?? shown(value, spec)}
            disabled={disabled}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commit((e.target as HTMLInputElement).value)
              }
              if (e.key === 'Escape') setDraft(null)
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
            disabled={disabled || value >= spec.max}
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
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          onDoubleClick={reset}
          aria-describedby={noteId}
        />
      </div>
    </div>
  )
}
