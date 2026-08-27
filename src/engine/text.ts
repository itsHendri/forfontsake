import type { FontType as Font } from './opentype'
import { commandsToRings, type Ring } from './flatten'

export interface ShapedGlyph {
  /** glyph outline rings in font units, y-up, at origin */
  rings: Ring[]
  /** pen x offset in font units */
  x: number
  glyphIndex: number
  char: string
}

export interface ShapedText {
  glyphs: ShapedGlyph[]
  width: number
  unitsPerEm: number
  ascender: number
  descender: number
}

export function shapeText(font: Font, text: string): ShapedText {
  const glyphs = font.stringToGlyphs(text)
  const shaped: ShapedGlyph[] = []
  let x = 0
  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i]
    const rings = commandsToRings(g.path.commands)
    shaped.push({ rings, x, glyphIndex: g.index, char: text[i] ?? '' })
    x += g.advanceWidth ?? 0
    if (i < glyphs.length - 1) x += font.getKerningValue(g, glyphs[i + 1])
  }
  return {
    glyphs: shaped,
    width: x,
    unitsPerEm: font.unitsPerEm,
    ascender: font.ascender,
    descender: font.descender,
  }
}
