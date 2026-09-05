import { ThumbInk, type Thumb } from './Thumb'
import type { ParamValues, Preset } from '../engine/treatments/registry'

interface Props {
  presets: Preset[]
  /** one per preset, aligned with `presets` */
  thumbs: (Thumb | null)[]
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
 * Each one shows what it does. That is the whole point: a button is a word and
 * a preset is a picture, so the two can never be mistaken for one another —
 * which they were, because a selected chip and the download button were both a
 * solid ink rectangle, and the loudest thing on the page ended up being a
 * preset rather than the thing the tool is for.
 *
 * No heading either. Five things called Photocopy, Sandblast and Rust do not
 * need a word above them explaining that they are presets.
 */
export function Presets(p: Props) {
  if (p.presets.length === 0) return null
  return (
    <div className="presets" role="group" aria-label="Presets">
      {p.presets.map((preset, i) => {
        const on = matches(preset, p.params)
        const thumb = p.thumbs[i]
        return (
          <button
            type="button"
            key={preset.name}
            className={on ? 'preset is-on' : 'preset'}
            aria-pressed={on}
            onClick={() => p.onPreset(preset)}
          >
            <span className="preset-ink" aria-hidden="true">
              <ThumbInk thumb={thumb} height={26} />
            </span>
            <span className="preset-name">{preset.name}</span>
          </button>
        )
      })}
    </div>
  )
}
