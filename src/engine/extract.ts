import { FontFlux } from 'font-flux-js'
import { decomposeGlyph, type AnyGlyph } from './fontio'
import { medianStrokeWidth, STROKE_SAMPLE_CHARS } from './measure'

/**
 * Pull a font apart into the outlines the workbench draws with.
 *
 * This runs in two places that must not disagree: the build script that bakes
 * the seven shipped faces into `glyph-data.json`, and the page, when somebody
 * uploads a font of their own. An uploaded face has to behave exactly like a
 * shipped one — same charset, same stroke measurement, same rounding — or the
 * dials would mean subtly different things depending on where the font came
 * from. So it is one function, and neither caller has its own copy.
 *
 * No DOM and no filesystem: the build script hands it bytes off disk, the page
 * hands it bytes off a file input, and it does not know the difference.
 */

/** the glyphs the preview draws — enough to set a specimen, far short of a face */
export const PREVIEW_CHARSET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,!?&'-"

export interface ExtractedGlyphs {
  unitsPerEm: number
  ascender: number
  descender: number
  strokeWidth: number
  /** every glyph in the source face — what an export will actually cost */
  sourceGlyphs: number
  glyphs: Record<string, { adv: number; rings: number[][] }>
  missing: number
}

/**
 * What the font says about itself, for the licence note.
 *
 * Read rather than assumed. This tool exists to make derivatives, so whether
 * one is allowed is a real question, and the font is the only thing that can
 * answer it.
 */
export interface FontLicence {
  familyName: string
  designer: string
  copyright: string
  license: string
  licenseURL: string
  /**
   * OS/2 `fsType`, the embedding permission bits. 0 is installable; bit 1
   * (value 2) is the restrictive one. It is advisory metadata rather than the
   * licence itself, which is why it is reported next to the licence text and
   * not treated as a verdict.
   */
  fsType: number
}

export interface Extracted extends ExtractedGlyphs {
  licence: FontLicence
}

export function extractFont(source: ArrayBuffer): Extracted {
  const font = FontFlux.open(source)
  const info = font.info as unknown as Record<string, unknown>

  const glyphs: Record<string, { adv: number; rings: number[][] }> = {}
  let missing = 0
  for (const ch of PREVIEW_CHARSET) {
    const cp = ch.codePointAt(0)!
    if (!font.hasGlyph(cp)) {
      missing++
      continue
    }
    const g = font.getGlyph(cp)
    // follow component references, or caps-only faces lose their whole
    // lowercase and every accented character comes out blank
    const rings = decomposeGlyph(g as AnyGlyph, (i) => font.glyphs[i] as AnyGlyph)
    glyphs[ch] = {
      adv: g.advanceWidth,
      // flat [x,y,x,y,…] per ring, rounded — a third the size of point objects
      rings: rings.map((r) => r.flatMap((p) => [Math.round(p.x), Math.round(p.y)])),
    }
  }

  // Measured from the outlines just extracted rather than re-read from the
  // font, so it is the same number the treatments will size themselves against.
  const samples = [...STROKE_SAMPLE_CHARS]
    .filter((c) => glyphs[c])
    .map((c) =>
      glyphs[c].rings.map((flat) => {
        const ring: { x: number; y: number }[] = []
        for (let i = 0; i < flat.length; i += 2) ring.push({ x: flat[i], y: flat[i + 1] })
        return ring
      }),
    )

  const unitsPerEm = font.info.unitsPerEm
  return {
    unitsPerEm,
    ascender: font.info.ascender ?? 800,
    descender: font.info.descender ?? -200,
    strokeWidth: medianStrokeWidth(samples, unitsPerEm * 0.1),
    sourceGlyphs: font.glyphs.length,
    glyphs,
    missing,
    licence: {
      familyName: String(info.familyName ?? '').trim(),
      designer: String(info.designer ?? '').trim(),
      copyright: String(info.copyright ?? '').trim(),
      license: String(info.license ?? '').trim(),
      licenseURL: String(info.licenseURL ?? '').trim(),
      fsType: Number(info.fsType ?? 0),
    },
  }
}

export type LicenceVerdict = 'open' | 'unknown' | 'restricted'

/**
 * A reading of the licence, stated as what we can and cannot tell.
 *
 * Deliberately three outcomes rather than yes/no. Most fonts people have lying
 * around say nothing machine-readable at all, and calling that "allowed" would
 * be a claim the font never made — while calling it "forbidden" would block a
 * font somebody may well own. "Unknown" is the honest answer and the common one.
 */
export function readLicence(l: FontLicence): { verdict: LicenceVerdict; note: string } {
  const text = `${l.license} ${l.copyright}`.toLowerCase()

  // fsType bit 1 is Restricted Licence Embedding — the one the spec says means
  // the font may not be embedded or handed on without permission.
  if ((l.fsType & 0x0002) !== 0) {
    return {
      verdict: 'restricted',
      note: 'This font is marked Restricted Licence Embedding. It can be treated here, but do not pass the result on without checking the licence.',
    }
  }

  if (/open font license|\bofl\b|sil open font/.test(text)) {
    return {
      verdict: 'open',
      note: 'Open Font License. A derivative is allowed, must stay under the OFL, and may not carry a Reserved Font Name.',
    }
  }
  if (/apache license/.test(text)) {
    return { verdict: 'open', note: 'Apache License. A derivative is allowed; keep the notice.' }
  }
  if (/\bmit license\b/.test(text)) {
    return { verdict: 'open', note: 'MIT. A derivative is allowed; keep the notice.' }
  }
  if (/public domain|\bcc0\b/.test(text)) {
    return { verdict: 'open', note: 'Public domain. Do as you like.' }
  }

  return {
    verdict: 'unknown',
    note: l.license
      ? 'This font states a licence we cannot read automatically. Check it says you may make and share a modified version.'
      : 'This font carries no licence text. Check you are allowed to make and share a modified version before you pass one on.',
  }
}

/**
 * Reserved Font Names, guessed from the family name for an uploaded face.
 *
 * The OFL puts Reserved Font Names in the licence text, not in a field, so
 * there is nothing to read. The family's own first word is the overwhelmingly
 * common choice, and guessing it wrong only ever costs a naming warning the
 * person can read and act on — where guessing nothing at all lets them ship a
 * font whose name breaks the licence it inherited.
 */
export function guessReserved(familyName: string): string[] {
  const first = familyName.trim().split(/\s+/)[0]
  return first && first.length > 2 ? [first] : []
}
