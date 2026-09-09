import { Dial } from './Dial'
import { ThumbInk, type Thumb } from './Thumb'
import {
  getTreatment,
  hasRandomness,
  initialParams,
  presetMatches,
  STACK_WIDE_KEYS,
  type ParamSpec,
  type ParamValues,
  type Treatment,
} from '../engine/treatments/registry'
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
  /** one per step, aligned with `chain`; null while a thumbnail is unavailable */
  thumbs: (Thumb | null)[]
  onParam: (key: string, value: number) => void
  /** the one dial that runs over the whole stack — see Detail below */
  onSimplify: (value: number) => void
  onSelectStep: (i: number) => void
  onAddStep: () => void
  onRemoveStep: (i: number) => void
  /** put one layer back to the named setting it is sitting on */
  onResetStep: (i: number) => void
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
 * What a layer's Reset puts it back to, named where it has a name.
 *
 * Almost always a preset, because there is no unnamed state to land on — so
 * the control can say "back to Coarse dots" rather than "back to defaults",
 * which is the difference between a promise and a threat.
 */
function landingName(step: Step): string {
  const t = getTreatment(step.id)
  const params = step.origin ?? initialParams(t)
  return t.presets?.find((preset) => presetMatches(preset, params))?.name ?? 'its defaults'
}

/**
 * The rail: what is stacked on the letters, and every dial that shapes it.
 *
 * Layers are cards rather than tabs because a stack is a list of things, not a
 * set of modes — and because each card can carry its own picture, the treated
 * letter itself, which is a thumbnail most tools would have to fake. The card
 * used to carry the layer's headline dial as well; it went, because the same
 * dial sat first in the group directly beneath it and two sliders saying one
 * thing read as a fault.
 *
 * There are no disclosures. Every dial the treatment has is on the page, and
 * hiding half of them behind "More" would only teach people that the tool has
 * parts it would rather they left alone. That held easily while the longest
 * treatment ran to eight sliders; consolidating seventeen treatments into
 * thirteen took the longest to thirteen dials, which is a wall whether or not
 * it is honest. So the wall gets headings rather than a lid: the dials break
 * into named runs, all still on the page, and a treatment small enough to read
 * at a glance stays flat rather than being carved up to match.
 *
 * The one exception is Simplify, which every treatment carries with the same
 * meaning — that is one dial over the stack (Detail), not one per layer.
 */
export function Panel(p: Props) {
  const specs = p.treatment.params.filter((s) => !STACK_WIDE_KEYS.has(s.key))
  const detail = p.treatment.params.find((s) => s.key === 'simplify')
  // The named state this step was last set to, so a dial can say whether *you*
  // moved it. Falls back to the landing preset for a step that arrived by link
  // or off the shelf and so never had one chosen.
  const landing = p.chain[p.active]?.origin ?? initialParams(p.treatment)
  // Randomness belongs to the stack rather than to the step being edited: one
  // seed drives the whole thing, so the controls appear if *anything* in the
  // stack consumes randomness, not just the treatment currently selected.
  const random = hasRandomness(p.chain)
  const stacked = p.chain.length > 1

  const scoped = p.scope.length > 0

  const dial = (spec: ParamSpec) => (
    <Dial
      key={spec.key}
      spec={spec}
      value={p.params[spec.key]}
      base={landing[spec.key]}
      onChange={(v) => p.onParam(spec.key, v)}
      accent={p.overriddenKeys.has(spec.key)}
    />
  )

  // Runs in the order each first appears, dials inside them in the order they
  // are declared — so the panel can be rearranged without touching the list
  // the sound reads. A treatment that names no groups comes back as one run
  // and renders flat.
  const runs: { name: string; specs: ParamSpec[] }[] = []
  for (const spec of specs) {
    const name = spec.group ?? ''
    const run = runs.find((r) => r.name === name)
    if (run) run.specs.push(spec)
    else runs.push({ name, specs: [spec] })
  }

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
                  <ThumbInk thumb={thumb} height={22} />
                </span>
                {/* the click reaches the card by bubbling; wiring it here too
                    would select the step twice on every activation */}
                <button type="button" className="layer-name" aria-pressed={on}>
                  {treatment.name}
                </button>
                {/*
                  Reset belongs to the layer it resets. It used to sit in the
                  plate's footer, where it was one control for whichever layer
                  happened to be selected — so what it would undo depended on
                  something else on the page. Every card carries its own.
                */}
                <button
                  type="button"
                  className="layer-clear"
                  onClick={(e) => {
                    e.stopPropagation()
                    p.onResetStep(i)
                  }}
                  title={`Put ${treatment.name} back to ${landingName(step)}`}
                >
                  Reset
                </button>
                {/* The stack can never be empty, so the last layer has nothing
                    to delete and shows no × at all — better than a dead one. */}
                {stacked && (
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
                )}
              </div>
            </div>
          )
        })}
        {p.canAdd && (
          <button type="button" className="add-layer" onClick={p.onAddStep} title="Treat the result again">
            + Add layer
          </button>
        )}
      </div>

      <div className="group settings">
        <h2>{p.treatment.name}</h2>
        {runs.length > 1
          ? runs.map((run) => (
              <div className="dialrun" key={run.name}>
                <h3>{run.name}</h3>
                {run.specs.map(dial)}
              </div>
            ))
          : specs.map(dial)}
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

      {/*
        Detail is Simplify, once. Every treatment carries a simplify dial with
        the same meaning, so a stack of three showed it three times over. The
        state keeps it per step — the URL, the shelf and the CLI are untouched —
        and this dial writes the same value into all of them.
      */}
      {detail && (
        <div className="group output">
          <h2>Output</h2>
          <Dial
            spec={{
              ...detail,
              label: 'Detail',
              note: 'how much of the outline survives — low keeps every point, high is smoother and lighter',
            }}
            value={p.params.simplify}
            base={landing.simplify}
            onChange={p.onSimplify}
            accent={p.overriddenKeys.has('simplify')}
          />
        </div>
      )}
    </form>
  )
}
