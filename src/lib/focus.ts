/**
 * What Focus needs that is not a component: its modes, how many letters it
 * draws at once, what a character is called, and the words a letter is
 * judged in. Kept apart so the component file exports components only.
 */

export type FocusMode = 'one' | 'several' | 'compare'

/** the most letters Several shows at once — past this the tiles are too small to judge */
export const FOCUS_MAX = 12

/** what a character is called, for the bar and for a screen reader */
export function glyphName(ch: string): string {
  if (ch >= 'A' && ch <= 'Z') return `Capital ${ch}`
  if (ch >= 'a' && ch <= 'z') return `Lowercase ${ch}`
  if (ch >= '0' && ch <= '9') return `Figure ${ch}`
  return ch
}

export const codePoint = (ch: string) => `U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`

/**
 * Words to judge a letter in.
 *
 * A letter that looks right alone can look wrong among others, which is why a
 * font editor never shows a glyph by itself for long: type designers check a
 * lowercase between n and o, a capital between H and O, a figure between 0
 * and 1. Several letters are each framed by the same neighbour, so they are
 * read in the same company.
 */
export function contextFor(chars: string[]): string {
  const lower = chars.filter((c) => c >= 'a' && c <= 'z')
  const upper = chars.filter((c) => c >= 'A' && c <= 'Z')
  const digit = chars.filter((c) => c >= '0' && c <= '9')
  if (chars.length === 1) {
    const [c] = chars
    if (lower.length) return `nn${c}nn oo${c}oo`
    if (upper.length) return `HH${c}HH OO${c}OO`
    if (digit.length) return `00${c}00 11${c}11`
    return c
  }
  const runs: string[] = []
  if (upper.length) runs.push(`H${upper.slice(0, 8).join('H')}H`)
  if (lower.length) runs.push(`n${lower.slice(0, 8).join('n')}n`)
  if (digit.length) runs.push(`0${digit.slice(0, 8).join('0')}0`)
  return runs.join(' ')
}

