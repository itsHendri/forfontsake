/**
 * What the templates say when you have not said anything yet.
 *
 * A template is half layout and half copy — the account the gallery was drawn
 * from (Feliciano Type) is as much its word lists and book titles as its
 * hairlines — so each one ships with a few sets of lines rather than a lorem.
 * Shuffle steps through them; a line you type replaces them.
 *
 * Every string stays inside what the engine can draw: the glyph data is cut to
 * letters, numerals, the space and `. , ! ? & ' -`, and anything else is
 * dropped without a gap. No accents, colons, dashes or curly quotes, so a test
 * holds the bank to it.
 *
 * The passages are our own, the titles are in the public domain.
 */

const PRESS =
  'Every letter on this page began as an outline someone else drew, and was then grown, cut, pixelled or worn down by a handful of dials. Nothing here was drawn by hand. The face was made in a browser in a few minutes, and it installs like any other font, which is either the point or the joke, depending on the day you ask.'
const NIGHT =
  'The press ran through the night and the room smelled of oil and warm paper. By four the first sheets were dry enough to stack. Somebody always found the mistake at five, in the one word nobody had thought to check, set large across the top of the page where everyone would see it.'
const PROMISE =
  'A typeface is a promise that the same letter will look the same every time. This one keeps a looser promise. Each letter was grown from a drawing by a set of dials, and the dials were set by someone who wanted the page to feel a little alive and a little uneven, like a print pulled by hand on a damp morning.'

/** sets of lines, per template id; what each line means is the template's business */
export const COPY_BANK: Record<string, string[][]> = {
  stack: [
    ['Salt', 'Iron', 'Linen'],
    ['Harbour', 'Static', 'Velvet', 'Smoke'],
    ['Brass', 'Moss', 'Chalk'],
    ['North', 'Ferry', 'Lantern'],
  ],
  list: [
    ['Night bus routes', 'Hand-set proofs', 'Radio static', 'Second edition', 'Copper wire', 'Morning papers', 'Loud and clear'],
    ['Grilled sardines', 'Clams in garlic', 'Fried eel', 'Fish soup', 'Lemon tart', 'Black coffee'],
    ['Platform four', 'Last train out', 'Window seat', 'Tunnel lights', 'Terminus', 'Home by nine'],
  ],
  line: [['Is it legible yet?'], ['Set it loud.'], ['Ink, then paper.'], ['Say it bigger.'], ['Who drew this?']],
  waterfall: [['Lantern'], ['Harbour'], ['Proofs'], ['Velvet'], ['Ferry']],
  glyphs: [
    ['&Q', PRESS],
    ['Rg', NIGHT],
    ['Aa', PROMISE],
  ],
  title: [
    ['Night Edition', NIGHT],
    ['The Proof Room', PRESS],
    ['A Looser Promise', PROMISE],
  ],
  struck: [
    ['Plain', 'Neat', 'Safe', 'Strange'],
    ['Grotesk', 'Gothic', 'Antique', 'Yours'],
    ['Quiet', 'Polite', 'Careful', 'Loud'],
  ],
  turned: [
    ['Established!', 'Letterpress', 'Overprinted', 'Misregister', 'Night shift'],
    ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    ['Proof', 'Revise', 'Reprint', 'Bind', 'Ship'],
  ],
  cover: [
    ['Frankenstein', 'or', 'The Modern Prometheus', 'by Mary Shelley', 'The Night Press'],
    ['Moby-Dick', 'or', 'The Whale', 'by Herman Melville', 'The Harbour Press'],
    ['Walden', 'or', 'Life in the Woods', 'by Henry David Thoreau', 'The Pond Press'],
  ],
  frame: [
    ['A Small Treatise on the Weather of Letters', '&'],
    ['On the Habits of Ink and the Patience of Paper', '&'],
    ['Notes Toward a Louder Alphabet', '!'],
  ],
  testword: [['nhilm'], ['hamburgefonstiv'], ['Hamburg']],
  picture: [['Lobster'], ['Harbour'], ['Linen'], ['Bread']],
}

/** how many sets a template has to shuffle through; none means it takes no copy */
export const copySets = (id: string): number => COPY_BANK[id]?.length ?? 0

/** the lines a template sets at a shuffle position, wrapping round its own sets */
export function copyFor(id: string, pick: number): string[] {
  const sets = COPY_BANK[id]
  if (!sets || sets.length === 0) return []
  return sets[((pick % sets.length) + sets.length) % sets.length]
}
