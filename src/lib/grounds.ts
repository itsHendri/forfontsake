import type { Ground, PosterPalette } from './poster'

/**
 * The grounds beyond the first four: measured surfaces, grain, a maze, and nine
 * material scans.
 *
 * The drawn ones follow the rule the first four set: a few SVG tags, coloured
 * from the palette, nothing to download. The scans are the one exception, for
 * materials code cannot fake (an ink roller, bookcloth, papers, toner, concrete).
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
 * Grain: shapes blurred, noise added to their alpha, then cut at a half, so a
 * soft edge breaks up into dots of solid ink like a risograph gradient. The
 * sheet stays two colours, with nothing in between.
 *
 * The noise frequency is never a round 0.5. A sheet drawn at half size samples
 * the noise on its own lattice, where it is flat, and the grain disappears.
 */
function grainFilter(id: string, w: number, h: number, ink: string, blur: number, grain: number, freq: number, stretch: string, tint = 1) {
  return (
    `<filter id="${id}" filterUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}">` +
    (blur > 0 ? `<feGaussianBlur in="SourceGraphic" stdDeviation="${f(blur)}" result="b"/>` : `<feOffset in="SourceGraphic" result="b"/>`) +
    `<feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="2" seed="3" result="n"/>` +
    `<feColorMatrix in="n" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ${stretch}" result="na"/>` +
    `<feComposite in="b" in2="na" operator="arithmetic" k1="0" k2="1" k3="${grain}" k4="${f(-grain / 2)}" result="m"/>` +
    `<feComponentTransfer in="m" result="t"><feFuncA type="discrete" tableValues="0 1"/></feComponentTransfer>` +
    `<feFlood flood-color="${ink}" flood-opacity="${tint}"/><feComposite in2="t" operator="in"/></filter>`
  )
}

const mat: Ground = {
  id: 'mat',
  name: 'Mat',
  draw: (w, h, p) => {
    // a designer's cutting mat: inch squares, half lines, ruler ticks on every edge
    const m = Math.round(Math.min(w, h) * 0.035)
    const u = 104
    const cols = Math.max(1, Math.floor((w - 2 * m) / u))
    const rows = Math.max(1, Math.floor((h - 2 * m) / u))
    const x0 = (w - cols * u) / 2
    const y0 = (h - rows * u) / 2
    let minor = ''
    let major = ''
    let ticks = ''
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
    // the ticks sit in the gap between the grid and the edge, so they never cross it
    const gap = Math.min(x0, y0)
    const tick = (k: number) => f(gap * (k % 8 === 0 ? 0.7 : k % 4 === 0 ? 0.5 : 0.3))
    for (let i = 0; i <= cols * 8; i++) {
      const x = f(x0 + (i * u) / 8)
      ticks += `M${x} 0v${tick(i)}M${x} ${h}v-${tick(i)}`
    }
    for (let j = 0; j <= rows * 8; j++) {
      const y = f(y0 + (j * u) / 8)
      ticks += `M0 ${y}h${tick(j)}M${w} ${y}h-${tick(j)}`
    }
    return (
      paper(w, h, p) +
      `<g fill="none" stroke="${p.ink}">` +
      `<path d="${minor}" stroke-opacity="0.18" stroke-width="1.2"/>` +
      `<path d="${major}" stroke-opacity="0.4" stroke-width="1.8"/>` +
      `<path d="${ticks}" stroke-opacity="0.55" stroke-width="1.5"/></g>`
    )
  },
}

