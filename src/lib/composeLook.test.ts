import { describe, it, expect } from 'vitest'
import { defaultLook, readLook } from './composeLook'
import { FINISHES } from './finish'

describe('the look Compose remembers', () => {
  it('opens on the defaults when nothing was kept', () => {
    expect(readLook(null)).toEqual(defaultLook())
    expect(readLook('junk')).toEqual(defaultLook())
  })

  it('comes back as it was saved', () => {
    const look = { ...defaultLook(), paletteIndex: 3, groundId: 'grid', formatId: 'story', length: 15, speed: 1.5 }
    look.finishes[FINISHES[0].id].on = true
    look.colours = { ink: '#112233' }
    expect(readLook(JSON.parse(JSON.stringify(look)))).toEqual(look)
  })

  it('drops what no longer exists, field by field', () => {
    const back = readLook({
      paletteIndex: 2,
      groundId: 'wash',
      formatId: 'banner',
      length: 7,
      speed: 99,
      motionModeId: 'nope',
      colours: { ink: 'red', paper: '#eeeeee' },
      finishes: { gone: { on: true }, [FINISHES[0].id]: { on: true, params: { nonsense: 3 } } },
    })
    const d = defaultLook()
    expect(back.paletteIndex).toBe(2)
    expect(back.groundId).toBe(d.groundId)
    expect(back.formatId).toBe(d.formatId)
    expect(back.length).toBe(d.length)
    expect(back.speed).toBe(d.speed)
    expect(back.motionModeId).toBe(d.motionModeId)
    expect(back.colours).toEqual({ paper: '#eeeeee' })
    expect(Object.keys(back.finishes).sort()).toEqual(FINISHES.map((f) => f.id).sort())
    expect(back.finishes[FINISHES[0].id].on).toBe(true)
    expect(back.finishes[FINISHES[0].id].params).toEqual(d.finishes[FINISHES[0].id].params)
  })

  it('keeps a finish dial inside its range', () => {
    const f = FINISHES.find((x) => x.params.length > 0)!
    const spec = f.params[0]
    const back = readLook({ finishes: { [f.id]: { on: true, params: { [spec.key]: spec.max + 100 } } } })
    expect(back.finishes[f.id].params[spec.key]).toBe(spec.default)
  })

  it('keeps the layout and what each template says', () => {
    const look = { ...defaultLook(), layoutId: 'cover', copy: { cover: { pick: 2 }, stack: { pick: 0, own: ['Rust', 'Tin'] } } }
    expect(readLook(JSON.parse(JSON.stringify(look)))).toEqual(look)
  })

  it('drops a layout or a template that no longer exists, and lines that are not text', () => {
    const back = readLook({
      layoutId: 'gone',
      copy: { gone: { pick: 1 }, ramp: { pick: 1 }, list: { pick: -3, own: [1, 2] }, line: { pick: 1.7 } },
    })
    expect(back.layoutId).toBe(defaultLook().layoutId)
    expect(back.copy).toEqual({ list: { pick: 0 }, line: { pick: 1 } })
  })
})
