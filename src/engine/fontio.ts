import { Font, Glyph, Path } from './opentype'
import type { FontType, GlyphType } from './opentype'
import { commandsToRings } from './flatten'
import { mosaicGlyph, type MosaicParams } from './mosaic'

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

export interface BuildOptions {
  source: FontType
  params: MosaicParams
  names: DerivativeNames
  /** restrict tiling to these characters (others pass through untouched) — for fast M1b runs */
  only?: string | null
  /** called with 0..1 as glyphs are processed */
  onProgress?: (fraction: number) => void
}

export interface BuildResult {
  font: FontType
  glyphCount: number
  tiledCount: number
  tileTotal: number
}

/**
 * Rebuild every glyph of `source` as mosaic tiles and assemble a new font.
 * Metrics, advances and cmap coverage are carried over from the source; only
 * the outlines change.
 */
export function buildMosaicFont({ source, params, names, only, onProgress }: BuildOptions): BuildResult {
  const total = source.glyphs.length
  const glyphs: GlyphType[] = []
  let tiledCount = 0
  let tileTotal = 0

  const allowed = only ? new Set([...only].map((c) => c.codePointAt(0)!)) : null

  for (let i = 0; i < total; i++) {
    const src = source.glyphs.get(i)
    const path = new Path()
    const skipTiling = allowed !== null && !(src.unicode !== undefined && allowed.has(src.unicode))

    const rings = skipTiling ? [] : commandsToRings(src.path.commands)
    if (skipTiling) {
      for (const cmd of src.path.commands) {
        if (cmd.type === 'M') path.moveTo(cmd.x, cmd.y)
        else if (cmd.type === 'L') path.lineTo(cmd.x, cmd.y)
        else if (cmd.type === 'Q') path.quadraticCurveTo(cmd.x1, cmd.y1, cmd.x, cmd.y)
        else if (cmd.type === 'C') path.curveTo(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y)
        else if (cmd.type === 'Z') path.close()
      }
    }
    if (rings.length > 0) {
      const { tiles } = mosaicGlyph(rings, { ...params, seed: params.seed + i * 7919 })
      if (tiles.length > 0) {
        tiledCount++
        tileTotal += tiles.length
      }
      for (const tile of tiles) {
        for (const ring of tile) {
          if (ring.length < 3) continue
          path.moveTo(Math.round(ring[0].x), Math.round(ring[0].y))
          for (let k = 1; k < ring.length; k++) path.lineTo(Math.round(ring[k].x), Math.round(ring[k].y))
          path.close()
        }
      }
    }

    // opentype.js will only map codepoint 0 to a glyph named exactly ".null",
    // so a source that calls it something else (Pirata One says "NULL") gets
    // renamed rather than losing the mapping. .notdef keeps no codepoint.
    const mapsNull = src.unicodes?.includes(0) ?? src.unicode === 0
    const name = mapsNull && src.name !== '.notdef' ? '.null' : (src.name ?? undefined)
    const keepsCodepoint = (cp: number) => cp !== 0 || name === '.null'
    const unicodes = (src.unicodes ?? []).filter(keepsCodepoint)

    const glyph = new Glyph({
      name,
      unicode: src.unicode !== undefined && keepsCodepoint(src.unicode) ? src.unicode : undefined,
      unicodes,
      index: i,
      advanceWidth: src.advanceWidth ?? 0,
      leftSideBearing: src.leftSideBearing,
      path,
    })
    glyphs.push(glyph)
    onProgress?.((i + 1) / total)
  }

  const font = new Font({
    familyName: names.familyName,
    styleName: names.styleName,
    unitsPerEm: source.unitsPerEm,
    ascender: source.ascender,
    descender: source.descender,
    glyphs,
  })

  // carry the source's vertical metrics rather than accepting defaults
  const srcOS2 = source.tables.os2
  const os2 = font.tables.os2 as Record<string, number>
  if (srcOS2) {
    for (const key of [
      'usWinAscent',
      'usWinDescent',
      'sTypoAscender',
      'sTypoDescender',
      'sTypoLineGap',
      'sxHeight',
      'sCapHeight',
    ]) {
      const v = (srcOS2 as Record<string, number>)[key]
      if (typeof v === 'number') os2[key] = v
    }
  }
  os2.fsType = 0 // installable embedding
  // hhea is generated at export time, so there is nothing to patch here; the
  // ascender/descender passed to the constructor drive it.

  // opentype.js v2 keys the name table by platform first: names[platform][field][lang]
  const nameFields = {
    fontFamily: { en: names.familyName },
    fontSubfamily: { en: names.styleName },
    fullName: { en: `${names.familyName} ${names.styleName}` },
    postScriptName: { en: toPostScriptName(names.familyName, names.styleName) },
    uniqueID: { en: `${names.familyName} ${names.styleName}; ${names.version}` },
    version: { en: names.version },
    designer: { en: names.designer },
    description: { en: names.description },
    copyright: { en: names.copyright },
    license: { en: names.license },
    licenseURL: { en: names.licenseURL },
    preferredFamily: { en: names.familyName },
    preferredSubfamily: { en: names.styleName },
  }

  const allNames = font.names as unknown as Record<string, Record<string, Record<string, string>>>
  for (const platform of ['macintosh', 'windows']) {
    allNames[platform] = { ...(allNames[platform] ?? {}), ...nameFields }
  }

  return { font, glyphCount: total, tiledCount, tileTotal }
}