const drafting: Ground = {
  id: 'drafting',
  name: 'Drafting',
  draw: (w, h, p) => {
    // the sheet a letter is constructed on: grid, angles from the corner, an arc
    const s = 45
    const cols = Math.max(1, Math.floor((w - 2 * Math.min(w, h) * 0.035) / s))
    const rows = Math.max(1, Math.floor((h - 2 * Math.min(w, h) * 0.035) / s))
    const x0 = Math.round((w - cols * s) / 2)
    const y0 = Math.round((h - rows * s) / 2)
    const y1 = y0 + rows * s
    const x1 = x0 + cols * s
    let minor = ''
    let major = ''
    let rays = ''
    for (let i = 0; i <= cols; i++) {
      const d = `M${x0 + i * s} ${y0}V${y1}`
      if (i % 5) minor += d
      else major += d
    }
    for (let j = 0; j <= rows; j++) {
      const d = `M${x0} ${y1 - j * s}H${x1}`
      if (j % 5) minor += d
      else major += d
    }
    const L = Math.hypot(w, h)
    for (const a of [15, 30, 45, 60]) {
      const r = (a * Math.PI) / 180
      rays += `M${x0} ${y1}L${f(x0 + L * Math.cos(r))} ${f(y1 - L * Math.sin(r))}`
    }
    const R = Math.min(cols * s, rows * s)
    return (
      `<defs><clipPath id="ffs-drafting"><rect x="${x0}" y="${y0}" width="${cols * s}" height="${rows * s}"/></clipPath></defs>` +
      paper(w, h, p) +
      `<g fill="none" stroke="${p.ink}">` +
      `<path d="${minor}" stroke-opacity="0.16" stroke-width="1"/>` +
      `<path d="${major}" stroke-opacity="0.42" stroke-width="1.6"/>` +
      `<path d="${rays}" clip-path="url(#ffs-drafting)" stroke-opacity="0.45" stroke-width="1.4" stroke-dasharray="6 7"/>` +
      `<path d="M${x0 + R} ${y1}A${R} ${R} 0 0 0 ${x0} ${y1 - R}" stroke-opacity="0.5" stroke-width="1.6"/></g>`
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
      `<defs>${grainFilter('ffs-grain', w, h, p.ink, 150 * k, 1, 0.53, '2 0 0 0 -0.65', 0.4)}</defs>` +
      paper(w, h, p) +
      `<g filter="url(#ffs-grain)"><g fill="#000">` +
      `<ellipse cx="${f(w * 0.85)}" cy="${f(h * 0.18)}" rx="${f(380 * k)}" ry="${f(320 * k)}" opacity="0.4"/>` +
      `<ellipse cx="${f(w * 0.15)}" cy="${f(h * 0.95)}" rx="${f(640 * k)}" ry="${f(440 * k)}" opacity="0.45"/>` +
      `<ellipse cx="${f(w * 0.6)}" cy="${f(h * 0.75)}" rx="${f(280 * k)}" ry="${f(240 * k)}" opacity="0.3"/>` +
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
        `<stop offset="0" stop-opacity="0.32"/><stop offset="${f(Math.max(0, c - 0.28))}" stop-opacity="0.26"/>` +
        `<stop offset="${f(c)}" stop-opacity="0"/><stop offset="${f(Math.min(1, c + 0.3))}" stop-opacity="0.26"/>` +
        `<stop offset="1" stop-opacity="0.32"/></linearGradient>`
      rects += `<rect x="${f(i * bw)}" y="0" width="${f(bw + 1)}" height="${h}" fill="url(#ffs-band-${i})"/>`
    }
    return (
      `<defs>${defs}${grainFilter('ffs-bands', w, h, p.ink, 0, 1, 0.55, '2 0 0 0 -0.65', 0.4)}</defs>` +
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
  /**
   * The width of one repeat, in sheet units, for a scan made seamless so it
   * can be drawn smaller than the sheet and repeated. Absent, the scan covers
   * the sheet once.
   */
  tile?: number
}

export const SCANS: Record<string, Scan> = {
  brayer: { file: 'brayer', gain: 1.1, floor: 0.02 },
  linen: { file: 'linen', gain: 0.65, floor: 0.3 },
  crumpled: { file: 'crumpled', gain: 1.3, floor: 0.03, grid: 30 },
  kraft: { file: 'kraft', gain: 3, floor: 0.56 },
  newsprint: { file: 'newsprint', gain: 3.6, floor: 0.11 },
  photocopy: { file: 'photocopy', gain: 2.5, floor: 0.03 },
  concrete: { file: 'concrete', gain: 1.6, floor: 0.22, tile: 360 },
  washi: { file: 'washi', gain: 1.08, floor: 0.15, tile: 360 },
  watercolour: { file: 'watercolour', gain: 1.6, floor: 0.14, tile: 360 },
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
        (s.tile
          ? `<defs><pattern id="${fid}-tile" width="${s.tile}" height="${f((s.tile * 4) / 3)}" patternUnits="userSpaceOnUse">` +
            `<image href="${href}" width="${s.tile}" height="${f((s.tile * 4) / 3)}" preserveAspectRatio="none"/></pattern></defs>` +
            `<rect width="${w}" height="${h}" fill="url(#${fid}-tile)" filter="url(#${fid})"/>`
          : `<image href="${href}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" filter="url(#${fid})"/>`) +
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
  scanGround('newsprint', 'Newsprint'),
  scanGround('photocopy', 'Photocopy'),
  scanGround('concrete', 'Concrete'),
  scanGround('washi', 'Washi'),
  scanGround('watercolour', 'Watercolour'),
]
