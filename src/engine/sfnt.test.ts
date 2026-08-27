import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { listTables, stripTables } from './sfnt'

const source = readFileSync('public/fonts/abrilfatface/font.ttf')
const bytes = new Uint8Array(source)

describe('stripTables', () => {
  it('lists the tables in a real font', () => {
    const tags = listTables(bytes)
    expect(tags).toContain('glyf')
    expect(tags).toContain('head')
    expect(tags).toContain('GSUB')
  })

  it('removes only what it is asked to', () => {
    const out = stripTables(bytes, ['GSUB'])
    const tags = listTables(out)
    expect(tags).not.toContain('GSUB')
    expect(tags).toContain('GPOS')
    expect(tags).toContain('glyf')
    expect(tags.length).toBe(listTables(bytes).length - 1)
  })

  it('keeps the directory sorted by tag', () => {
    const tags = listTables(stripTables(bytes, ['GSUB']))
    expect([...tags].sort()).toEqual(tags)
  })

  it('leaves the font alone when nothing matches', () => {
    const out = stripTables(bytes, ['ZZZZ'])
    expect(listTables(out)).toEqual(listTables(bytes))
  })

  it('writes a head checksum that validates', () => {
    const out = stripTables(bytes, ['GSUB'])
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
    // find head, zero its adjustment, and confirm the sum comes back to the
    // magic constant the spec requires
    const n = view.getUint16(4)
    let headOffset = -1
    for (let i = 0; i < n; i++) {
      const rec = 12 + i * 16
      const tag = String.fromCharCode(
        view.getUint8(rec),
        view.getUint8(rec + 1),
        view.getUint8(rec + 2),
        view.getUint8(rec + 3),
      )
      if (tag === 'head') headOffset = view.getUint32(rec + 8)
    }
    expect(headOffset).toBeGreaterThan(0)

    const stored = view.getUint32(headOffset + 8)
    const copy = new Uint8Array(out)
    new DataView(copy.buffer).setUint32(headOffset + 8, 0)
    let sum = 0
    const cv = new DataView(copy.buffer)
    for (let i = 0; i + 4 <= copy.length; i += 4) sum = (sum + cv.getUint32(i)) >>> 0
    expect(stored).toBe((0xb1b0afba - sum) >>> 0)
  })
})
