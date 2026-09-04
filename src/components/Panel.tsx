import { Dial } from './Dial'
import { getTreatment, type ParamValues, type Treatment } from '../engine/treatments/registry'
import type { Step } from '../lib/urlState'

/** one layer's picture: the letter A with only that step applied */
export interface LayerThumb {
  d: string
  box: string
}

interface Props {
  /** the treatment being edited — always `chain[active]` */
  treatment: Treatment
  chain: Step[]
  active: number
  canAdd: boolean
  params: ParamValues
  seed: number
  alternates: number
  /** one per step, aligned with `chain`; null while a thumbnail is unavailable */
  thumbs: (LayerThumb | null)[]
  onParam: (key: string, value: number) => void
  /** a layer card's own dial — always global, never scoped to a selection */
  onLayerParam: (i: number, key: string, value: number) => void
  onSelectStep: (i: number) => void
  onAddStep: () => void
  onRemoveStep: (i: number) => void
  /** the last remaining layer cannot be removed, only reset */
  onClearStep: (i: number) => void
  onSeed: (seed: number) => void
  onAlternates: (n: number) => void
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

/**
 * The rail: what is stacked on the letters, and every dial that shapes it.
 *
 * Layers are cards rather than tabs because a stack is a list of things, not a
 * set of modes — and because each card can carry its own picture and its own
 * headline dial, which is the tweak people reach for most and the one that
 * should not need a trip anywhere. The picture is the treated letter itself,
 * which is a thumbnail most tools would have to fake.
 *
 * There are no disclosures. Every dial the treatment has is on the page: eight
 * sliders in a column is not a wall, and hiding half of them behind "More"
 * only teaches people that the tool has parts it would rather they left alone.
 */
export function Panel(p: Props) {
  const specs = p.treatment.params
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
            Editing {scopeLabel}
            {p.scope.length > 1 && ` (${p.scope.length})`}
          </h2>
          <div className="row">
            <button type="button" onClick={p.onClearScope}>
              All glyphs
            </button>
            <button
              type="button"
              onClick={p.onReroll}
              disabled={!random}
              title={random ? 'New randomness for just these glyphs' : 'Nothing in this stack is random'}
            >
              Reroll these
            </button>
            {p.scopeHasOverrides && (
              <button type="button" onClick={p.onResetOverrides} title="Back to the global settings">
                Reset to global
              </button>
            )}
          </div>
          <p className="note">Dials below set just these glyphs.</p>
        </div>
      )}

      <div className="group layers">
        <h2>Layers</h2>
        {p.chain.map((step, i) => {
          const treatment = getTreatment(step.id)
          const head = treatment.params.find((s) => s.primary)
          const thumb = p.thumbs[i]
          const on = i === p.active
          return (
            <div
              key={`${step.id}-${i}`}
              className={on ? 'layer is-on' : 'layer'}
              onClick={() => p.onSelectStep(i)}
            >
              <div className="layer-head">
                <span className="layer-thumb" aria-hidden="true">
                  {thumb && (
                    <svg viewBox={thumb.box} height="22" focusable="false">
                      <g transform="scale(1,-1)">
                        <path d={thumb.d} />
                      </g>
                    </svg>
                  )}
                </span>
                <button
                  type="button"
                  className="layer-name"
                  onClick={() => p.onSelectStep(i)}
                  aria-pressed={on}
                >
                  {treatment.name}
                </button>
                {/*
                  The stack can never be empty, so the last layer has nothing to
                  delete. Rather than leaving a dead × sitting there, the control
                  becomes what it can honestly do: put the dials back.
                */}
                {stacked ? (
                  <button
                    type="button"
                    className="layer-drop"
                    onClick={(e) => {
                      e.stopPropagation()
                      p.onRemoveStep(i)
                    }}
                    aria-label={`Remove ${treatment.name}`}
                    title="Remove this layer"
                  >
                    ×
                  </button>
                ) : (
                  <button
                    type="button"
                    className="layer-clear"
                    onClick={(e) => {
                      e.stopPropagation()
                      p.onClearStep(i)
                    }}
                    title="Put this layer back to its defaults"
                  >
                    Clear
                  </button>
                )}
              </div>
              {/*
                Scoped editing is about glyphs, so the card's global dial would
                be answering a different question than the panel below it.
              */}
              {head && !scoped && (
                <div className="layer-dial" onClick={(e) => e.stopPropagation()}>
                  <label htmlFor={`layer-${i}-${head.key}`}>{head.label}</label>
                  <input
                    id={`layer-${i}-${head.key}`}
                    type="range"
                    min={head.min}
                    max={head.max}
                    step={head.step}
                    value={step.params[head.key]}
                    onChange={(e) => p.onLayerParam(i, head.key, Number(e.target.value))}
                    onDoubleClick={() => p.onLayerParam(i, head.key, head.default)}
                  />
                  <output htmlFor={`layer-${i}-${head.key}`}>{step.params[head.key]}</output>
                </div>
              )}
            </div>
          )
        })}
        {p.canAdd && (
          <button type="button" className="add-layer" onClick={p.onAddStep} title="Treat the result again">
            + Add layer
          </button>
        )}
        {stacked && <p className="note">Applied top to bottom — each one works on what the last one left.</p>}
      </div>

      <div className="group settings">
        <h2>{p.treatment.name}</h2>
        {specs.map((spec) => (
          <Dial
            key={spec.key}
            spec={spec}
            value={p.params[spec.key]}
            onChange={(v) => p.onParam(spec.key, v)}
            accent={p.overriddenKeys.has(spec.key)}
          />
        ))}
      </div>

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
