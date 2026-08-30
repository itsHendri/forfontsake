import type { ParamSpec } from '../engine/treatments/registry'

interface Props {
  spec: ParamSpec
  value: number
  onChange: (value: number) => void
  /** this dial deviates from the global settings — the per-glyph accent */
  accent?: boolean
}

/**
 * One parameter. The default is marked on the track so "is this a lot?" is
 * answerable at a glance rather than only by dragging.
 */
export function Dial({ spec, value, onChange, accent }: Props) {
  const id = `dial-${spec.key}`
  const range = spec.max - spec.min
  const defaultAt = range > 0 ? ((spec.default - spec.min) / range) * 100 : 0
  const atDefault = value === spec.default

  return (
    <div className={accent ? 'ctl is-override' : 'ctl'}>
      <div className="ctl-head">
        <label htmlFor={id}>{spec.label}</label>
        <output htmlFor={id} className={atDefault ? 'is-default' : undefined}>
          {value}
        </output>
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
          onDoubleClick={() => onChange(spec.default)}
          title={atDefault ? undefined : 'Double-click to reset'}
        />
      </div>
      {spec.note && <p className="ctl-note">{spec.note}</p>}
    </div>
  )
}
