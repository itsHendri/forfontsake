/**
 * Wrapping a finished font for the web: WOFF and WOFF2.
 *
 * Both formats are containers. The tables inside them are the *same bytes* as
 * the TTF — WOFF compresses each table with zlib, WOFF2 concatenates them all
 * and Brotlis the lot — so nothing here touches an outline, a name or a
 * feature. That is the whole point of doing it this way.
 *
 * The obvious alternative was to reopen the finished TTF in Font Flux and ask
 * it for a different format, which is four lines. It does not work, and it
 * fails in the two ways that matter:
 *
 * 1. It rewrites GSUB. The library rebuilds layout tables from its own parsed
 *    model, which is exactly why `fontio` splices our own GSUB into the
 *    finished binary in the first place — see `gsub.ts`. Round-tripping hands
 *    the table straight back to the code we went to the trouble of bypassing.
 * 2. Its WOFF2 is broken on real fonts. Measured on Anton with three cuts:
 *    the file it produced was rejected by the OpenType Sanitiser with
 *    "Failed to convert WOFF 2.0 font to SFNT", which is a browser refusing
 *    the font. Pirata One hid it, the way it hid the GSUB problem, because
 *    almost nothing in it is a real feature.
 *
 * So the containers are written here, over bytes that have already passed
 * validation, and the tables arrive at the other end untouched.
 *
 * The compressor is passed in rather than imported. This file is engine code:
 * no DOM, no Node built-ins, so it runs in the worker, in the CLI and in a
 * test — and each of those has a different way to deflate.
 */

const SFNT_HEADER = 12
const SFNT_RECORD = 16

/**
 * The 63 tags WOFF2 can name in six bits, in the order the format defines.
 * Index 63 means "an arbitrary tag follows"; anything not on this list takes
 * that route and costs four bytes.
 */
const KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm',
  'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern',
  'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC',
  'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar',
  'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty',
  'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat',
  'Gloc', 'Feat', 'Sill',
]

/**
 * `glyf` and `loca` may be repacked into a form that compresses better, and
 * the transformation number *zero* is what says they were. Three means "left
 * alone", which is what we want: the tables are already the ones the sanitiser
 * accepted, and repacking them would be a second place for the outlines to be
 * wrong.
 */
const NULL_TRANSFORM_GLYF = 3

/** Deflate for WOFF, Brotli for WOFF2 — supplied by the caller. */
export type Compress = (data: Uint8Array) => Promise<Uint8Array>

interface SfntTable {
  tag: string
  data: Uint8Array
  checksum: number
}

/** the four-byte boundary every sfnt table is padded to */
const pad4 = (n: number) => (n + 3) & ~3

function readSfnt(input: Uint8Array): { flavor: number; tables: SfntTable[] } {
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength)
  const flavor = view.getUint32(0)
  const count = view.getUint16(4)
  const tables: SfntTable[] = []
  for (let i = 0; i < count; i++) {
    const at = SFNT_HEADER + i * SFNT_RECORD
    const tag = String.fromCharCode(
      view.getUint8(at),
      view.getUint8(at + 1),
      view.getUint8(at + 2),
      view.getUint8(at + 3),
    )
    const checksum = view.getUint32(at + 4)
    const offset = view.getUint32(at + 8)
    const length = view.getUint32(at + 12)
    if (offset + length > input.byteLength) {
      throw new Error(`the ${tag} table runs past the end of the font`)
    }
    tables.push({ tag, checksum, data: input.subarray(offset, offset + length) })
  }
  // Both containers store their directories in tag order, and a decoder
  // rebuilds the sfnt from that order — so sorting here is not tidiness.
  tables.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0))
  return { flavor, tables }
}

/** what the font weighs once a decoder has put the sfnt back together */
function sfntSize(tables: SfntTable[]): number {
  let size = SFNT_HEADER + tables.length * SFNT_RECORD
  for (const t of tables) size += pad4(t.data.byteLength)
  return size
}

/**
 * WOFF 1.0: the same table directory as an sfnt, plus a length, with every
 * table deflated on its own.
 *
 * A table that deflates to no less than it started stays uncompressed — the
 * format says so by letting the compressed and original lengths be equal, and
 * a few of ours (an eight-byte `gasp`) are in that position.
 */
