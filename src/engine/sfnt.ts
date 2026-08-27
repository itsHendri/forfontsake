/**
 * Removing tables from a finished font binary.
 *
 * Font Flux regenerates OpenType layout tables from its own parsed model, and
 * for fonts with real features it writes a GSUB the OpenType Sanitiser rejects
 * — which means browsers refuse the font outright. Nothing in its API removes
 * the offending data, so the table is cut out of the produced binary instead.
 *
 * Done here rather than by shelling out to fontTools so the same code can run
 * in the browser, where the export ultimately has to work.
 */

const HEADER = 12
const RECORD = 16

function tagAt(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  )
}

/** sum of a region as big-endian uint32s, with the tail zero-padded */
function checksum(bytes: Uint8Array, start: number, length: number): number {
  let sum = 0
  const view = new DataView(bytes.buffer, bytes.byteOffset)
  const whole = Math.floor(length / 4) * 4
  for (let i = 0; i < whole; i += 4) sum = (sum + view.getUint32(start + i)) >>> 0
  if (whole < length) {
    let tail = 0
    for (let i = 0; i < 4; i++) {
      tail = (tail << 8) >>> 0
      if (whole + i < length) tail = (tail + bytes[start + whole + i]) >>> 0
    }
    sum = (sum + tail) >>> 0
  }
  return sum >>> 0
}

export function listTables(input: ArrayBuffer | Uint8Array): string[] {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const n = view.getUint16(4)
  const tags: string[] = []
  for (let i = 0; i < n; i++) tags.push(tagAt(view, HEADER + i * RECORD))
  return tags
}

/** rebuild the font without the named tables */
export function stripTables(input: ArrayBuffer | Uint8Array, drop: string[]): Uint8Array<ArrayBuffer> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const unwanted = new Set(drop)

  const numTables = view.getUint16(4)
  const kept: { tag: string; checksum: number; offset: number; length: number }[] = []
  for (let i = 0; i < numTables; i++) {
    const rec = HEADER + i * RECORD
    const tag = tagAt(view, rec)
    if (unwanted.has(tag)) continue
    kept.push({
      tag,
      checksum: view.getUint32(rec + 4),
      offset: view.getUint32(rec + 8),
      length: view.getUint32(rec + 12),
    })
  }
  if (kept.length === numTables) return new Uint8Array(bytes)

  // the directory must stay sorted by tag
  kept.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0))

  const pad = (n: number) => (n + 3) & ~3
  let total = HEADER + kept.length * RECORD
  for (const t of kept) total += pad(t.length)

  const out = new Uint8Array(total)
  const outView = new DataView(out.buffer)
  outView.setUint32(0, view.getUint32(0)) // sfntVersion

  // the binary-search hints in the header have to match the new table count
  const n = kept.length
  const pow = Math.floor(Math.log2(n))
  const searchRange = 2 ** pow * 16
  outView.setUint16(4, n)
  outView.setUint16(6, searchRange)
  outView.setUint16(8, pow)
  outView.setUint16(10, n * 16 - searchRange)

  let cursor = HEADER + n * RECORD
  let headOffset = -1
  kept.forEach((t, i) => {
    const rec = HEADER + i * RECORD
    for (let k = 0; k < 4; k++) out[rec + k] = t.tag.charCodeAt(k)
    // table data is untouched, so its checksum still stands
    outView.setUint32(rec + 4, t.checksum)
    outView.setUint32(rec + 8, cursor)
    outView.setUint32(rec + 12, t.length)
    out.set(bytes.subarray(t.offset, t.offset + t.length), cursor)
    if (t.tag === 'head') headOffset = cursor
    cursor += pad(t.length)
  })

  // head carries a checksum over the whole file, computed with its own field
  // zeroed — so it has to be redone once everything else is in place
  if (headOffset >= 0) {
    outView.setUint32(headOffset + 8, 0)
    const sum = checksum(out, 0, out.length)
    outView.setUint32(headOffset + 8, (0xb1b0afba - sum) >>> 0)
  }

  return out
}
