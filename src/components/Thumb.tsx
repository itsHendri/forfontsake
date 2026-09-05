/**
 * One treated word or letter, small.
 *
 * The layer cards and the preset chips both show what a step does rather than
 * naming it, which is the whole reason a preset can no longer be mistaken for
 * a button. Both draw it the same way — outlines are stored y-up, so every
 * consumer flips them, and doing that in one place keeps the convention from
 * drifting between the two.
 */
export interface Thumb {
  /** one path covering the whole sample, in font units, y-up */
  d: string
  /** the viewBox that frames it, already accounting for the flip */
  box: string
}

interface Props {
  thumb: Thumb | null
  /** drawn height in px; the width follows the sample */
  height: number
}

export function ThumbInk({ thumb, height }: Props) {
  if (!thumb) return null
  return (
    <svg viewBox={thumb.box} height={height} focusable="false" aria-hidden="true">
      <g transform="scale(1,-1)">
        <path d={thumb.d} />
      </g>
    </svg>
  )
}
