/**
 * Writing a GSUB table that rotates through alternate glyphs.
 *
 * The library's own GSUB writer produces a table the OpenType Sanitiser
 * rejects, so shipping alternates means building the table here. The scope is
 * deliberately narrow: one `calt` feature holding a rotation, not a general
 * feature compiler.
 *
 * The rotation is the trick real distressed and handwriting faces use. Each
 * glyph is substituted according to which variant the *previous* glyph ended up
 * as, so the cut cycles along a word:
 *
 *   after a default  → variant 1
 *   after variant 1  → variant 2
 *   after variant 2  → variant 3 … and the last wraps back to the default
 *
 * Contextual lookups see substitutions already made to their left in the same
 * pass, which is what carries the cycle forward. `calt` is on by default
 * everywhere, so this needs nothing switched on to work.
 */

export interface AlternateSet {
  /** glyph id of the default form */
  base: number
  /** glyph ids of the variants, in rotation order */
  variants: number[]
}

class Writer {
  private bytes: number[] = []

  get length() {
    return this.bytes.length
  }
  u8(v: number) {
    this.bytes.push(v & 0xff)
  }
  u16(v: number) {
    this.bytes.push((v >> 8) & 0xff, v & 0xff)
  }
  tag(t: string) {
    for (let i = 0; i < 4; i++) this.u8(t.charCodeAt(i))
  }
  /** reserve a 16-bit offset to patch once the target position is known */
  placeholder(): number {
    const at = this.bytes.length
    this.u16(0)
    return at
  }
  patch(at: number, value: number) {
    this.bytes[at] = (value >> 8) & 0xff
    this.bytes[at + 1] = value & 0xff
  }
  bytesOut(): Uint8Array {
    return new Uint8Array(this.bytes)
  }
}

/** Coverage format 1: a sorted list of glyph ids */
function coverage(w: Writer, glyphs: number[]) {
  const sorted = [...new Set(glyphs)].sort((a, b) => a - b)
  w.u16(1)
  w.u16(sorted.length)
  for (const g of sorted) w.u16(g)
}

/** SingleSubst format 2: an explicit replacement per covered glyph */
function singleSubst(w: Writer, pairs: [number, number][]) {
  const sorted = [...pairs].sort((a, b) => a[0] - b[0])
  const start = w.length
  w.u16(2)
  const covAt = w.placeholder()
  w.u16(sorted.length)
  for (const [, to] of sorted) w.u16(to)
  w.patch(covAt, w.length - start)
  coverage(
    w,
    sorted.map(([from]) => from),
  )
}

/**
 * ChainContextSubst format 3: match one glyph preceded by one glyph, then run
 * another lookup on the matched position.
 */
function chainContext(w: Writer, backtrack: number[], input: number[], lookupIndex: number) {
  const start = w.length
  w.u16(3)
  w.u16(1) // one backtrack position
  const backAt = w.placeholder()
  w.u16(1) // one input position
  const inputAt = w.placeholder()
  w.u16(0) // no lookahead
  w.u16(1) // one substitution
  w.u16(0) // at input position 0
  w.u16(lookupIndex)

  w.patch(backAt, w.length - start)
  coverage(w, backtrack)
  w.patch(inputAt, w.length - start)
  coverage(w, input)
}

function lookup(w: Writer, type: number, subtables: ((w: Writer) => void)[]) {
  const start = w.length
  w.u16(type)
  w.u16(0) // no flags
  w.u16(subtables.length)
  const offsets = subtables.map(() => w.placeholder())
  subtables.forEach((write, i) => {
    w.patch(offsets[i], w.length - start)
    write(w)
  })
}

/**
 * Build a GSUB table carrying a `calt` rotation over the given alternate sets.
 *
 * Every set must offer the same number of variants; a glyph with fewer would
 * fall out of step with the rotation and repeat sooner than its neighbours.
 */
export function buildRotatingGsub(sets: AlternateSet[], scripts = ['DFLT', 'latn']): Uint8Array {
  if (sets.length === 0) throw new Error('no alternate sets')
  const depth = sets[0].variants.length
  if (depth < 1) throw new Error('alternates need at least one variant')
  for (const s of sets) {
    if (s.variants.length !== depth) throw new Error('every glyph needs the same number of variants')
  }

  // rings[i] is every glyph currently showing variant i; ring 0 is the defaults
  const rings: number[][] = []
  rings.push(sets.map((s) => s.base))
  for (let v = 0; v < depth; v++) rings.push(sets.map((s) => s.variants[v]))
  const cycle = rings.length

  // one SingleSubst per step of the rotation: everything in ring 0 moves to
  // ring (step + 1). Nothing substitutes the last step, which wraps to default.
  const substLookups: [number, number][][] = []
  for (let step = 0; step < cycle - 1; step++) {
    substLookups.push(sets.map((s) => [s.base, s.variants[step]] as [number, number]))
  }

  const w = new Writer()
  w.u16(1) // major
  w.u16(0) // minor
  const scriptListAt = w.placeholder()
  const featureListAt = w.placeholder()
  const lookupListAt = w.placeholder()

  // --- script list --------------------------------------------------------
  w.patch(scriptListAt, w.length)
  const scriptListStart = w.length
  w.u16(scripts.length)
  const scriptOffsets: number[] = []
  for (const tag of scripts) {
    w.tag(tag)
    scriptOffsets.push(w.placeholder())
  }
  scripts.forEach((_, i) => {
    w.patch(scriptOffsets[i], w.length - scriptListStart)
    const scriptStart = w.length
    const langSysAt = w.placeholder()
    w.u16(0) // no named language systems
    w.patch(langSysAt, w.length - scriptStart)
    w.u16(0) // lookupOrder, always null
    w.u16(0xffff) // no required feature
    w.u16(1) // one feature
    w.u16(0) // feature index 0
  })

  // --- feature list -------------------------------------------------------
  w.patch(featureListAt, w.length)
  const featureListStart = w.length
  w.u16(1)
  w.tag('calt')
  const featureAt = w.placeholder()
  w.patch(featureAt, w.length - featureListStart)
  w.u16(0) // no feature params
  // the chain lookups run the substitution lookups, so only the chains are
  // listed here — the rotation would apply unconditionally otherwise
  w.u16(cycle - 1)
  for (let i = 0; i < cycle - 1; i++) w.u16(substLookups.length + i)

  // --- lookup list --------------------------------------------------------
  w.patch(lookupListAt, w.length)
  const lookupListStart = w.length
  const total = substLookups.length + (cycle - 1)
  w.u16(total)
  const lookupOffsets: number[] = []
  for (let i = 0; i < total; i++) lookupOffsets.push(w.placeholder())

  substLookups.forEach((pairs, i) => {
    w.patch(lookupOffsets[i], w.length - lookupListStart)
    lookup(w, 1, [(ww) => singleSubst(ww, pairs)])
  })

  for (let step = 0; step < cycle - 1; step++) {
    const idx = substLookups.length + step
    w.patch(lookupOffsets[idx], w.length - lookupListStart)
    // a default glyph preceded by a glyph from ring `step` advances to the next
    lookup(w, 6, [(ww) => chainContext(ww, rings[step], rings[0], step)])
  }

  return w.bytesOut()
}
