import { useMemo, useState } from 'react'
import type { ParamSpec } from '../engine/treatments/registry'
import { CURVES, MODES, type Band, type Track } from '../lib/modulate'
import { CHANNELS, LENGTHS, clockText, motionAt } from '../lib/motion'
import { useScrub } from '../lib/scrub'
import { settle, shown, typed } from '../lib/units'

/** how many points a lane's curve is drawn with: enough for a beat's attack at the fastest speed */
const SAMPLES = 720

/** each curve over one loop, as a path in a 1000 × 40 box, the way the lanes draw it */
function curvePaths(length: number, speed: number): Record<Band, string> {
  const pts: Record<string, string[]> = {}
  for (const c of CHANNELS) pts[c] = []
  for (let i = 0; i <= SAMPLES; i++) {
    const u = i / SAMPLES
    // the last sample is the first again, which is what a seamless loop means
    const v = motionAt(u * length, length, speed)
    const x = (u * 1000).toFixed(1)
    CHANNELS.forEach((c, k) => pts[c].push(`${x} ${(20 - v[k] * 15).toFixed(1)}`))
  }
  const out = {} as Record<Band, string>
  for (const c of CHANNELS) out[c] = `M${pts[c].join(' L')}`
  return out
}

/** Depth or Speed in the dock's head: the name scrubs, the value takes typing */
function HeadNumber({
  spec,
  value,
  onChange,
  disabled,
}: {
  spec: ParamSpec
  value: number
  onChange: (v: number) => void
  disabled?: boolean
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const scrub = useScrub({ value, range: spec, onChange, settle: (v) => settle(v, spec), disabled })
  const commit = (raw: string) => {
    setDraft(null)
    const n = typed(raw, spec)
    if (n !== null) onChange(settle(n, spec))
  }
  const id = `tl-${spec.key}`
  return (
    <span className="tl-number">
      <label htmlFor={id} className="ctl-scrub" title={`${spec.note}. Drag sideways to change it.`} {...scrub}>
        {spec.label}
      </label>
      <input
        id={id}
        className="tl-number-value"
        inputMode="decimal"
        disabled={disabled}
        value={draft ?? shown(value, spec)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value)
          if (e.key === 'Escape') setDraft(null)
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            setDraft(null)
            onChange(settle(value + (e.key === 'ArrowUp' ? 1 : -1) * spec.step, spec))
          }
        }}
      />
    </span>
  )
}

/** the transport's glyph: two bars while it plays, a triangle while it waits */
export function PlayGlyph({ playing }: { playing: boolean }) {
  return playing ? (
    <svg width="12" height="14" viewBox="0 0 12 14" aria-hidden="true">
      <rect x="1" y="1" width="3.5" height="12" />
      <rect x="7.5" y="1" width="3.5" height="12" />
    </svg>
  ) : (
    <svg width="12" height="14" viewBox="0 0 12 14" aria-hidden="true">
      <path d="M1 1 L11 7 L1 13 Z" />
    </svg>
  )
}

interface Props {
  /** the dock under the stage, or the phone's sheet, where a row stacks its lane under its name */
  variant: 'dock' | 'stacked'
  motionOn: boolean
  modeId: string
  /** whether any row has been changed by hand, which is what the Custom chip says */
  custom: boolean
  tracks: Track[]
  /** more than one treatment, so the rows are grouped under each one's name */
  stacked: boolean
  playing: boolean
  /** a clip rendering or a take recording: the dock is read, not edited */
  locked: string | null
  /** where the loop is, at the moment of rendering; the playhead runs on between renders */
  now: number
  length: number
  speed: number
  depth: number
  depthSpec: ParamSpec
  speedSpec: ParamSpec
  /** what the chain's rebuild rate means for the preview, when it steps */
  steppy: string | null
  onPlay: () => void
  onPreset: (id: string | null) => void
  onRow: (key: string, band: Band | null) => void
  onDepth: (v: number) => void
  onSpeed: (v: number) => void
  onLength: (v: number) => void
  /** a point in the loop, as a share of it */
  onSeek: (at: number) => void
}

