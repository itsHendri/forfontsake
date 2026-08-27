import { FontFlux } from 'font-flux-js'
import { mulberry32 } from './prng'
import { pointCount } from './paths'
import { medianStrokeWidth, STROKE_SAMPLE_CHARS } from './measure'
import { stripTables, listTables } from './sfnt'
import { getTreatment, type ParamValues, type TreatmentContext } from './treatments/registry'
import type { Ring } from './flatten'

export interface DerivativeNames {
  /** display family name, e.g. "Calçada One" */
  familyName: string
  styleName: string
  designer: string
  /** the source font's licence, carried into the derivative */
  license: string
  licenseURL: string
  copyright: string
  description: string
  version: string
}

/** Reserved Font Names may not appear anywhere in a derivative (OFL 1.1 §3). */
export function violatesReservedNames(name: string, reserved: string[]): string | null {
  const n = name.toLowerCase()
  for (const r of reserved) if (r && n.includes(r.toLowerCase())) return r
  return null
}

/** PostScript names are ASCII, no spaces, and none of `[](){}<>/%`. */
export function toPostScriptName(family: string, style: string): string {
  const clean = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]/g, '')
  return `${clean(family)}-${clean(style) || 'Regular'}`.slice(0, 63)
}

/** one entry in the treatment chain */
export interface TreatmentStep {
  id: string
  params: ParamValues
}

export interface BuildOptions {
  /** raw bytes of the source font */
  source: ArrayBuffer
  chain: TreatmentStep[]
  names: DerivativeNames
  seed: number
  /** restrict treatment to these characters — for fast single-glyph runs */
  only?: string | null
  onProgress?: (fraction: number) => void
}

export interface BuildResult {
  /** TrueType bytes, ready to write or hand to a Blob */
  bytes: Uint8Array
  /** measured median stem width of the source, in font units */
  strokeWidth: number
  /** true when substitutions had to be dropped to produce a valid font */
  droppedSubstitutions: boolean
  glyphCount: number
  treatedCount: number
  maxPoints: number
  maxPointsGlyph: string
  totalPoints: number
}

interface FluxPoint {
  x: number
  y: number
  onCurve: boolean
}

interface FluxComponent {
  glyphIndex: number
  argument1?: number
  argument2?: number
  xScale?: number
  yScale?: number
  scale01?: number
  scale10?: number
  scale?: number
}

interface AnyGlyph {
  name?: string
  advanceWidth: number
  contours?: FluxPoint[][]
  components?: FluxComponent[]
}

/**
 * Resolve a glyph to plain outlines, following component references.
 *
 * Accented characters, and whole lowercase alphabets in caps-only faces, are
 * stored as references to other glyphs rather than as their own contours. A
 * treatment handed those sees an empty shape and silently produces nothing, so
 * every reference is followed and flattened before any treatment runs.
 */
export function decomposeGlyph(
  glyph: AnyGlyph | undefined,
  byIndex: (i: number) => AnyGlyph | undefined,
  depth = 0,
): Ring[] {
  if (!glyph || depth > 5) return []

  const rings: Ring[] = glyph.contours ? contoursToRings(glyph.contours) : []

  for (const c of glyph.components ?? []) {
    const dx = c.argument1 ?? 0
    const dy = c.argument2 ?? 0
    const a = c.xScale ?? c.scale ?? 1
    const b = c.scale01 ?? 0
    const cc = c.scale10 ?? 0
    const d = c.yScale ?? c.scale ?? 1
    for (const ring of decomposeGlyph(byIndex(c.glyphIndex), byIndex, depth + 1)) {
      rings.push(ring.map((p) => ({ x: a * p.x + cc * p.y + dx, y: b * p.x + d * p.y + dy })))
    }
  }
  return rings
}

/**
 * Contours come back as points flagged on/off curve; treatments work on
 * polygons. Note the explicit arrow — passing `flattenContour` straight to
 * `map` hands it the array index as its second argument, which is the
 * subdivision count, and silently drops every curve on the first contour.
 */
function contoursToRings(contours: FluxPoint[][]): Ring[] {
  return contours.map((c) => flattenContour(c))
}

