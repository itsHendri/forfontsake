import { describe, expect, it } from 'vitest'
import { brotliCompressSync, brotliDecompressSync, deflateSync, inflateSync } from 'node:zlib'
import { toWoff, toWoff2, WEB_FONT_FORMATS, type Compress } from './webfont'

const deflate: Compress = async (d) => new Uint8Array(deflateSync(d))
const brotli: Compress = async (d) => new Uint8Array(brotliCompressSync(d))

/**
 * A believable little sfnt: a directory and four tables, one of them `glyf`
 * so the null-transform flag has something to land on, one of them a tag WOFF2
 * cannot name in six bits, and one of them too small to be worth deflating so
 * the "store it instead" branch is exercised.
 */
function sfnt(tables: { tag: string; data: Uint8Array }[]): Uint8Array {
  const sorted = [...tables].sort((a, b) => (a.tag < b.tag ? -1 : 1))
  const pad4 = (n: number) => (n + 3) & ~3
  const header = 12 + sorted.length * 16
  let size = header
  const offsets = sorted.map((t) => {
    const at = size
    size = pad4(at + t.data.byteLength)
    return at
  })
  const out = new Uint8Array(size)
  const view = new DataView(out.buffer)
  view.setUint32(0, 0x00010000)
  view.setUint16(4, sorted.length)
  sorted.forEach((t, i) => {
    const at = 12 + i * 16
    for (let c = 0; c < 4; c++) view.setUint8(at + c, t.tag.charCodeAt(c))
    view.setUint32(at + 4, 0xdeadbeef)
    view.setUint32(at + 8, offsets[i])
    view.setUint32(at + 12, t.data.byteLength)
    out.set(t.data, offsets[i])
  })
  return out
}

const repeated = (n: number, byte = 0x41) => new Uint8Array(n).fill(byte)
/** four bytes cost more to deflate than to keep — a real `gasp` is eight */
const TINY = new Uint8Array([0x9e, 0x21, 0xc7, 0x04])

const FONT = sfnt([
  { tag: 'glyf', data: repeated(400) },
  { tag: 'loca', data: repeated(40, 0) },
  { tag: 'cmap', data: repeated(120, 0x7a) },
  { tag: 'Zany', data: TINY },
])

const tag = (b: Uint8Array, at: number) =>
  String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3])

describe('WOFF', () => {
  it('carries every table through byte for byte', async () => {
    const woff = await toWoff(FONT, deflate)
    const view = new DataView(woff.buffer)
    expect(tag(woff, 0)).toBe('wOFF')
    expect(view.getUint32(4)).toBe(0x00010000)
    expect(view.getUint32(8)).toBe(woff.byteLength)

    const count = view.getUint16(12)
    expect(count).toBe(4)
    const back = new Map<string, Uint8Array>()
    for (let i = 0; i < count; i++) {
      const at = 44 + i * 20
      const offset = view.getUint32(at + 4)
      const compLength = view.getUint32(at + 8)
      const origLength = view.getUint32(at + 12)
      const stored = woff.subarray(offset, offset + compLength)
      // equal lengths mean the table was left alone, which the format allows
      // and which a small or already-dense table earns
      back.set(tag(woff, at), compLength === origLength ? stored : new Uint8Array(inflateSync(stored)))
    }
    expect([...back.keys()].sort()).toEqual(['Zany', 'cmap', 'glyf', 'loca'])
    expect(back.get('glyf')).toEqual(repeated(400))
    expect(back.get('cmap')).toEqual(repeated(120, 0x7a))
    expect(back.get('Zany')).toEqual(TINY)
  })

  it('reports the size the font will be once it is put back together', async () => {
    const woff = await toWoff(FONT, deflate)
    // 12 + 4×16 directory, then each table rounded up to four bytes
    expect(new DataView(woff.buffer).getUint32(16)).toBe(12 + 64 + 400 + 40 + 120 + 4)
  })

  it('stores a table that deflating would only make bigger', async () => {
    const woff = await toWoff(FONT, deflate)
    const view = new DataView(woff.buffer)
    for (let i = 0; i < view.getUint16(12); i++) {
      const at = 44 + i * 20
      if (tag(woff, at) !== 'Zany') continue
      expect(view.getUint32(at + 8)).toBe(view.getUint32(at + 12))
      expect(view.getUint32(at + 12)).toBe(TINY.byteLength)
    }
  })
})

