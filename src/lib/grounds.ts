import type { Ground, PosterPalette } from './poster'

/**
 * The grounds beyond the first four: measured surfaces, grain, a maze, and four
 * material scans.
 *
 * The drawn ones follow the rule the first four set: a few SVG tags, coloured
 * from the palette, nothing to download. The scans are the one exception, for
 * materials code cannot fake (an ink roller, bookcloth, crumpled paper, kraft).
 * They are greyscale and never shown as photographs: their darkness becomes the
 * sheet's own ink through a mask, so they recolour like everything else. How
 * they were made, and the numbers below, are in `docs/images.md`.
 */

const f = (n: number) => Math.round(n * 100) / 100
const paper = (w: number, h: number, p: PosterPalette) => `<rect width="${w}" height="${h}" fill="${p.paper}"/>`

/** a seeded stream, so a ground draws the same every time it is drawn */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/*
 * Numerals for the rulers, as single strokes on a 4 × 6 box.
 *
 * The sheet carries no text: it reaches the GPU as an SVG inside a data URI,
 * where web fonts do not load, and every letter on it is an outline from the
 * engine. These are drawn the way a plotter or a cutting mat prints them.
 */
const DIGITS: Record<string, string> = {
  '0': 'M1 0H3L4 1V5L3 6H1L0 5V1Z',
  '1': 'M1 1L2 0V6M1 6H3',
  '2': 'M0 1L1 0H3L4 1V2L0 6H4',
  '3': 'M0 0H4L2 2.5H3L4 3.5V5L3 6H1L0 5',
  '4': 'M3 6V0L0 4H4',
  '5': 'M4 0H0V2.5H3L4 3.5V5L3 6H0',
  '6': 'M3.5 0H1L0 1V5L1 6H3L4 5V3.5L3 2.5H0',
  '7': 'M0 0H4L1.5 6',
  '8': 'M1 0H3L4 1V2L3 3H1L0 4V5L1 6H3L4 5V4L3 3H1L0 2V1Z',
  '9': 'M0.5 6H3L4 5V1L3 0H1L0 1V2.5L1 3.5H4',
  '°': 'M0.6 0H1.4L2 0.6V1.4L1.4 2H0.6L0 1.4V0.6Z',
}
const ADVANCE = 5.5

/** a number set in the stroked numerals, `size` tall, anchored at its baseline */
export function strokeNumber(
  text: string,
  x: number,
  baseline: number,
  size: number,
  anchor: 'start' | 'middle' | 'end' = 'start',
): string {
  const s = size / 6
  const width = (text.length * ADVANCE - 1.5) * s
  const x0 = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const d = DIGITS[text[i]]
    if (d) out += `<path transform="translate(${f(x0 + i * ADVANCE * s)} ${f(baseline - size)}) scale(${f(s)})" d="${d}"/>`
  }
  return out
}

/** a group of stroked numerals; the stroke is divided by the scale so it stays `sw` wide */
const numerals = (inner: string, ink: string, opacity: number, sw: number, size: number) =>
  `<g fill="none" stroke="${ink}" stroke-opacity="${opacity}" stroke-width="${f(sw / (size / 6))}" stroke-linecap="round" stroke-linejoin="round">${inner}</g>`

/*
 * Grain: shapes blurred, noise added to their alpha, then cut at a half, so a
 * soft edge breaks up into dots of solid ink like a risograph gradient. The
 * sheet stays two colours, with nothing in between.
 *
 * The noise frequency is never a round 0.5. A sheet drawn at half size samples
 * the noise on its own lattice, where it is flat, and the grain disappears.
 */
function grainFilter(id: string, w: number, h: number, ink: string, blur: number, grain: number, freq: number, stretch: string) {
  return (
    `<filter id="${id}" filterUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}">` +
    (blur > 0 ? `<feGaussianBlur in="SourceGraphic" stdDeviation="${f(blur)}" result="b"/>` : `<feOffset in="SourceGraphic" result="b"/>`) +
    `<feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="2" seed="3" result="n"/>` +
    `<feColorMatrix in="n" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ${stretch}" result="na"/>` +
    `<feComposite in="b" in2="na" operator="arithmetic" k1="0" k2="1" k3="${grain}" k4="${f(-grain / 2)}" result="m"/>` +
    `<feComponentTransfer in="m" result="t"><feFuncA type="discrete" tableValues="0 1"/></feComponentTransfer>` +
    `<feFlood flood-color="${ink}"/><feComposite in2="t" operator="in"/></filter>`
  )
}

