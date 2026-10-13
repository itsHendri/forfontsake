import { describe, it, expect } from 'vitest'
import { SHORT_LIMIT, buildCaption, captionFile } from './caption'
import { decodeState, type WorkbenchState } from './urlState'
import { defaults, getTreatment } from '../engine/treatments/registry'

const state: WorkbenchState = {
  fontId: 'pirataone',
  seed: 1337,
  alternates: 3,
  text: 'Halftone letters',
  chain: [
    { id: 'halftone', params: defaults(getTreatment('halftone')) },
    { id: 'grit', params: defaults(getTreatment('grit')) },
  ],
}

const caption = (over: Partial<Parameters<typeof buildCaption>[0]> = {}) =>
  buildCaption({ word: 'Halftone', chainName: 'Halftone + Grit', fontLabel: 'Pirata One', state, ...over })

describe('the caption', () => {
  it('links back to the exact font', () => {
    const { link, long } = caption()
    expect(link.startsWith('https://forfontsake.xyz/#')).toBe(true)
    expect(long).toContain(link)
    // pasted into a post, the separators are escaped so the link is not cut short
    expect(link).not.toContain('|')
    const back = decodeState(link.slice(link.indexOf('#')))
    expect(back?.fontId).toBe('pirataone')
    expect(back?.seed).toBe(1337)
    expect(back?.chain.map((s) => s.id)).toEqual(['halftone', 'grit'])
  })

  it('says what the font is and what it was made from', () => {
    const { long, short } = caption()
    for (const text of [long, short]) {
      expect(text).toContain('Halftone + Grit on Pirata One')
    }
  })

  it('keeps the short one inside X’s limit, however long the name', () => {
    expect(caption().short.length).toBeLessThanOrEqual(SHORT_LIMIT)
    const long = caption({ fontLabel: 'A'.repeat(400) }).short
    expect(long.length).toBeLessThanOrEqual(SHORT_LIMIT)
    // the address survives the trim
    expect(long).toContain('forfontsake.xyz')
  })

  it('does not say the word twice when it is the treatment’s own name', () => {
    expect(caption({ word: 'Halftone', chainName: 'Halftone' }).long.startsWith('Halftone on Pirata One.')).toBe(true)
    expect(caption({ word: 'Swell' }).long.startsWith('“Swell” —')).toBe(true)
  })

  it('writes both into one file, labelled for where each goes', () => {
    const file = captionFile(caption())
    expect(file).toContain('Instagram')
    expect(file).toContain('X · Bluesky')
    expect(file).toContain(caption().link)
  })
})
