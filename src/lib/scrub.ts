import { useEffect, useRef, type MouseEvent, type PointerEvent } from 'react'

/**
 * Drag a label sideways to change its number.
 *
 * Every tool a designer already uses does this, Figma, Webflow, Framer and
 * Blender among them. The track is for big moves and the steppers for one step,
 * so the label covers the moves in between without hunting for the thumb. Shift
 * slows it down for fine work and Alt speeds it up, which is how DialKit splits
 * fine, normal and coarse.
 */
export interface ScrubRange {
  min: number
  max: number
  step: number
}

/** how far a drag must travel before it counts as one, so a plain click still focuses */
const THRESHOLD_PX = 3

/**
 * How much one pixel of drag moves the value.
 *
 * The whole range fits in about 240 px, which is the width of the rail, but a
 * step never takes more than six pixels. Without that floor, a range with only
 * a few stops, like Depth, would feel stuck. A field with no range, like X and Y,
 * moves one step per pixel, the way the pointer would move the word itself.
 */
export function unitsPerPixel(r: ScrubRange, mods: { shiftKey: boolean; altKey: boolean }): number {
  const span = r.max - r.min
  const base = Number.isFinite(span) && span > 0 ? Math.max(span / 240, r.step / 6) : r.step
  if (mods.shiftKey) return base / 10
  if (mods.altKey) return base * 4
  return base
}

interface Options {
  value: number
  range: ScrubRange
  onChange: (value: number) => void
  /** snaps a raw value to the field's step and keeps it inside its range */
  settle: (value: number) => number
  disabled?: boolean
}

/**
 * Pointer handlers to spread onto the element that is dragged.
 *
 * The drag uses pointer capture rather than pointer lock. Pointer lock hides
 * the cursor and Chrome puts up a banner about it, which is a lot for a
 * website to do to somebody who only wanted to nudge a number.
 */
export function useScrub({ value, range, onChange, settle, disabled }: Options) {
  const drag = useRef<{ id: number; start: number; startX: number; lastX: number; acc: number; moved: boolean } | null>(
    null,
  )
  /** set by a drag, so the click that follows its release does not also focus the control */
  const swallowClick = useRef(false)
  const live = useRef({ onChange, settle, range })
  useEffect(() => {
    live.current = { onChange, settle, range }
  })

  const end = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    swallowClick.current = d.moved
    document.documentElement.classList.remove('is-scrubbing')
  }

  return {
    onPointerDown(e: PointerEvent<HTMLElement>) {
      if (disabled || e.button !== 0) return
      drag.current = { id: e.pointerId, start: value, startX: e.clientX, lastX: e.clientX, acc: 0, moved: false }
      e.currentTarget.setPointerCapture?.(e.pointerId)
    },
    onPointerMove(e: PointerEvent<HTMLElement>) {
      const d = drag.current
      if (!d || d.id !== e.pointerId) return
      if (!d.moved) {
        if (Math.abs(e.clientX - d.startX) < THRESHOLD_PX) return
        d.moved = true
        // the cursor stays a resize arrow even when the pointer leaves the label
        document.documentElement.classList.add('is-scrubbing')
      }
      const { onChange: change, settle: snap, range: r } = live.current
      d.acc += (e.clientX - d.lastX) * unitsPerPixel(r, e)
      d.lastX = e.clientX
      change(snap(d.start + d.acc))
    },
    onPointerUp: end,
    onPointerCancel: end,
    onClick(e: MouseEvent<HTMLElement>) {
      if (swallowClick.current) {
        swallowClick.current = false
        e.preventDefault()
      }
    },
  }
}