const mat: Ground = {
  id: 'mat',
  name: 'Mat',
  draw: (w, h, p) => {
    // a designer's cutting mat: inch squares, half lines, rulers on every edge
    const m = Math.round(Math.min(w, h) * 0.065)
    const u = 104
    const cols = Math.max(1, Math.floor((w - 2 * m) / u))
    const rows = Math.max(1, Math.floor((h - 2 * m) / u))
    const x0 = (w - cols * u) / 2
    const y0 = (h - rows * u) / 2
    let minor = ''
    let major = ''
    let ticks = ''
    let nums = ''
    for (let i = 0; i <= cols * 2; i++) {
      const d = `M${f(x0 + (i * u) / 2)} ${f(y0)}V${f(y0 + rows * u)}`
      if (i % 2) minor += d
      else major += d
    }
    for (let j = 0; j <= rows * 2; j++) {
      const d = `M${f(x0)} ${f(y0 + (j * u) / 2)}H${f(x0 + cols * u)}`
      if (j % 2) minor += d
      else major += d
    }
    const tick = (k: number) => (k % 8 === 0 ? 26 : k % 4 === 0 ? 18 : 10)
    for (let i = 0; i <= cols * 8; i++) {
      const x = f(x0 + (i * u) / 8)
      ticks += `M${x} 0v${tick(i)}M${x} ${h}v-${tick(i)}`
    }
    for (let j = 0; j <= rows * 8; j++) {
      const y = f(y0 + (j * u) / 8)
      ticks += `M0 ${y}h${tick(j)}M${w} ${y}h-${tick(j)}`
    }
    const size = 18
    for (let i = 1; i <= cols; i++) nums += strokeNumber(String(i), x0 + i * u, y0 - 12, size, 'middle')
    for (let j = 1; j <= rows; j++) {
      nums += strokeNumber(String(j), x0 - 14, y0 + j * u + size / 2, size, 'end')
      nums += strokeNumber(String(rows + 1 - j), x0 + cols * u + 14, y0 + j * u + size / 2, size)
    }
    return (
      paper(w, h, p) +
      `<g fill="none" stroke="${p.ink}">` +
      `<path d="${minor}" stroke-opacity="0.18" stroke-width="1.2"/>` +
      `<path d="${major}" stroke-opacity="0.4" stroke-width="1.8"/>` +
      `<path d="${ticks}" stroke-opacity="0.55" stroke-width="1.5"/></g>` +
      numerals(nums, p.ink, 0.6, 1.6, size)
    )
  },
}

const drafting: Ground = {
  id: 'drafting',
  name: 'Drafting',
  draw: (w, h, p) => {
    // the sheet a letter is constructed on: grid, numbered axes, angles, an arc
    const m = Math.round(Math.min(w, h) * 0.083)
    const s = 45
    const cols = Math.max(1, Math.floor((w - 2 * m) / s))
    const rows = Math.max(1, Math.floor((h - 2 * m) / s))
    const x0 = m
    const y1 = m + rows * s
    const x1 = m + cols * s
    let minor = ''
    let major = ''
    let rays = ''
    let nums = ''
    for (let i = 0; i <= cols; i++) {
      const d = `M${x0 + i * s} ${m}V${y1}`
      if (i % 5) minor += d
      else major += d
    }
    for (let j = 0; j <= rows; j++) {
      const d = `M${x0} ${y1 - j * s}H${x1}`
      if (j % 5) minor += d
      else major += d
    }
    const size = 16
    for (let i = 0; i <= cols; i += 5) nums += strokeNumber(String(i), x0 + i * s, y1 + 34, size, 'middle')
    for (let j = 0; j <= rows; j += 5) nums += strokeNumber(String(j), x0 - 14, y1 - j * s + size / 2, size, 'end')
    const L = Math.hypot(w, h)
    for (const a of [15, 30, 45, 60]) {
      const r = (a * Math.PI) / 180
      rays += `M${x0} ${y1}L${f(x0 + L * Math.cos(r))} ${f(y1 - L * Math.sin(r))}`
      nums += strokeNumber(`${a}°`, x0 + 250 * Math.cos(r) + 10, y1 - 250 * Math.sin(r) + size / 2, size)
    }
    const R = Math.min(cols * s, rows * s)
    return (
      paper(w, h, p) +
      `<g fill="none" stroke="${p.ink}">` +
      `<path d="${minor}" stroke-opacity="0.16" stroke-width="1"/>` +
      `<path d="${major}" stroke-opacity="0.42" stroke-width="1.6"/>` +
      `<path d="${rays}" stroke-opacity="0.45" stroke-width="1.4" stroke-dasharray="6 7"/>` +
      `<path d="M${x0 + R} ${y1}A${R} ${R} 0 0 0 ${x0} ${y1 - R}" stroke-opacity="0.5" stroke-width="1.6"/></g>` +
      numerals(nums, p.ink, 0.6, 1.5, size)
    )
  },
}

