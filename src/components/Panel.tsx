import { Dial } from './Dial'
import type { ParamValues, Preset, Treatment } from '../engine/treatments/registry'

interface Props {
  treatment: Treatment
  params: ParamValues
  seed: number
  alternates: number
  onParam: (key: string, value: number) => void
  onPreset: (preset: Preset) => void
  onSeed: (seed: number) => void
  onAlternates: (n: number) => void
  onRandomise: () => void
  onReset: () => void
  onSave: () => void
}

/** a preset is only "on" while the dials still match it exactly */
function matches(preset: Preset, params: ParamValues) {
  return Object.keys(preset.values).every((k) => params[k] === preset.values[k])
}

/**
 * Every treatment lays its controls out in the same order — actions, presets,
 * dials, then the rest — so switching treatments moves the values without
 * moving the furniture. Cuts and seed come last because they are the same two
 * controls on every treatment that has them, rather than part of the effect.
 *
 * Font, treatment and the specimen text are not here: they belong to the plate,
 * with the type they change.
 */
export function Panel(p: Props) {
  const specs = p.treatment.params
  const primary = specs.filter((s) => s.primary)
  const rest = specs.filter((s) => !s.primary)
  // randomness controls would only imply an effect they cannot have
  const random = !p.treatment.deterministic

  return (
    <form className="panel" onSubmit={(e) => e.preventDefault()}>
      <div className="row">
        <button
          type="button"
          onClick={p.onRandomise}
          disabled={!random}
          title={random ? 'Move the seed to a new value' : 'This treatment has no randomness'}
        >
          Randomise
        </button>
        <button type="button" onClick={p.onReset}>
          Reset
        </button>
        <button type="button" className="save" onClick={p.onSave}>
          Save
        </button>
      </div>

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

      {p.treatment.story && (
        <details className="story">
          <summary>How this works</summary>
          <p>{p.treatment.story}</p>
        </details>
      )}

      {rest.length > 0 && (
        <details>
          <summary>More dials</summary>
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

      {random && (
        <div className="group randomness">
          <h2>Randomness</h2>
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
              label: 'Seed',
              min: 1,
              max: 9999,
              step: 1,
              default: 1337,
              note: 'Randomise just moves this. Same seed, same letters.',
            }}
            value={p.seed}
            onChange={p.onSeed}
          />
        </div>
      )}
    </form>
  )
}
