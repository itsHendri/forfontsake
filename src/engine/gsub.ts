/**
 * Writing a GSUB table.
 *
 * The library's own writer produces a table the OpenType Sanitiser rejects, so
 * anything we want in GSUB has to be built here: the alternate rotation, and
 * the source font's own ligatures, which would otherwise be lost with it.
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

/** a rule carried over from the source font, with names already resolved */
export type CarriedRule =
  | { kind: 'single'; feature: string; from: number; to: number }
  | { kind: 'ligature'; feature: string; components: number[]; ligature: number }

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
    const padded = (t + '    ').slice(0, 4)
    for (let i = 0; i < 4; i++) this.u8(padded.charCodeAt(i))
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
 * LigatureSubst format 1.
 *
 * Coverage is over each ligature's *first* component, and each covered glyph
 * owns a set of the ligatures starting with it. Longer ligatures are written
 * first within a set so `ffl` is found before `fl`.
 */
function ligatureSubst(w: Writer, ligatures: { components: number[]; ligature: number }[]) {
  const byFirst = new Map<number, { components: number[]; ligature: number }[]>()
  for (const lig of ligatures) {
    if (lig.components.length < 2) continue
    const first = lig.components[0]
    const bucket = byFirst.get(first) ?? []
    bucket.push(lig)
    byFirst.set(first, bucket)
  }
  const firsts = [...byFirst.keys()].sort((a, b) => a - b)

  const start = w.length
  w.u16(1)
  const covAt = w.placeholder()
  w.u16(firsts.length)
  const setOffsets = firsts.map(() => w.placeholder())

  firsts.forEach((first, i) => {
    w.patch(setOffsets[i], w.length - start)
    const setStart = w.length
    const set = [...byFirst.get(first)!].sort((a, b) => b.components.length - a.components.length)
    w.u16(set.length)
    const ligOffsets = set.map(() => w.placeholder())
    set.forEach((lig, j) => {
      w.patch(ligOffsets[j], w.length - setStart)
      w.u16(lig.ligature)
      w.u16(lig.components.length)
      // the first component is implied by coverage and is not repeated
      for (let k = 1; k < lig.components.length; k++) w.u16(lig.components[k])
    })
  })

  w.patch(covAt, w.length - start)
  coverage(w, firsts)
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

interface LookupSpec {
  type: number
  write: (w: Writer) => void
}

interface FeatureSpec {
  tag: string
  lookups: number[]
}

function lookup(w: Writer, spec: LookupSpec) {
  const start = w.length
  w.u16(spec.type)
  w.u16(0) // no flags
  w.u16(1) // one subtable
  const at = w.placeholder()
  w.patch(at, w.length - start)
  spec.write(w)
}

function assemble(lookups: LookupSpec[], features: FeatureSpec[], scripts: string[]): Uint8Array {
  const w = new Writer()
  w.u16(1) // major
  w.u16(0) // minor
  const scriptListAt = w.placeholder()
  const featureListAt = w.placeholder()
  const lookupListAt = w.placeholder()

  // --- script list --------------------------------------------------------
  // every feature is offered under each script's default language system;
  // language-specific rules are not carried, so no LangSysRecords are needed
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
    w.u16(features.length)
    for (let f = 0; f < features.length; f++) w.u16(f)
  })

  // --- feature list -------------------------------------------------------
  w.patch(featureListAt, w.length)
  const featureListStart = w.length
  w.u16(features.length)
  const featureOffsets: number[] = []
  for (const f of features) {
    w.tag(f.tag)
    featureOffsets.push(w.placeholder())
  }
  features.forEach((f, i) => {
    w.patch(featureOffsets[i], w.length - featureListStart)
    w.u16(0) // no feature params
    w.u16(f.lookups.length)
    for (const idx of f.lookups) w.u16(idx)
  })

  // --- lookup list --------------------------------------------------------
  w.patch(lookupListAt, w.length)
  const lookupListStart = w.length
  w.u16(lookups.length)
  const lookupOffsets = lookups.map(() => w.placeholder())
  lookups.forEach((spec, i) => {
    w.patch(lookupOffsets[i], w.length - lookupListStart)
    lookup(w, spec)
  })

  return w.bytesOut()
}