describe('WOFF2', () => {
  /** the directory, decoded the way the format says to read it */
  async function directory() {
    const woff2 = await toWoff2(FONT, brotli)
    const view = new DataView(woff2.buffer)
    const count = view.getUint16(12)
    const entries: { tag: string; known: number; transform: number; length: number }[] = []
    let at = 48
    for (let i = 0; i < count; i++) {
      const flags = woff2[at++]
      const known = flags & 0x3f
      const transform = flags >> 6
      let name: string
      if (known === 63) {
        name = tag(woff2, at)
        at += 4
      } else {
        name = ''
      }
      let length = 0
      for (;;) {
        const byte = woff2[at++]
        length = (length << 7) | (byte & 0x7f)
        if (!(byte & 0x80)) break
      }
      entries.push({ tag: name, known, transform, length })
    }
    return { woff2, view, entries, dataAt: at }
  }

  it('names the header the way a decoder looks for it', async () => {
    const { woff2, view } = await directory()
    expect(tag(woff2, 0)).toBe('wOF2')
    expect(view.getUint32(4)).toBe(0x00010000)
    expect(view.getUint32(8)).toBe(woff2.byteLength)
    expect(view.getUint32(16)).toBe(12 + 64 + 400 + 40 + 120 + 4)
  })

  it('leaves glyf and loca untransformed, which is version three', async () => {
    const { entries } = await directory()
    // tables are written in tag order: Zany, cmap, glyf, loca
    expect(entries.map((e) => e.transform)).toEqual([0, 0, 3, 3])
    expect(entries.map((e) => e.length)).toEqual([4, 120, 400, 40])
  })

  it('spends six bits on a tag it knows and four extra bytes on one it does not', async () => {
    const { entries } = await directory()
    expect(entries[0]).toMatchObject({ known: 63, tag: 'Zany' })
    // the index of each tag in the format's own table of 63
    expect(entries.slice(1).map((e) => e.known)).toEqual([0, 10, 11])
  })

  it('packs the tables end to end with no padding between them', async () => {
    const { woff2, view, entries, dataAt } = await directory()
    const block = new Uint8Array(
      brotliDecompressSync(woff2.subarray(dataAt, dataAt + view.getUint32(20))),
    )
    expect(block.byteLength).toBe(entries.reduce((n, e) => n + e.length, 0))

    let at = 0
    const back = new Map<string, Uint8Array>()
    for (const [i, name] of ['Zany', 'cmap', 'glyf', 'loca'].entries()) {
      back.set(name, block.subarray(at, at + entries[i].length))
      at += entries[i].length
    }
    expect(back.get('glyf')).toEqual(repeated(400))
    expect(back.get('cmap')).toEqual(repeated(120, 0x7a))
    expect(back.get('Zany')).toEqual(TINY)
  })

  it('is smaller than the font it wraps', async () => {
    const woff2 = await toWoff2(FONT, brotli)
    expect(woff2.byteLength).toBeLessThan(FONT.byteLength)
  })
})

describe('the formats offered', () => {
  it('agree with the extensions and mime types they are served under', () => {
    expect(WEB_FONT_FORMATS.map((f) => `${f.id} ${f.extension} ${f.mime}`)).toEqual([
      'ttf ttf font/ttf',
      'woff2 woff2 font/woff2',
      'woff woff font/woff',
    ])
  })

  it('say what each one is for, so the picker is not three file extensions', () => {
    for (const f of WEB_FONT_FORMATS) expect(f.note.length).toBeGreaterThan(30)
  })
})
