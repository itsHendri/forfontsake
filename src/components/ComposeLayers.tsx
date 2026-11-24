import { useEffect, useRef } from 'react'
import type { FinishState } from '../lib/finish'
import { finishesOn, type LayerRow, type Selection } from '../lib/composeLayers'
import { AddFinish } from './ComposePanels'

/**
 * The sheet, said as its layers — Compose's left panel.
 *
 * Always open, as Figma's is (Hendri, 23 Oct): the list is how you reach the
 * things the canvas has nothing to click on, the finishes above all, and it
 * says what each layer is doing without anything being opened. The canvas is
 * the other way in, and the two select the same thing.
 */
export function ComposeLayers({
  rows,
  selected,
  onSelect,
  finishes,
  onAdd,
  onRemove,
  hidden,
  onToggleHidden,
}: {
  rows: LayerRow[]
  selected: Selection
  onSelect: (sel: Selection) => void
  finishes: FinishState
  onAdd: (id: string) => void
  onRemove: (id: string) => void
  /** finishes hidden from view without being removed */
  hidden: ReadonlySet<string>
  onToggleHidden: (id: string) => void
}) {
  return (
    <>
      <div className="layers-head">
        <h2 className="layers-title">Layers</h2>
        <AddFinish finishes={finishes} onAdd={onAdd} label="+ Finish" />
      </div>
      <ul className="layer-tree">
        {rows.map((r) => {
          const on = r.sel === selected
          const id = r.sel.startsWith('finish:') ? r.sel.slice('finish:'.length) : null
          const off = !!id && hidden.has(id)
          return (
            <li
              key={r.sel}
              className={['layer-item', r.nested ? 'is-nested' : '', on ? 'is-on' : '', off ? 'is-hidden' : '']
                .filter(Boolean)
                .join(' ')}
            >
              <button type="button" className="layer-item-row" aria-pressed={on} onClick={() => onSelect(r.sel)}>
                <span className="layer-icon" aria-hidden="true">
                  {r.icon}
                </span>
                <span className="layer-name">{r.name}</span>
                {r.sub && <span className="layer-sub">{r.sub}</span>}
              </button>
              {id && (
                <button
                  type="button"
                  className="layer-eye"
                  aria-label={off ? `Show ${r.name}` : `Hide ${r.name}`}
                  aria-pressed={off}
                  title={off ? 'Hidden — click to show' : 'Hide, without removing'}
                  onClick={() => onToggleHidden(id)}
                >
                  {off ? '○' : '◉'}
                </button>
              )}
              {id && (
                <button
                  type="button"
                  className="layer-remove"
                  aria-label={`Remove ${r.name}`}
                  title={`Remove ${r.name}`}
                  onClick={() => onRemove(id)}
                >
                  ×
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </>
  )
}

/**
 * The same list on a phone, turned sideways into chips: the sheet, the
 * finishes as one chip with a count, the word, the background, and the motion,
 * whose timeline a desktop keeps in a dock under the stage. A phone has no room
 * for a tree, and each chip opens its panel in the sheet below.
 */
export function LayerChips({
  rows,
  selected,
  onSelect,
  finishes,
  motion,
}: {
  rows: LayerRow[]
  selected: Selection
  onSelect: (sel: Selection) => void
  finishes: FinishState
  /** what the motion is (Still, Pulse, Custom…): the fifth chip, the phone's way to the timeline */
  motion: string
}) {
  const count = finishesOn(finishes).length
  // five chips run past a phone's width, so the one selected is scrolled into view
  const row = useRef<HTMLDivElement>(null)
  useEffect(() => {
    row.current?.querySelector('.is-on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [selected])
  const chips: LayerRow[] = [
    ...rows.filter((r) => !r.nested),
    { sel: 'motion', name: 'Motion', sub: motion, icon: '~' },
  ]
  return (
    <div className="layer-chips" role="group" aria-label="Layers" ref={row}>
      {chips.map((r) => {
        // a single finish selected on a desktop reads as the finishes here
        const on = r.sel === selected || (r.sel === 'finishes' && selected.startsWith('finish:'))
        return (
          <button
            type="button"
            key={r.sel}
            className={on ? 'layer-chip is-on' : 'layer-chip'}
            aria-pressed={on}
            onClick={() => onSelect(r.sel)}
          >
            <span className="layer-chip-icon" aria-hidden="true">
              {r.icon}
            </span>
            <span className="layer-chip-name">{r.name}</span>
            {r.sel === 'finishes' && count > 0 && <span className="layer-chip-count">{count}</span>}
            {r.sel === 'word' && r.sub === '~ moves' && <span aria-label="moves"> ~</span>}
          </button>
        )
      })}
    </div>
  )
}
