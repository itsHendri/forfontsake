import type { PathCommand } from './opentype'

export type Pt = { x: number; y: number }
export type Ring = Pt[]

const FLAT_STEP = 8

function addCurvePoints(out: Ring, from: Pt, ctrl: Pt[], to: Pt) {
  let chord = 0
  let prev = from
  for (const p of [...ctrl, to]) {
    chord += Math.hypot(p.x - prev.x, p.y - prev.y)
    prev = p
  }
  const n = Math.min(24, Math.max(2, Math.ceil(chord / FLAT_STEP)))
  for (let i = 1; i <= n; i++) {
    const t = i / n
    if (ctrl.length === 1) {
      const mt = 1 - t
      out.push({
        x: mt * mt * from.x + 2 * mt * t * ctrl[0].x + t * t * to.x,
        y: mt * mt * from.y + 2 * mt * t * ctrl[0].y + t * t * to.y,
      })
    } else {
      const mt = 1 - t
      out.push({
        x: mt ** 3 * from.x + 3 * mt * mt * t * ctrl[0].x + 3 * mt * t * t * ctrl[1].x + t ** 3 * to.x,
        y: mt ** 3 * from.y + 3 * mt * mt * t * ctrl[0].y + 3 * mt * t * t * ctrl[1].y + t ** 3 * to.y,
      })
    }
  }
}

export function commandsToRings(commands: PathCommand[]): Ring[] {
  const rings: Ring[] = []
  let ring: Ring = []
  let cursor: Pt = { x: 0, y: 0 }

  const closeRing = () => {
    if (ring.length >= 3) {
      const first = ring[0]
      const last = ring[ring.length - 1]
      if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-6) ring.pop()
      if (ring.length >= 3) rings.push(ring)
    }
    ring = []
  }

  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M':
        closeRing()
        cursor = { x: cmd.x, y: cmd.y }
        ring.push(cursor)
        break
      case 'L':
        cursor = { x: cmd.x, y: cmd.y }
        ring.push(cursor)
        break
      case 'Q':
        addCurvePoints(ring, cursor, [{ x: cmd.x1, y: cmd.y1 }], { x: cmd.x, y: cmd.y })
        cursor = { x: cmd.x, y: cmd.y }
        break
      case 'C':
        addCurvePoints(
          ring,
          cursor,
          [
            { x: cmd.x1, y: cmd.y1 },
            { x: cmd.x2, y: cmd.y2 },
          ],
          { x: cmd.x, y: cmd.y },
        )
        cursor = { x: cmd.x, y: cmd.y }
        break
      case 'Z':
        closeRing()
        break
    }
  }
  closeRing()
  return rings
}
