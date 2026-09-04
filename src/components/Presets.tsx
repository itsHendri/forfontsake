import type { ParamValues, Preset } from '../engine/treatments/registry'

interface Props {
  presets: Preset[]
  params: ParamValues
  onPreset: (preset: Preset) => void
}

/** a preset is only "on" while the dials still match it exactly */
function matches(preset: Preset, params: ParamValues) {
  return Object.keys(preset.values).every((k) => params[k] === preset.values[k])
}

/**
 * The named starting points, sitting above the type they change.
 *
 * No heading: five buttons called Photocopy, Sandblast and Rust do not need a
 * word above them explaining that they are presets, and the label was one more
 * piece of furniture between the top of the page and the letters.
 */
export function Presets(p: Props) {
  if (p.presets.length === 0) return null
  return (
    <div className="presets chips" role="group" aria-label="Presets">
      {p.presets.map((preset) => (
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
  )
}
