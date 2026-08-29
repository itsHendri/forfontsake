import { decodeState, encodeState, type WorkbenchState } from './urlState'

/**
 * The shelf, kept across reloads.
 *
 * What gets stored is the state and nothing else — not the rendered outlines.
 * They are derived, they are the largest thing in memory by a wide margin, and
 * a stored copy would be a second source of truth that goes quietly wrong the
 * first time a treatment is tuned: the thumbnail would keep showing the old
 * shape while the same settings now produce a new one. Re-rendering on load
 * costs a few milliseconds and cannot drift.
 *
 * The format is `encodeState`, the same one the address bar uses. That is worth
 * more than it looks — a saved style and a shared link are then the same
 * object, there is one encoding to keep working rather than two, and the
 * tolerance already built into the URL path (unknown fonts rejected, missing
 * parameters filled from defaults) covers storage written by an older build for
 * free.
 */

const KEY = 'ffs:shelf:v1'

/** Matches the in-memory cap in App, so a long session cannot fill storage. */
export const SHELF_LIMIT = 12

/**
 * Every access is guarded. `localStorage` is not merely empty in a private
 * window or with site data blocked — reading it *throws*, and an exception here
 * would take down a workbench that has no need of storage to function.
 */
export function loadShelf(): WorkbenchState[] {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(KEY)
  } catch {
    return []
  }
  if (!raw) return []

  try {
    const lines = JSON.parse(raw)
    if (!Array.isArray(lines)) return []
    const out: WorkbenchState[] = []
    for (const line of lines) {
      if (typeof line !== 'string') continue
      const state = decodeState(line)
      // decodeState already refuses a mangled entry; one bad line drops itself
      // rather than emptying the shelf
      if (state) out.push(state)
    }
    return out.slice(0, SHELF_LIMIT)
  } catch {
    return []
  }
}

export function saveShelf(states: WorkbenchState[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(states.slice(0, SHELF_LIMIT).map(encodeState)))
  } catch {
    // Full, or refused. The shelf still works for this session; silently doing
    // less is the right failure here, because there is nothing the person could
    // usefully do about it and an error would interrupt work it did not affect.
  }
}
