import type { Ring } from './flatten'
import type { Tile } from './mosaic'

export function ringsToPathD(rings: Ring[], dx = 0, dy = 0): string {
  let d = ''
  for (const r of rings) {
    if (r.length < 3) continue
    d += `M${(r[0].x + dx).toFixed(1)} ${(r[0].y + dy).toFixed(1)}`
    for (let i = 1; i < r.length; i++) d += `L${(r[i].x + dx).toFixed(1)} ${(r[i].y + dy).toFixed(1)}`
    d += 'Z'
  }
  return d
}

export function tilesToPathD(tiles: Tile[], dx = 0, dy = 0): string {
  return tiles.map((t) => ringsToPathD(t, dx, dy)).join('')
}
