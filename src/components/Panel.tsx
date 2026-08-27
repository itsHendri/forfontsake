import { Dial } from './Dial'
import type { Library } from '../lib/glyphData'
import type { ParamValues, Preset, Treatment } from '../engine/treatments/registry'

interface Props {
  library: Library
  treatments: Treatment[]
  fontId: string
  treatment: Treatment
  params: ParamValues
  seed: number
  alternates: number
  text: string
  onFont: (id: string) => void
  onTreatment: (id: string) => void
  onParam: (key: string, value: number) => void
  onPreset: (preset: Preset) => void
  onSeed: (seed: number) => void
  onAlternates: (n: number) => void
  onText: (text: string) => void
  onRandomise: () => void
  onReset: () => void
  onKeep: () => void
}

/** a preset is only "on" while the dials still match it exactly */
function matches(preset: Preset, params: ParamValues) {
  return Object.keys(preset.values).every((k) => params[k] === preset.values[k])
}

export function Panel(p: Props) {
  const specs = p.treatment.params
  const primary = specs.filter((s) => s.primary)
  const rest = specs.filter((s) => !s.primary)
  // randomness controls would only imply an effect they cannot have
  const random = !p.treatment.deterministic

  return (
    <form className="panel" onSubmit={(e) => e.preventDefault()}>
      <div className="ctl">
        <div className="ctl-head">
          <label htmlFor="text">Text</label>
        </div>
        <input
          id="text"
          type="text"
          value={p.text}
          onChange={(e) => p.onText(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className="ctl">
        <div className="ctl-head">
          <label htmlFor="font">Font</label>
        </div>
        <select id="font" value={p.fontId} onChange={(e) => p.onFont(e.target.value)}>
          {Object.entries(p.library).map(([id, f]) => (
            <option key={id} value={id}>
              {f.label} — {f.note}
            </option>
          ))}
        </select>
      </div>

      <div className="ctl">
        <div className="ctl-head">
          <label htmlFor="treatment">Treatment</label>
        </div>
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
        <p className="ctl-note">{p.treatment.blurb}</p>
      </div>

      <div className="row">
        <button type="button" onClick={p.onRandomise} disabled={!random} title={
          random ? 'Move the seed to a new value' : 'This treatment has no randomness'
        }>
          Randomise
        </button>
        <button type="button" onClick={p.onReset}>
          Reset
        </button>
        <button type="button" onClick={p.onKeep}>
          Keep
        </button>
      </div>

      {random && (
        <>
          <Dial
            spec={{
              key: 'alternates',
              label: 'Cuts per letter',
              min: 1,
              max: 5,
              step: 1,
              default: 3,
              note: 'how many versions of each letter cycle as you type',
            }}
            value={p.alternates}
            onChange={p.onAlternates}
          />
          <Dial
            spec={{
              key: 'seed',
              label: 'Random seed',
              min: 1,
              max: 9999,
              step: 1,
              default: 1337,
              note: 'Randomise just moves this. Same seed, same letters.',
            }}
            value={p.seed}
            onChange={p.onSeed}
          />
        </>
      )}

      {p.treatment.presets && p.treatment.presets.length > 0 && (
        <div className="group">
          <h2>Presets</h2>
          <div className="chips">
            {p.treatment.presets.map((preset) => (
              <button
                type="button"
                key={preset.name}
                className={matches(preset, p.params) ? 'chip is-on' : 'chip'}
                onClick={() => p.onPreset(preset)}
              >
                {preset.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="group">
        <h2>Dials</h2>
        {primary.map((spec) => (
          <Dial
            key={spec.key}
            spec={spec}
            value={p.params[spec.key]}
            onChange={(v) => p.onParam(spec.key, v)}
          />
        ))}
      </div>

      {rest.length > 0 && (
        <details>
          <summary>More</summary>
          <div className="group">
            {rest.map((spec) => (
              <Dial
                key={spec.key}
                spec={spec}
                value={p.params[spec.key]}
                onChange={(v) => p.onParam(spec.key, v)}
              />
            ))}
          </div>
        </details>
      )}
    </form>
  )
}