export async function toWoff(input: Uint8Array, deflate: Compress): Promise<Uint8Array> {
  const { flavor, tables } = readSfnt(input)
  const compressed = await Promise.all(
    tables.map(async (t) => {
      const out = await deflate(t.data)
      return out.byteLength < t.data.byteLength ? out : t.data
    }),
  )

  const directory = 44 + tables.length * 20
  let total = directory
  const offsets = compressed.map((c) => {
    const at = total
    total = pad4(at + c.byteLength)
    return at
  })

  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  view.setUint32(0, 0x774f4646) // 'wOFF'
  view.setUint32(4, flavor)
  view.setUint32(8, total)
  view.setUint16(12, tables.length)
  view.setUint16(14, 0)
  view.setUint32(16, sfntSize(tables))
  view.setUint16(20, 1) // major version of this font, not of the format
  view.setUint16(22, 0)
  // no metadata block and no private block: 20 bytes of zeroes, already zero

  tables.forEach((t, i) => {
    const at = 44 + i * 20
    for (let c = 0; c < 4; c++) view.setUint8(at + c, t.tag.charCodeAt(c))
    view.setUint32(at + 4, offsets[i])
    view.setUint32(at + 8, compressed[i].byteLength)
    view.setUint32(at + 12, t.data.byteLength)
    view.setUint32(at + 16, t.checksum)
    out.set(compressed[i], offsets[i])
  })
  return out
}

/** WOFF2 writes lengths in a variable-width big-endian form, seven bits a byte */
function uintBase128(value: number): number[] {
  if (value === 0) return [0]
  const bytes: number[] = []
  for (let v = value; v > 0; v = Math.floor(v / 128)) bytes.unshift(v % 128)
  for (let i = 0; i < bytes.length - 1; i++) bytes[i] |= 0x80
  return bytes
}

/**
 * WOFF2: one Brotli stream over every table's bytes, end to end.
 *
 * No padding between tables in the compressed block — the decoder puts the
 * four-byte alignment back as it rebuilds the sfnt, and the lengths in the
 * directory are what tell it where each table stops. That was read off a file
 * fontTools produced rather than assumed, and it is what a test pins.
 */
export async function toWoff2(input: Uint8Array, brotli: Compress): Promise<Uint8Array> {
  const { flavor, tables } = readSfnt(input)

  const directory: number[] = []
  for (const t of tables) {
    const known = KNOWN_TAGS.indexOf(t.tag)
    const transform = t.tag === 'glyf' || t.tag === 'loca' ? NULL_TRANSFORM_GLYF : 0
    directory.push((transform << 6) | (known === -1 ? 63 : known))
    if (known === -1) for (let c = 0; c < 4; c++) directory.push(t.tag.charCodeAt(c))
    directory.push(...uintBase128(t.data.byteLength))
    // No transformLength: it is written only for a table that *was*
    // transformed, and with the null transform none of ours were.
  }

  let at = 0
  const block = new Uint8Array(tables.reduce((n, t) => n + t.data.byteLength, 0))
  for (const t of tables) {
    block.set(t.data, at)
    at += t.data.byteLength
  }
  const packed = await brotli(block)

  const head = 48 + directory.length
  const out = new Uint8Array(pad4(head + packed.byteLength))
  const view = new DataView(out.buffer)
  view.setUint32(0, 0x774f4632) // 'wOF2'
  view.setUint32(4, flavor)
  view.setUint32(8, out.byteLength)
  view.setUint16(12, tables.length)
  view.setUint16(14, 0)
  view.setUint32(16, sfntSize(tables))
  view.setUint32(20, packed.byteLength)
  view.setUint16(24, 1)
  view.setUint16(26, 0)
  // metadata and private blocks are absent, which is twenty zeroed bytes

  out.set(directory, 48)
  out.set(packed, head)
  return out
}

export type WebFontFormat = 'ttf' | 'woff' | 'woff2'

/** what each format is called and how it is served, in one place */
export const WEB_FONT_FORMATS: {
  id: WebFontFormat
  label: string
  extension: string
  mime: string
  note: string
}[] = [
  {
    id: 'ttf',
    label: 'TTF',
    extension: 'ttf',
    mime: 'font/ttf',
    note: 'Installs on a computer. Double-click it and every app can set your font.',
  },
  {
    id: 'woff2',
    label: 'WOFF2',
    extension: 'woff2',
    mime: 'font/woff2',
    note: 'For a website. The same font about a third of the size, and what every browser in use asks for first.',
  },
  {
    id: 'woff',
    label: 'WOFF',
    extension: 'woff',
    mime: 'font/woff',
    note: 'For a website that still has to answer a browser too old for WOFF2.',
  },
]
