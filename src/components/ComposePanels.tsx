import { useEffect, useRef, useState } from 'react'
import type { Finish, FinishState } from '../lib/finish'
import { addable, finishesOn } from '../lib/composeLayers'
import { Menu } from './Menu'

/**
 * The pieces Compose's right panel is built from.
 *
 * The panel shows whatever is selected — the sheet, the word, the background,
 * the finishes — the way Figma's right panel follows the selection. Each of
 * those is a stack of these sections, so the panels read the same however
 * different the thing they edit.
 */

/**
 * One section of the panel: a heading, an optional action at its right, and
 * the controls.
 *
 * `fold` is the line it collapses to. With motion on the sheet's first
 * sections fold so Motion fits without scrolling, the way band 12 drew it —
 * and a folded section opens again on a click, because folding is to make
 * room, not to take the setting away.
 */
export function Section({
  title,
  aside,
  fold,
  className,
  children,
}: {
  title: string
  aside?: React.ReactNode
  fold?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  // the room keys these on the motion, so turning it on again folds them afresh
  const [opened, setOpened] = useState(false)
  if (fold !== undefined && !opened) {
    return (
      <section className={['inspector-section', 'is-folded', className].filter(Boolean).join(' ')}>
        <button type="button" className="inspector-fold" onClick={() => setOpened(true)} aria-expanded={false}>
          <span className="inspector-title">{title}</span>
          <span className="inspector-fold-value">{fold} ›</span>
        </button>
      </section>
    )
  }
  return (
    <section className={['inspector-section', className].filter(Boolean).join(' ')}>
      <div className="inspector-section-head">
        <h3 className="inspector-title">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

/** a row of mutually exclusive choices, the segmented control every inspector has */
export function Seg<T extends string | number>({
  label,
  items,
  value,
  onChange,
  disabled,
}: {
  label: string
  items: { id: T; name: string; title?: string }[]
  value: T | null
  onChange: (id: T) => void
  disabled?: boolean
}) {
  return (
    <div className="seg-row" role="group" aria-label={label}>
      {items.map((it) => {
        const on = it.id === value
        return (
          <button
            type="button"
            key={String(it.id)}
            className={on ? 'seg is-on' : 'seg'}
            aria-pressed={on}
            title={it.title}
            disabled={disabled}
            onClick={() => onChange(it.id)}
          >
            {it.name}
          </button>
        )
      })}
    </div>
  )
}

/**
 * One colour, on the layer it belongs to.
 *
 * The platform's own picker rather than a grid of swatches: it is the control
 * people already know, it is reachable from the keyboard, and a sheet is a
 * thing somebody wants an exact colour on. The hex is shown because it is what
 * gets typed into the thing this ends up next to.
 */
export function Swatch({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = `swatch-${label.replace(/\W+/g, '-').toLowerCase()}`
  /*
   * One colour a frame, latest wins.
   *
   * Dragging across the picker's spectrum fires an event a pixel, and every
   * one of them repaints the sheet and re-uploads two textures. Nobody can see
   * more than one colour a frame, so the ones in between are work for a
   * picture that is never shown.
   */
  // What the picker is showing. It has to be this component's own state and
  // it has to move on the event: a controlled input whose value prop is a
  // frame behind gets snapped back to the old colour by the render in between,
  // and the swatch fights the hand dragging it.
  const [shown, setShown] = useState(value)
  useEffect(() => {
    setShown(value)
  }, [value])
  const pending = useRef<string | null>(null)
  const frame = useRef<number | null>(null)
  const latest = useRef(onChange)
  latest.current = onChange
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    },
    [],
  )
  const take = (v: string) => {
    pending.current = v
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      const next = pending.current
      pending.current = null
      if (next !== null) latest.current(next)
    })
  }
  return (
    <div className="swatch-row">
      <label htmlFor={id}>{label}</label>
      <span className="swatch-value">{shown.toUpperCase()}</span>
      <input
        id={id}
        type="color"
        className="swatch"
        value={shown}
        onChange={(e) => {
          setShown(e.target.value)
          take(e.target.value)
        }}
      />
    </div>
  )
}

type StackChange = (next: (v: FinishState) => FinishState) => void

/** one effect's dials: its line, then a range per param, double-click to reset */
export function EffectDials({
  f,
  state,
  onChange,
  idPrefix,
  disabled,
}: {
  f: Finish
  state: FinishState
  onChange: StackChange
  idPrefix: string
  disabled?: boolean
}) {
  const held = state[f.id]
  return (
    <>
      <p className="note">{f.blurb}</p>
      {f.params.map((spec) => {
        const id = `${idPrefix}-${f.id}-${spec.key}`
        const at = held?.params[spec.key] ?? spec.default
        return (
          <div className="ctl" key={spec.key}>
            <div className="ctl-head">
              <label htmlFor={id}>{spec.label}</label>
              <output htmlFor={id} className={at === spec.default ? 'is-default' : undefined}>
                {at}
              </output>
            </div>
            <input
              id={id}
              type="range"
              min={spec.min}
              max={spec.max}
              step={spec.step}
              disabled={disabled}
              value={at}
              onChange={(e) =>
                onChange((v) => ({
                  ...v,
                  [f.id]: { ...v[f.id], params: { ...v[f.id].params, [spec.key]: Number(e.target.value) } },
                }))
              }
              onDoubleClick={() =>
                onChange((v) => ({
                  ...v,
                  [f.id]: { ...v[f.id], params: { ...v[f.id].params, [spec.key]: spec.default } },
                }))
              }
            />
          </div>
        )
      })}
    </>
  )
}

