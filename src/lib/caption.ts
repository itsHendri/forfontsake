import { SITE } from './brand'
import { encodeState, escapeForPost, type WorkbenchState } from './urlState'

/**
 * What a post says under the sheet.
 *
 * Written for the person posting rather than left to them, because a week of
 * posts is a week of writing the same three facts — what it is, what it was
 * made from, where to make one — and the one that matters most is the link
 * back to *this* font. The workbench state is already a link, so the caption
 * carries it: whoever sees the post can open the exact font and keep going.
 *
 * Two lengths. `long` is for Instagram and LinkedIn, which have room and want
 * hashtags. `short` fits X and Bluesky, where the state link alone can run to
 * two hundred characters — so it carries the bare address instead and leaves
 * the long one for a reply.
 */
export interface Caption {
  long: string
  short: string
  link: string
}

/** the most a short caption may be — X's limit, which is under Bluesky's */
export const SHORT_LIMIT = 280

const TAGS = '#typography #typedesign #fontdesign #lettering #typespecimen'

/** the state as a link that survives being pasted into a post — see `escapeForPost` */
export function stateLink(state: WorkbenchState): string {
  return `${SITE}#${escapeForPost(encodeState(state))}`
}

export function buildCaption(p: { word: string; chainName: string; fontLabel: string; state: WorkbenchState }): Caption {
  const link = stateLink(p.state)
  const what = `${p.chainName} on ${p.fontLabel}`
  // the word is often the treatment's own name, and saying it twice says nothing
  const said = p.word.trim().toLowerCase() === p.chainName.toLowerCase() ? `${what}.` : `“${p.word}” — ${what}.`
  const long = [
    said,
    `Made in the browser with For Font’s Sake. Open this exact font and make it yours:`,
    link,
    '',
    TAGS,
  ].join('\n')

  const bare = SITE.replace(/^https:\/\//, '').replace(/\/$/, '')
  let short = `${what}, made in the browser. Make your own at ${bare} #typography`
  // a name somebody typed can be long; trim the description, never the address
  if (short.length > SHORT_LIMIT) {
    const room = SHORT_LIMIT - (short.length - what.length) - 1
    short = short.replace(what, `${what.slice(0, Math.max(0, room))}…`)
  }
  return { long, short, link }
}

/** the caption as the kit's text file: both lengths, labelled */
export function captionFile(c: Caption): string {
  return `Instagram · LinkedIn · Threads\n\n${c.long}\n\n———\n\nX · Bluesky\n\n${c.short}\n`
}