const press: Ground = {
  id: 'press',
  name: 'Press',
  draw: (w, h, p) => {
    // an uncut printer's sheet: crop marks, registration targets, a tone bar
    const m = Math.round(Math.min(w, h) * 0.067)
    let s = ''
    for (const [x, y, sx, sy] of [
      [m, m, -1, -1],
      [w - m, m, 1, -1],
      [m, h - m, -1, 1],
      [w - m, h - m, 1, 1],
    ])
      s += `M${x + sx * 18} ${y}H${x + sx * 58}M${x} ${y + sy * 18}V${y + sy * 58}`
    const target = (x: number, y: number) =>
      `<circle cx="${f(x)}" cy="${f(y)}" r="12"/><path d="M${f(x - 20)} ${f(y)}H${f(x + 20)}M${f(x)} ${f(y - 20)}V${f(y + 20)}"/>`
    const n = 11
    const bw = 40
    const bx = w / 2 - (n * bw) / 2
    const by = h - m + 22
    let bar = ''
    for (let i = 0; i < n; i++)
      bar += `<rect x="${f(bx + i * bw)}" y="${by}" width="${bw}" height="18" fill="${p.ink}" fill-opacity="${f(i / (n - 1))}"/>`
    bar += `<rect x="${f(bx + n * bw + 10)}" y="${by}" width="${bw}" height="18" fill="${p.mark}"/>`
    return (
      paper(w, h, p) +
      `<g fill="none" stroke="${p.ink}" stroke-opacity="0.85" stroke-width="1.5"><path d="${s}"/>` +
      target(w / 2, m - 38) +
      target(m - 38, h / 2) +
      target(w - m + 38, h / 2) +
      `</g>` +
      bar +
      `<rect x="${f(bx)}" y="${by}" width="${n * bw}" height="18" fill="none" stroke="${p.ink}" stroke-opacity="0.5"/>`
    )
  },
}

const truchet: Ground = {
  id: 'truchet',
  name: 'Truchet',
  draw: (w, h, p) => {
    // quarter circles turned at random, which join into meandering loops
    const c = 45
    const r = c / 2
    const rnd = mulberry32(1337)
    let d = ''
    for (let y = 0; y < h; y += c)
      for (let x = 0; x < w; x += c)
        d +=
          rnd() < 0.5
            ? `M${x + r} ${y}A${r} ${r} 0 0 1 ${x} ${y + r}M${x + c} ${y + r}A${r} ${r} 0 0 0 ${x + r} ${y + c}`
            : `M${x + r} ${y}A${r} ${r} 0 0 0 ${x + c} ${y + r}M${x} ${y + r}A${r} ${r} 0 0 1 ${x + r} ${y + c}`
    return paper(w, h, p) + `<path d="${d}" fill="none" stroke="${p.ink}" stroke-opacity="0.13" stroke-width="4"/>`
  },
}

const grain: Ground = {
  id: 'grain',
  name: 'Grain',
  draw: (w, h, p) => {
    // soft clouds of ink that break into grain at their edges
    const k = w / 1080
    return (
      `<defs>${grainFilter('ffs-grain', w, h, p.ink, 110 * k, 0.9, 0.53, '4 0 0 0 -1.5')}</defs>` +
      paper(w, h, p) +
      `<g filter="url(#ffs-grain)"><g fill="#000">` +
      `<ellipse cx="${f(w * 0.85)}" cy="${f(h * 0.18)}" rx="${f(380 * k)}" ry="${f(320 * k)}" opacity="0.75"/>` +
      `<ellipse cx="${f(w * 0.15)}" cy="${f(h * 0.95)}" rx="${f(640 * k)}" ry="${f(440 * k)}" opacity="0.8"/>` +
      `<ellipse cx="${f(w * 0.6)}" cy="${f(h * 0.75)}" rx="${f(280 * k)}" ry="${f(240 * k)}" opacity="0.6"/>` +
      `</g></g>`
    )
  },
}