/**
 * A stack of switch-gated effects with their dials — the picture's effects.
 *
 * Dimmed rather than absent when off, which is Ditther's one really good idea:
 * you can see what you are not using and what turning it on would cost.
 */
export function EffectStack({
  list,
  state,
  onChange,
  idPrefix,
}: {
  list: Finish[]
  state: FinishState
  onChange: StackChange
  idPrefix: string
}) {
  return (
    <>
      {list.map((f) => {
        const on = !!state[f.id]?.on
        return (
          <div className={on ? 'finish' : 'finish is-off'} key={f.id}>
            <div className="finish-head">
              <span className="finish-name">{f.name}</span>
              <input
                type="checkbox"
                role="switch"
                className="ctl-switch"
                checked={on}
                aria-label={f.name}
                onChange={(e) => onChange((v) => ({ ...v, [f.id]: { ...v[f.id], on: e.target.checked } }))}
              />
            </div>
            <EffectDials f={f} state={state} onChange={onChange} idPrefix={idPrefix} disabled={!on} />
          </div>
        )
      })}
    </>
  )
}

/** "+ Add finish": the finishes that are off, each coming back with its dials as left */
export function AddFinish({ finishes, onAdd }: { finishes: FinishState; onAdd: (id: string) => void }) {
  const off = addable(finishes)
  if (off.length === 0) return null
  return (
    <div className="add-finish">
      <Menu
        label="+ Add finish"
        items={off.map((f) => ({ id: f.id, label: f.name, note: f.blurb }))}
        onPick={onAdd}
      />
    </div>
  )
}

const ORDER_NOTE =
  'Applied top to bottom, in a fixed order: the two that resample the sheet first, while there is still a sheet to read, and grain over whatever came out.'

/**
 * Every finish on the sheet, as a list you open one at a time.
 *
 * What the Finishes row selects, and what the Finishes chip opens on a phone:
 * the finishes that are on in the order they apply, the one you tap open in
 * place, and "+ Add finish" at the foot.
 */
export function FinishesPanel({
  finishes,
  onChange,
  open,
  onOpen,
  onRemove,
  onAdd,
  hidden,
  onToggleHidden,
}: {
  finishes: FinishState
  onChange: StackChange
  open: string | null
  onOpen: (id: string | null) => void
  onRemove: (id: string) => void
  onAdd: (id: string) => void
  hidden: ReadonlySet<string>
  onToggleHidden: (id: string) => void
}) {
  const on = finishesOn(finishes)
  return (
    <>
      {on.length === 0 ? (
        <p className="note">
          No finish on this sheet. A finish is a pass over the whole printed page — a scanner, a riso, grain.
        </p>
      ) : (
        <div className="finish-list">
          {on.map((f) => {
            const isOpen = open === f.id
            const off = hidden.has(f.id)
            return (
              <div className={['finish-item', isOpen ? 'is-open' : '', off ? 'is-hidden' : ''].filter(Boolean).join(' ')} key={f.id}>
                <div className="finish-item-row">
                  <button
                    type="button"
                    className="finish-item-head"
                    aria-expanded={isOpen}
                    onClick={() => onOpen(isOpen ? null : f.id)}
                  >
                    <span className="finish-name">{f.name}</span>
                    {off && <span className="finish-item-hidden">hidden</span>}
                    <span className="finish-item-chev" aria-hidden="true">
                      {isOpen ? '⌃' : '⌄'}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="layer-eye"
                    aria-label={off ? `Show ${f.name}` : `Hide ${f.name}`}
                    aria-pressed={off}
                    onClick={() => onToggleHidden(f.id)}
                  >
                    {off ? '○' : '◉'}
                  </button>
                </div>
                {isOpen && (
                  <div className="finish-item-body">
                    <EffectDials f={f} state={finishes} onChange={onChange} idPrefix="finishes" />
                    <button type="button" className="text-btn" onClick={() => onRemove(f.id)}>
                      Remove {f.name}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      <AddFinish finishes={finishes} onAdd={onAdd} />
      {on.length > 1 && <p className="note">{ORDER_NOTE}</p>}
    </>
  )
}

/** one finish, selected from its own row: its dials, and the way to take it off */
export function FinishPanel({
  f,
  finishes,
  onChange,
  onRemove,
}: {
  f: Finish
  finishes: FinishState
  onChange: StackChange
  onRemove: () => void
}) {
  const on = finishesOn(finishes)
  return (
    <>
      <Section title="Dials">
        <EffectDials f={f} state={finishes} onChange={onChange} idPrefix="finish" />
      </Section>
      <Section title="Layer">
        <p className="note">
          {on.length > 1
            ? `${on.findIndex((x) => x.id === f.id) + 1} of ${on.length}. ${ORDER_NOTE}`
            : 'The only finish on this sheet.'}
        </p>
        <button type="button" className="text-btn" onClick={onRemove}>
          Remove {f.name}
        </button>
      </Section>
    </>
  )
}
