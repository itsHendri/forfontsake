import { Dial } from './Dial'
import { getTreatment, type ParamValues, type Preset, type Treatment } from '../engine/treatments/registry'
import type { Step } from '../lib/urlState'

interface Props {
  /** the treatment being edited — always `chain[active]` */
  treatment: Treatment
  chain: Step[]
  active: number
  canAdd: boolean
  params: ParamValues
  seed: number
  alternates: number
  onParam: (key: string, value: number) => void
  onPreset: (preset: Preset) => void
  onSelectStep: (i: number) => void
  onAddStep: () => void
  onRemoveStep: (i: number) => void
  onSeed: (seed: number) => void
  onAlternates: (n: number) => void
  onRandomise: () => void
  onReset: () => void
  onSave: () => void
  /** the glyphs the dials are editing — empty means the whole face */
  scope: string[]
  /** dial keys the scoped glyphs override at the active step */
  overriddenKeys: Set<string>
  /** whether anything in the scope carries its own settings */
  scopeHasOverrides: boolean
  onClearScope: () => void
  onResetOverrides: () => void
  onReroll: () => void
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
  // Randomness belongs to the stack rather than to the step being edited: one
  // seed drives the whole thing, so the controls appear if *anything* in the
  // stack consumes randomness, not just the treatment currently selected.
  const random = p.chain.some((step) => !getTreatment(step.id).deterministic)
  const stacked = p.chain.length > 1

  const scoped = p.scope.length > 0
  const scopeLabel =
    p.scope.length <= 6 ? p.scope.join(' ') : `${p.scope.slice(0, 6).join(' ')} +${p.scope.length - 6}`

  return (
    <form className="panel" onSubmit={(e) => e.preventDefault()}>
      {/*
        Which glyphs the dials below are editing. The scope switcher, not a
        mode: selection in the grid opens it, clearing the selection closes it,
        and everything global stays exactly where it always is.
      */}
      {scoped && (
        <div className="group scope">
          <h2>
            Editing {scopeLabel} ({p.scope.length})
          </h2>
          <div className="row">
            <button type="button" onClick={p.onClearScope}>
              All glyphs
            </button>
            <button
              type="button"
              onClick={p.onReroll}
              disabled={!random}
              title={
                random
                  ? 'New randomness for just these glyphs'
                  : 'Nothing in this stack is random'
              }
            >
              Reroll these
            </button>
            {p.scopeHasOverrides && (
              <button type="button" onClick={p.onResetOverrides} title="Back to the global settings">
                Reset to global
              </button>
            )}
          </div>
          <p className="note">Dials below set just these glyphs. Untouched dials follow the global settings.</p>
        </div>
      )}

      {/*
        The stack, and the selector for which step the dials below belong to.
        Shown as soon as there is more than one step, or as the single "+" when
        there is not — a lone treatment with a tab bar round it would suggest
        the stack is a mode you enter rather than something you add to.
      */}
      <div className="group stack">
        <h2>Stack</h2>
        <div className="steps">
          {p.chain.map((step, i) => (
            <span key={`${step.id}-${i}`} className={i === p.active ? 'step is-on' : 'step'}>
              <button type="button" onClick={() => p.onSelectStep(i)}>
                <em>{i + 1}</em>
                {getTreatment(step.id).name}
              </button>
              {stacked && (
                <button
                  type="button"
                  className="drop"
                  onClick={() => p.onRemoveStep(i)}
                  aria-label={`Remove ${getTreatment(step.id).name}`}
                  title="Remove this step"
                >
                  ×
                </button>
              )}
            </span>
          ))}
          {p.canAdd && (
            <button
              type="button"
              className="step add"
              onClick={p.onAddStep}
              title="Treat the result again"
            >
              + Add
            </button>
          )}
        </div>
        {stacked && (
          <p className="note">
            Applied top to bottom — each one works on what the last one left.
          </p>
        )}
      </div>

      <div className="row">
        <button
          type="button"
          onClick={p.onRandomise}
          disabled={!random}
          title={random ? 'Move the seed to a new value' : 'Nothing in this stack is random'}
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
            accent={p.overriddenKeys.has(spec.key)}
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
                accent={p.overriddenKeys.has(spec.key)}
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