const bands: Ground = {
  id: 'bands',
  name: 'Bands',
  draw: (w, h, p) => {
    // vertical bands with a light sweep running through them on a diagonal
    const n = 12
    const bw = w / n
    let defs = ''
    let rects = ''
    for (let i = 0; i < n; i++) {
      const c = 0.15 + (i / (n - 1)) * 0.7
      defs +=
        `<linearGradient id="ffs-band-${i}" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0" stop-opacity="0.6"/><stop offset="${f(Math.max(0, c - 0.28))}" stop-opacity="0.5"/>` +
        `<stop offset="${f(c)}" stop-opacity="0"/><stop offset="${f(Math.min(1, c + 0.3))}" stop-opacity="0.5"/>` +
        `<stop offset="1" stop-opacity="0.6"/></linearGradient>`
      rects += `<rect x="${f(i * bw)}" y="0" width="${f(bw + 1)}" height="${h}" fill="url(#ffs-band-${i})"/>`
    }
    return (
      `<defs>${defs}${grainFilter('ffs-bands', w, h, p.ink, 0, 0.7, 0.55, '4 0 0 0 -1.5')}</defs>` +
      paper(w, h, p) +
      `<g filter="url(#ffs-bands)">${rects}</g>`
    )
  },
}

/*
 * The scans.
 *
 * `cover = gain × ((1 − luminance) − floor)`: the floor takes away the scan's
 * own grey so only its texture prints, and the gain sets how heavy that is.
 * The full file is fetched only when the ground is chosen, and it travels in
 * the sheet as a data URI, because the sheet is decoded as an image and an
 * image cannot fetch anything of its own. Until then a ground draws its small
 * thumbnail by address, which works in the picker (it is in the page) and
 * draws plain paper on the sheet for the moment it takes to arrive.
 */
export interface Scan {
  file: string
  gain: number
  floor: number
  /** a ruled grid over the scan, in sheet units, for squared paper */
  grid?: number
}

export const SCANS: Record<string, Scan> = {
  brayer: { file: 'brayer', gain: 1.1, floor: 0.02 },
  linen: { file: 'linen', gain: 2.4, floor: 0.48 },
  crumpled: { file: 'crumpled', gain: 1.3, floor: 0.03, grid: 30 },
  kraft: { file: 'kraft', gain: 3, floor: 0.56 },
}

const loaded = new Map<string, string>()
const loading = new Map<string, Promise<void>>()

export const scanFile = (id: string) => `/grounds/${SCANS[id].file}.jpg`
export const scanThumb = (id: string) => `/grounds/${SCANS[id].file}-thumb.jpg`
export const isScan = (id: string) => id in SCANS
export const scanReady = (id: string) => !isScan(id) || loaded.has(id)

/** fetch a scan once and keep it as a data URI; resolves when the sheet can use it */
export function loadScan(id: string): Promise<void> {
  if (!isScan(id) || loaded.has(id)) return Promise.resolve()
  let job = loading.get(id)
  if (!job) {
    job = fetch(scanFile(id))
      .then((r) => {
        if (!r.ok) throw new Error(`could not fetch the ${id} ground`)
        return r.blob()
      })
      .then(
        (blob) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as string)
            reader.onerror = () => reject(reader.error)
            reader.readAsDataURL(blob)
          }),
      )
      .then((uri) => {
        loaded.set(id, uri)
      })
      .finally(() => loading.delete(id))
    loading.set(id, job)
  }
  return job
}

function scanGround(id: string, name: string): Ground {
  const s = SCANS[id]
  return {
    id,
    name,
    draw: (w, h, p) => {
      const href = loaded.get(id) ?? scanThumb(id)
      const fid = `ffs-scan-${id}`
      const grid = s.grid
        ? `<defs><pattern id="${fid}-grid" width="${s.grid}" height="${s.grid}" patternUnits="userSpaceOnUse">` +
          `<path d="M${s.grid} 0H0V${s.grid}" fill="none" stroke="${p.ink}" stroke-opacity="0.38" stroke-width="1.1"/></pattern></defs>` +
          `<rect width="${w}" height="${h}" fill="url(#${fid}-grid)"/>`
        : ''
      return (
        `<defs><filter id="${fid}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">` +
        `<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -0.2126 -0.7152 -0.0722 0 1" result="a"/>` +
        `<feComponentTransfer in="a" result="band"><feFuncA type="linear" slope="${s.gain}" intercept="${f(-s.gain * s.floor)}"/></feComponentTransfer>` +
        `<feFlood flood-color="${p.ink}"/><feComposite in2="band" operator="in"/></filter></defs>` +
        paper(w, h, p) +
        `<image href="${href}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" filter="url(#${fid})"/>` +
        grid
      )
    },
  }
}

/** in the order the picker shows them, after Flat, Screen, Grid and Tooth */
export const MORE_GROUNDS: Ground[] = [
  mat,
  drafting,
  press,
  truchet,
  grain,
  bands,
  scanGround('brayer', 'Ink roll'),
  scanGround('linen', 'Linen'),
  scanGround('crumpled', 'Crumpled'),
  scanGround('kraft', 'Kraft'),
]