/**
 * Flatten one contour's quadratic segments into a polygon.
 *
 * Font Flux hands back TrueType points where an off-curve point is a quadratic
 * control point, and two consecutive off-curve points imply an on-curve point
 * midway between them.
 */
export function flattenContour(points: FluxPoint[], steps = 8): Ring {
  if (points.length === 0) return []
  const out: Ring = []
  const n = points.length

  // find a starting on-curve point, synthesising one if the contour has none
  let startIdx = points.findIndex((p) => p.onCurve)
  let start: FluxPoint
  if (startIdx === -1) {
    const a = points[0]
    const b = points[n - 1]
    start = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, onCurve: true }
    startIdx = 0
  } else {
    start = points[startIdx]
  }

  let cursor = { x: start.x, y: start.y }
  out.push({ ...cursor })

  const at = (i: number) => points[((i % n) + n) % n]

  let i = startIdx + (points[startIdx]?.onCurve ? 1 : 0)
  const end = startIdx + n
  while (i <= end) {
    const pt = at(i)
    if (pt.onCurve) {
      cursor = { x: pt.x, y: pt.y }
      out.push({ ...cursor })
      i++
      continue
    }
    // quadratic: control is pt, endpoint is the next on-curve point, or the
    // implied midpoint when two control points sit next to each other
    const nxt = at(i + 1)
    const endPt = nxt.onCurve ? { x: nxt.x, y: nxt.y } : { x: (pt.x + nxt.x) / 2, y: (pt.y + nxt.y) / 2 }
    for (let s = 1; s <= steps; s++) {
      const t = s / steps
      const mt = 1 - t
      out.push({
        x: mt * mt * cursor.x + 2 * mt * t * pt.x + t * t * endPt.x,
        y: mt * mt * cursor.y + 2 * mt * t * pt.y + t * t * endPt.y,
      })
    }
    cursor = endPt
    i += nxt.onCurve ? 2 : 1
  }

  // drop a duplicated closing point
  if (out.length > 1) {
    const first = out[0]
    const last = out[out.length - 1]
    if (Math.hypot(first.x - last.x, first.y - last.y) < 0.01) out.pop()
  }
  return out
}

function signedArea(r: Ring): number {
  let a = 0
  for (let i = 0; i < r.length; i++) {
    const p = r[i]
    const q = r[(i + 1) % r.length]
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

/** collapsed slivers survive the boolean ops and only add noise to the glyph */
const MIN_CONTOUR_AREA = 4

/**
 * TrueType fills the opposite way round to PostScript: outer contours run
 * clockwise (negative area) and holes counter-clockwise. The path ops upstream
 * work in the PostScript convention, so every contour is reversed on the way
 * out. Get this wrong and counters fill solid while outers cancel — the glyph
 * comes out looking shredded even though the geometry is correct.
 */
function ringsToContours(rings: Ring[]): FluxPoint[][] {
  const out: FluxPoint[][] = []
  for (const r of rings) {
    if (r.length < 3) continue
    if (Math.abs(signedArea(r)) < MIN_CONTOUR_AREA) continue
    const reversed = [...r].reverse()
    out.push(reversed.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y), onCurve: true })))
  }
  return out
}

/**
 * Apply a treatment chain to every glyph and emit a TrueType font.
 *
 * The source font is opened and edited in place rather than rebuilt, so
 * metrics, cmap coverage, kerning and layout features survive untouched —
 * only the outlines change.
 */