/**
 * The motion, as a timeline under the sheet: Hendri's pick, D, in November.
 *
 * Motion was a section of the sheet's panel: Still or one of three named
 * movements, and two dials. The video-editor dock puts what it does on show:
 * the transport and the presets in its head, then a row for every dial the
 * motion can drive, each drawing the curve it follows across the loop. A
 * preset fills the rows; a row changed by hand becomes a binding of its own,
 * and the chips say Custom until a preset is picked again.
 *
 * Still folds it to its head, so the sheet has the room back. While a clip
 * renders the dock is locked, and its playhead shows the frame being drawn.
 *
 * The playhead and the clock text are painted by the room straight into the
 * DOM (`--t` on the room, `.tl-now` here). They move every frame, and a
 * render a frame would be a render of the whole room.
 */
export function ComposeTimeline(p: Props) {
  const paths = useMemo(() => curvePaths(p.length, p.speed), [p.length, p.speed])
  const off = !p.motionOn || !!p.locked
  const presets = [{ id: null, name: 'Still', note: 'Nothing moves. Download gives a PNG or SVG.' }, ...MODES]
  // a second a tick on the dock; a phone's lane is a third as wide
  const step = p.variant === 'dock' || p.length <= 6 ? 1 : p.length <= 10 ? 2 : 3
  const ticks: number[] = []
  for (let s = 0; s <= p.length; s += step) ticks.push(s)

  // the ruler is a slider over the loop: drag along it, or step with the arrows
  const seekAt = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    if (r.width > 0) p.onSeek(Math.min(0.999, Math.max(0, (e.clientX - r.left) / r.width)))
  }
  const share = p.now / p.length

  return (
    <section
      className={['tl', `is-${p.variant}`, p.motionOn ? 'is-moving' : 'is-still', p.locked ? 'is-locked' : '']
        .filter(Boolean)
        .join(' ')}
      aria-label="Timeline"
    >
      <div className="tl-head">
        <button
          type="button"
          className="tl-play"
          aria-label={p.playing ? 'Pause' : 'Play'}
          disabled={off}
          onClick={p.onPlay}
        >
          <PlayGlyph playing={p.playing && p.motionOn && !p.locked} />
        </button>
        <span className="tl-time">
          <span className="tl-now">{clockText(p.motionOn ? p.now : 0)}</span>
          <span className="tl-total"> / {clockText(p.length, false)}</span>
        </span>
        <span className="tl-divider" aria-hidden="true" />
        <div className="tl-presets" role="group" aria-label="Preset">
          <span className="tl-label" aria-hidden="true">
            Preset
          </span>
          {presets.map((m) => {
            const on = m.id === null ? !p.motionOn : p.motionOn && !p.custom && m.id === p.modeId
            return (
              <button
                type="button"
                key={m.id ?? 'still'}
                className={on ? 'tl-chip is-on' : 'tl-chip'}
                aria-pressed={on}
                title={`${m.note[0].toUpperCase()}${m.note.slice(1)}${m.note.endsWith('.') ? '' : '.'}`}
                disabled={!!p.locked}
                onClick={() => p.onPreset(m.id)}
              >
                {on && <span aria-hidden="true">✓ </span>}
                {m.name}
              </button>
            )
          })}
          {p.motionOn && p.custom && (
            <span
              className="tl-chip is-on is-static"
              title={`${MODES.find((m) => m.id === p.modeId)?.name ?? 'The preset'}, with rows changed by hand. Pick a preset to start from it again.`}
            >
              <span aria-hidden="true">✓ </span>
              Custom
            </span>
          )}
        </div>
        <div className="tl-settings">
          <HeadNumber spec={p.depthSpec} value={p.depth} onChange={p.onDepth} disabled={off} />
          <HeadNumber spec={p.speedSpec} value={p.speed} onChange={p.onSpeed} disabled={off} />
          <div className="tl-length" role="group" aria-label="Clip length">
            {LENGTHS.map((l) => (
              <button
                type="button"
                key={l}
                className={l === p.length ? 'is-on' : undefined}
                aria-pressed={l === p.length}
                disabled={off}
                onClick={() => p.onLength(l)}
              >
                {l} s
              </button>
            ))}
          </div>
        </div>
        {p.locked && (
          <p className="tl-lock" role="status">
            {p.locked}
          </p>
        )}
      </div>

      {p.motionOn && (
        <div className="tl-body">
          <div className="tl-ruler-row">
            <div
              className="tl-ruler"
              role="slider"
              tabIndex={p.locked ? -1 : 0}
              aria-label="Playhead"
              aria-valuemin={0}
              aria-valuemax={p.length}
              aria-valuenow={Math.round(p.now * 10) / 10}
              aria-valuetext={`${clockText(p.now)} of ${clockText(p.length, false)}`}
              aria-disabled={!!p.locked || undefined}
              onPointerDown={(e) => {
                if (p.locked) return
                e.currentTarget.setPointerCapture(e.pointerId)
                seekAt(e)
              }}
              onPointerMove={(e) => {
                if (!p.locked && e.currentTarget.hasPointerCapture(e.pointerId)) seekAt(e)
              }}
              onKeyDown={(e) => {
                if (p.locked) return
                const by = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
                if (!by) return
                e.preventDefault()
                const n = Math.round(share * p.length * 10 + by * (e.shiftKey ? 10 : 1)) / 10
                p.onSeek(Math.min(0.999, Math.max(0, n / p.length)))
              }}
            >
              {ticks.map((s) => (
                <span key={s} className="tl-tick" style={{ left: `${(s / p.length) * 100}%` }}>
                  {s}s
                </span>
              ))}
              <span className="tl-playhead is-ruler" aria-hidden="true" />
            </div>
          </div>
          <div className="tl-rows">
            {p.tracks.map((r, i) => {
              const first = i === 0 || p.tracks[i - 1].stepIndex !== r.stepIndex
              const id = `tl-row-${r.key.replace(':', '-')}`
              return (
                <div key={r.key} className="tl-row-wrap">
                  {p.stacked && first && <h4 className="tl-step">{r.treatment}</h4>}
                  <div className={['tl-row', r.band ? 'is-live' : 'is-hold', r.custom ? 'is-custom' : ''].filter(Boolean).join(' ')}>
                    <div className="tl-row-label">
                      <label htmlFor={id} className="tl-dial">
                        {r.spec.label}
                        {r.custom && <span className="tl-edited"> · edited</span>}
                      </label>
                      <span className="tl-curve">
                        <select
                          id={id}
                          value={r.band ?? 'hold'}
                          disabled={!!p.locked}
                          title={CURVES.find((c) => c.band === r.band)?.note}
                          onChange={(e) =>
                            p.onRow(r.key, e.target.value === 'hold' ? null : (e.target.value as Band))
                          }
                        >
                          {CURVES.map((c) => (
                            <option key={c.name} value={c.band ?? 'hold'}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                        <span className="tl-curve-caret" aria-hidden="true">
                          ▾
                        </span>
                      </span>
                    </div>
                    <div className="tl-lane" aria-hidden="true">
                      <svg width="100%" height="40" viewBox="0 0 1000 40" preserveAspectRatio="none">
                        <path d={r.band ? paths[r.band] : 'M0 20 L1000 20'} vectorEffect="non-scaling-stroke" />
                      </svg>
                      <span className="tl-playhead" />
                    </div>
                  </div>
                </div>
              )
            })}
            {p.steppy && <p className="tl-note">{p.steppy}</p>}
          </div>
        </div>
      )}
    </section>
  )
}
