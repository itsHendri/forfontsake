/**
 * Undo and redo, over whole snapshots.
 *
 * Every design tool has it and Compose did not, so a colour roll you did not
 * mean or a drag that went wrong could not be taken back. The room's look is
 * already one plain object, so the history is just the snapshots it passed
 * through: what was there before each change, and what was there before each
 * undo. Snapshots rather than commands, because a snapshot cannot be undone
 * wrongly — there is nothing to replay.
 */
export interface History<T> {
  past: T[]
  future: T[]
}

/** far enough back for an afternoon; a snapshot shares its strings, so this is cheap */
export const HISTORY_LIMIT = 100

export const emptyHistory = <T>(): History<T> => ({ past: [], future: [] })

/** a change happened: what was there before it goes on the past, and the future is gone */
export function record<T>(h: History<T>, before: T): History<T> {
  return { past: [...h.past, before].slice(-HISTORY_LIMIT), future: [] }
}

/** one step back from `now`, or null when there is nothing to go back to */
export function undo<T>(h: History<T>, now: T): { history: History<T>; to: T } | null {
  if (h.past.length === 0) return null
  const to = h.past[h.past.length - 1]
  return { history: { past: h.past.slice(0, -1), future: [now, ...h.future] }, to }
}

/** one step forward again, or null when nothing was undone */
export function redo<T>(h: History<T>, now: T): { history: History<T>; to: T } | null {
  if (h.future.length === 0) return null
  const [to, ...rest] = h.future
  return { history: { past: [...h.past, now].slice(-HISTORY_LIMIT), future: rest }, to }
}