export function buildTreatedFont({
  source,
  chain,
  names,
  seed,
  only,
  onProgress,
}: BuildOptions): BuildResult {
  const font = FontFlux.open(source)
  const glyphs = font.glyphs as Array<{
    name: string
    unicode?: number
    advanceWidth: number
    contours?: FluxPoint[][]
    components?: FluxComponent[]
  }>

  // measured once from the source, then shared by every glyph, so a treatment
  // sizes itself against this font's strokes rather than against the em
  const strokeSamples: Ring[][] = []
  for (const ch of STROKE_SAMPLE_CHARS) {
    const cp = ch.codePointAt(0)!
    if (!font.hasGlyph(cp)) continue
    const g = font.getGlyph(cp)
    strokeSamples.push(decomposeGlyph(g as AnyGlyph, (i) => font.glyphs[i] as AnyGlyph))
  }
  const strokeWidth = medianStrokeWidth(strokeSamples, font.info.unitsPerEm * 0.1)

  const allowed = only ? new Set([...only].map((c) => c.codePointAt(0)!)) : null
  const steps = chain.map((s) => ({ treatment: getTreatment(s.id), params: s.params }))

  let treatedCount = 0
  let maxPoints = 0
  let maxPointsGlyph = ''
  let totalPoints = 0
  let penX = 0

  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i]
    const skip = allowed !== null && !(g.unicode !== undefined && allowed.has(g.unicode))
    const hasShape = (g.contours?.length ?? 0) > 0 || (g.components?.length ?? 0) > 0

    if (!skip && hasShape) {
      const ctx: TreatmentContext = {
        // per-glyph seed, so a glyph looks the same wherever it appears and the
        // whole font is reproducible from one number
        rng: mulberry32(seed + i * 7919),
        unitsPerEm: font.info.unitsPerEm,
        strokeWidth,
        advanceWidth: g.advanceWidth,
        penX,
      }

      let rings = decomposeGlyph(g, (i) => glyphs[i])
      for (const { treatment, params } of steps) {
        rings = treatment.apply(rings, params, ctx)
        if (rings.length === 0) break
      }

      if (rings.length > 0) {
        g.contours = ringsToContours(rings)
        // the outlines are now the glyph's own, so the references must go or
        // the component would be drawn a second time on top
        if (g.components) g.components = []
        treatedCount++
        const pts = pointCount(rings)
        totalPoints += pts
        if (pts > maxPoints) {
          maxPoints = pts
          maxPointsGlyph = g.name
        }

        // treatments that grow a glyph need the advance to grow with them, or
        // the font sets solid
        const growth = steps.reduce((sum, s) => sum + (s.treatment.growth?.(s.params, ctx) ?? 0), 0)
        if (growth > 0) g.advanceWidth = Math.round(g.advanceWidth + growth)
      }
    }

    penX += g.advanceWidth
    onProgress?.((i + 1) / glyphs.length)
  }

  font.setInfo({
    familyName: names.familyName,
    styleName: names.styleName,
    fullName: `${names.familyName} ${names.styleName}`,
    postScriptName: toPostScriptName(names.familyName, names.styleName),
    uniqueID: `${names.familyName} ${names.styleName}; ${names.version}`,
    version: names.version,
    designer: names.designer,
    description: names.description,
    copyright: names.copyright,
    license: names.license,
    licenseURL: names.licenseURL,
    // hinting bytecode refers to point indices that no longer exist
    trademark: '',
  })
  font.setHinting({ cvt: null, fpgm: null, prep: null, gasp: null })

  // Export before validating. Font Flux's validate() resyncs `info` from the
  // stored source tables, which silently discards every name change made above
  // — and it stays discarded even if the names are re-applied afterwards. So
  // validate the bytes we actually produced, by reopening them, which is the
  // stronger check regardless.
  let bytes = new Uint8Array(font.export({ format: 'ttf' }))

  // Font Flux rebuilds GSUB from its own model and, for any font with real
  // features, writes one the OpenType Sanitiser rejects — which makes browsers
  // refuse the font entirely. Nothing in its API removes the data, so the table
  // is cut from the finished binary. Kerning lives in GPOS and survives;
  // ligatures and alternates do not.
  const droppedSubstitutions = listTables(bytes).includes('GSUB')
  if (droppedSubstitutions) bytes = stripTables(bytes, ['GSUB'])

  const report = FontFlux.open(bytes).validate()
  if (!report.valid) {
    const detail = (report.errors ?? report.issues ?? []).slice(0, 3).join('; ')
    throw new Error(`font failed validation: ${detail}`)
  }

  return {
    bytes,
    strokeWidth,
    droppedSubstitutions,
    glyphCount: glyphs.length,
    treatedCount,
    maxPoints,
    maxPointsGlyph,
    totalPoints,
  }
}
