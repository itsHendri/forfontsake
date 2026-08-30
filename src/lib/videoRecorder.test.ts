import { describe, it, expect } from 'vitest'
import { pickMimeType, extensionFor } from './videoRecorder'

describe('videoRecorder', () => {
  it('prefers mp4, because that is what people can post', () => {
    const picked = pickMimeType(() => true)
    expect(picked).toContain('mp4')
    expect(extensionFor(picked!)).toBe('mp4')
  })

  it('falls back to webm where mp4 cannot be written', () => {
    const picked = pickMimeType((t) => t.includes('webm'))
    expect(picked).toContain('webm')
    expect(extensionFor(picked!)).toBe('webm')
  })

  it('reports a browser that cannot record at all', () => {
    expect(pickMimeType(() => false)).toBeNull()
  })
})