/** feature tags we understand well enough to reproduce faithfully */
const CARRIED_FEATURES = new Set([
  'liga',
  'dlig',
  'hlig',
  'clig',
  'case',
  'ordn',
  'frac',
  'sups',
  'subs',
  'zero',
  'ss01',
  'ss02',
  'ss03',
  'ss04',
  'ss05',
  'smcp',
  'c2sc',
  'onum',
  'lnum',
  'tnum',
  'pnum',
])

export function isCarriedFeature(tag: string): boolean {
  return CARRIED_FEATURES.has(tag)
}

export interface GsubPlan {
  /** rotation over alternate cuts; omit for a font with a single cut */
  alternates?: AlternateSet[]
  /** ligatures and single substitutions preserved from the source */
  carried?: CarriedRule[]
  scripts?: string[]
}

/**
 * Build a GSUB carrying the source's own substitutions and, optionally, a
 * `calt` rotation over alternate cuts.
 *
 * Carried lookups are written first so they run before the rotation: a
 * ligature should form from the plain letters, rather than being missed
 * because one of them had already been swapped for a variant.
 */
export function buildGsub({ alternates = [], carried = [], scripts = ['DFLT', 'latn'] }: GsubPlan): Uint8Array {
  const lookups: LookupSpec[] = []
  const features: FeatureSpec[] = []

  // --- carried rules, grouped by the feature that owns them ----------------
  const byFeature = new Map<string, CarriedRule[]>()
  for (const rule of carried) {
    // the rotation owns calt; a source rule there would fight it
    if (rule.feature === 'calt' || !isCarriedFeature(rule.feature)) continue
    const bucket = byFeature.get(rule.feature) ?? []
    bucket.push(rule)
    byFeature.set(rule.feature, bucket)
  }

  for (const [tag, rules] of [...byFeature.entries()].sort()) {
    const indices: number[] = []

    const ligatures = rules.filter((r) => r.kind === 'ligature')
    if (ligatures.length > 0) {
      indices.push(lookups.length)
      lookups.push({
        type: 4,
        write: (w) =>
          ligatureSubst(
            w,
            ligatures.map((r) => ({ components: r.components, ligature: r.ligature })),
          ),
      })
    }

    const singles = rules.filter((r) => r.kind === 'single')
    if (singles.length > 0) {
      // one source glyph cannot map two ways within a lookup; the first wins
      const seen = new Map<number, number>()
      for (const r of singles) if (!seen.has(r.from)) seen.set(r.from, r.to)
      indices.push(lookups.length)
      lookups.push({ type: 1, write: (w) => singleSubst(w, [...seen.entries()]) })
    }

    if (indices.length > 0) features.push({ tag, lookups: indices })
  }

  // --- the rotation --------------------------------------------------------
  if (alternates.length > 0) {
    const depth = alternates[0].variants.length
    if (depth < 1) throw new Error('alternates need at least one variant')
    for (const s of alternates) {
      if (s.variants.length !== depth) throw new Error('every glyph needs the same number of variants')
    }

    // rings[i] is every glyph currently showing variant i; ring 0 is the defaults
    const rings: number[][] = [alternates.map((s) => s.base)]
    for (let v = 0; v < depth; v++) rings.push(alternates.map((s) => s.variants[v]))
    const cycle = rings.length

    const substStart = lookups.length
    for (let step = 0; step < cycle - 1; step++) {
      const pairs = alternates.map((s) => [s.base, s.variants[step]] as [number, number])
      lookups.push({ type: 1, write: (w) => singleSubst(w, pairs) })
    }

    const chainIndices: number[] = []
    for (let step = 0; step < cycle - 1; step++) {
      chainIndices.push(lookups.length)
      const target = substStart + step
      lookups.push({
        type: 6,
        write: (w) => chainContext(w, rings[step], rings[0], target),
      })
    }
    // only the chains are listed: the substitutions they invoke would otherwise
    // also apply unconditionally
    features.push({ tag: 'calt', lookups: chainIndices })
  }

  if (lookups.length === 0) throw new Error('nothing to write')
  return assemble(lookups, features, scripts)
}

/** convenience for the rotation alone */
export function buildRotatingGsub(sets: AlternateSet[], scripts = ['DFLT', 'latn']): Uint8Array {
  if (sets.length === 0) throw new Error('no alternate sets')
  return buildGsub({ alternates: sets, scripts })
}
