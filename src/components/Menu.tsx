import { useEffect, useId, useRef, useState } from 'react'

export interface MenuItem {
  id: string
  label: string
  /** the line under the label: what choosing this one gets you */
  note?: string
}

interface Props {
  /** what the button says when nothing is happening */
  label: string
  /** what the button says instead — a build in progress, or one just finished */
  busyLabel?: string | null
  items: MenuItem[]
  onPick: (id: string) => void
  disabled?: boolean
  /** one small line under the list: what is true of every choice in it */
  foot?: React.ReactNode
  /** the name the button answers to for a screen reader, if the label is not it */
  title?: string
}

/**
 * A button that opens the choice it is about to act on.
 *
 * The workbench used to put a format select *beside* Download, so leaving with
 * a font was two controls: pick the wrapper, then press the verb. Every tool
 * in this category does it the other way round — Canva, Adobe Express, Figma
 * all make Download the verb and hang the choice under it — because the choice
 * only exists once you have decided to download, and a select sitting there
 * permanently is a question asked of everybody who is not leaving.
 *
 * The note that used to ride the button as a tooltip moves into the rows,
 * where it describes the thing it is about rather than whatever was last
 * selected. One place instead of two.
 *
 * There was no menu anywhere in this project before this one, so this is the
 * pattern: a button with `aria-expanded`, a list of `menuitem`s, arrows and
 * Home/End to move, Escape to close and give the button its focus back, and a
 * click anywhere else to dismiss.
 */
export function Menu({ label, busyLabel, items, onPick, disabled, foot, title }: Props) {
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState(0)
  const id = useId()
  const wrap = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)

  // Closing returns focus to the button, because that is where the hand was:
  // a menu that dumps focus on the body leaves a keyboard at the top of the page.
  const close = (refocus = true) => {
    setOpen(false)
    if (refocus) button.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    // a scroll or a resize moves the button out from under the panel
    const onAway = () => setOpen(false)
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('resize', onAway)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('resize', onAway)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    // the first row takes focus so the keyboard is already in the list
    const el = list.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[at]
    el?.focus()
  }, [open, at])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      const last = items.length - 1
      setAt((i) =>
        e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? last
            : e.key === 'ArrowDown'
              ? (i + 1) % items.length
              : (i + last) % items.length,
      )
    }
  }

  const pick = (itemId: string) => {
    close()
    onPick(itemId)
  }

  return (
    <div className="menu" ref={wrap}>
      <button
        type="button"
        ref={button}
        className="save"
        title={title}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          setAt(0)
          setOpen((o) => !o)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault()
            setAt(0)
            setOpen(true)
          }
        }}
      >
        {busyLabel ?? label}
      </button>
      {open && (
        <div className="menu-panel" id={id} role="menu" ref={list} onKeyDown={onKey}>
          {items.map((it, i) => (
            <button
              type="button"
              role="menuitem"
              key={it.id}
              className="menu-item"
              tabIndex={i === at ? 0 : -1}
              onFocus={() => setAt(i)}
              onClick={() => pick(it.id)}
            >
              <span className="menu-item-label">{it.label}</span>
              {it.note && <span className="menu-item-note">{it.note}</span>}
            </button>
          ))}
          {foot && <p className="menu-foot">{foot}</p>}
        </div>
      )}
    </div>
  )
}
