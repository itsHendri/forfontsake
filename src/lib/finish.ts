import { SHEET_W, SHEET_H } from './poster'


/**
 * Finishes: pixels, not geometry.
 *
 * Everything else in this project is outlines — it is a type foundry, and the
 * thing it hands you is a font. A finish is the one place that is not true: it
 * is a pass over the *rendered sheet*, the way ink and paper and a scanner are
 * passes over a printed page. So it carries a rule, and a test holds it: **a
 * finish never changes what the font is.** The `.ttf` is byte-identical with
 * any finish on or off, and the SVG download stays letterforms only.
 *
 * The sheet arrives as two images rather than one — see `buildPosterLayers`.
 * The word is its own layer so dragging it is a uniform rather than a rebuild,
 * and a rebuild re-runs the whole treatment chain.
 */

export interface FinishSpec {
  key: string
  label: string
  min: number
  max: number
  step: number
  default: number
  note?: string
}

export interface Finish {
  id: string
  name: string
  /** one line, shown under the picker */
  blurb: string
  params: FinishSpec[]
}

/**
 * The finishes, in the order they are applied — and that order is a fact about
 * what they do, not a preference.
 *
 * Scanner and riso both *resample* the sheet: they read it at a displaced
 * point, so they have to run while there is still a sheet to read. Grain is
 * speckle added to whatever came out, so it goes last however many are on. A
 * user-orderable stack would be offering a choice where there is only one
 * right answer.
 *
 * There is no `none` any more. It was a fourth radio button standing for "not
 * the other three", which only made sense while they excluded each other.
 */
export const FINISHES: Finish[] = [
  {
    id: 'scanline',
    name: 'Scanner',
    blurb: 'Bands of the sheet slipping sideways, as a scanner loses sync.',
    params: [
      { key: 'spacing', label: 'Band height', min: 2, max: 80, step: 1, default: 22, note: 'thickness of a band' },
      { key: 'slip', label: 'Slip', min: 0, max: 60, step: 1, default: 14, note: 'how far a band slides' },
      { key: 'darken', label: 'Bloom', min: 0, max: 100, step: 1, default: 26, note: 'the glow a scanner adds' },
    ],
  },
  {
    id: 'riso',
    name: 'Riso',
    blurb: 'Two plates, slightly out of register.',
    params: [
      { key: 'spread', label: 'Spread', min: 0, max: 40, step: 1, default: 9, note: 'how far the plates missed' },
      { key: 'angle', label: 'Angle', min: 0, max: 360, step: 1, default: 25, note: 'which way they missed' },
      { key: 'ink', label: 'Second ink', min: 0, max: 100, step: 1, default: 62, note: 'how loud the off plate is' },
    ],
  },
  {
    id: 'grain',
    name: 'Grain',
    blurb: 'Paper tooth — the sheet lit from the side.',
    params: [
      { key: 'amount', label: 'Amount', min: 0, max: 100, step: 1, default: 34, note: 'how much tooth' },
      { key: 'size', label: 'Grain size', min: 1, max: 8, step: 0.5, default: 1.5, note: 'coarse paper or fine' },
    ],
  },
]

export const getFinish = (id: string): Finish => FINISHES.find((f) => f.id === id) ?? FINISHES[0]

/** what a finish is switched on with, per finish id */
export type FinishState = Record<string, { on: boolean; params: Record<string, number> }>

/** every finish off, at its own defaults — what the room opens on */
export function finishState(): FinishState {
  const out: FinishState = {}
  for (const f of FINISHES) out[f.id] = { on: false, params: finishDefaults(f) }
  return out
}

export function finishDefaults(f: Finish): Record<string, number> {
  const out: Record<string, number> = {}
  for (const p of f.params) out[p.key] = p.default
  return out
}

const VERT = `#version 300 es
in vec2 pos;
out vec2 uv;
void main() {
  uv = vec2(pos.x, 1.0 - pos.y);
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}`

/**
 * One shader for every finish, branched on a uniform.
 *
 * Branching costs nothing here: a full-screen pass over 1080×1350 is a rounding
 * error next to the geometry rebuild that produced the sheet, and one program
 * means one compile and no swapping.
 */
const FRAG = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 frag;

uniform sampler2D uGround;
uniform sampler2D uWord;
uniform sampler2D uPrevGround;
uniform sampler2D uPrevWord;
uniform vec2 uOffset;      // the word's drag, in uv
uniform vec2 uPrevOffset;
uniform float uFade;       // 1 at the moment of a rebuild, falling to 0
// One flag and one set of dials per finish, so any combination can be on at
// once. Ordered by what they do rather than by preference: the two that
// resample the sheet run while there is still a sheet to read, and the one
// that adds speckle runs over whatever came out.
uniform vec3 uOn;          // scanner · riso · grain, 0 or 1
uniform vec3 uScan;        // band height · slip · bloom
uniform vec3 uRiso;        // spread · angle (radians) · second ink
uniform vec3 uGrain;       // amount · size · unused
uniform vec2 uPx;          // one pixel, in uv

/** the word layer, transparent everywhere it is not the word */
vec4 wordAt(sampler2D t, vec2 p) {
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return vec4(0.0);
  return texture(t, p);
}

/** the sheet as drawn: the word laid over the ground */
vec3 sheet(sampler2D g, sampler2D w, vec2 off, vec2 p) {
  vec3 base = texture(g, p).rgb;
  vec4 word = wordAt(w, p - off);
  return mix(base, word.rgb, word.a);
}

/** the sheet including the cross-fade that turns a rebuild into a morph */
vec3 sheetFaded(vec2 p) {
  vec3 now = sheet(uGround, uWord, uOffset, p);
  if (uFade <= 0.0) return now;
  vec3 was = sheet(uPrevGround, uPrevWord, uPrevOffset, p);
  return mix(now, was, uFade);
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  // Scanner moves where the sheet is read from, so it applies to the sample
  // point before anything reads it — which is also what lets riso stack on
  // top and misregister the already-slipped sheet rather than a clean one.
  vec2 p = uv;
  if (uOn.x > 0.5) {
    float band = floor(uv.y / max(uPx.y * uScan.x * 400.0, uPx.y));
    p.x += (hash(vec2(band, 3.7)) - 0.5) * uScan.y * uPx.x * 120.0;
  }

  vec3 c = sheetFaded(p);

  if (uOn.x > 0.5) {
    // Bloom is light leaking *into* the ink, which is what an over-exposed
    // scan does. Keyed off brightness it caught the paper instead and washed
    // the whole sheet, because paper is the brightest thing on it.
    float dark = 1.0 - dot(c, vec3(0.299, 0.587, 0.114));
    c += dark * uScan.z * 0.30;
  }

  if (uOn.y > 0.5) {
    // Riso: the same sheet pulled twice, the second plate missing its mark.
    // Multiply, because two inks on one sheet subtract rather than add.
    vec2 off = vec2(cos(uRiso.y), sin(uRiso.y)) * uRiso.x * uPx * 60.0;
    vec3 b = sheetFaded(p + off);
    vec3 second = vec3(1.0) - (vec3(1.0) - b) * vec3(0.15, 0.85, 0.95);
    c = mix(c, c * second, uRiso.z);
  }

  if (uOn.z > 0.5) {
    // Grain: paper tooth, keyed to position alone so a frame is reproducible
    // from its values — the same promise the rest of the tool makes.
    vec2 cell = floor(gl_FragCoord.xy / max(uGrain.y, 1.0));
    c += (hash(cell) - 0.5) * uGrain.x;
  }

  frag = vec4(clamp(c, 0.0, 1.0), 1.0);
}`

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)
  if (!sh) throw new Error('could not create shader')
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh)
    gl.deleteShader(sh)
    throw new Error(`finish shader: ${log}`)
  }
  return sh
}

function makeTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const t = gl.createTexture()
  if (!t) throw new Error('could not create texture')
  gl.bindTexture(gl.TEXTURE_2D, t)
  // CLAMP, because a dragged word must not wrap round the sheet
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]))
  return t
}

/** an SVG string as an image the GPU will take */
function decode(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('could not draw the sheet'))
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })
}

export interface FinishView {
  readonly canvas: HTMLCanvasElement
  /** hand it a new sheet; the previous one stays for the cross-fade */
  setSheet(ground: string, word: string | null): Promise<void>
  /** the word's drag, in sheet units — free, because it is only a uniform */
  setOffset(dx: number, dy: number): void
  /** which finishes are on, and at what — any combination, applied in order */
  setFinishes(state: FinishState): void
  /** 0 to 1, how much of the previous sheet still shows */
  setFade(fade: number): void
  draw(): void
  destroy(): void
}

/**
 * The sheet, on the GPU.
 *
 * Scale is a device-pixel multiplier: the live view runs at 1 and the PNG at 2,
 * so one pipeline serves the screen, the download and the recording rather than
 * three that have to be kept agreeing.
 *
 * The sheet's own size comes in too, because the format is a property of the
 * sheet now: a story is 1080×1920 where a post is 1080×1350, and the drag
 * offset below is expressed as a fraction of whichever one this view holds.
 */
export function createFinishView(scale = 1, sheetW = SHEET_W, sheetH = SHEET_H): FinishView {
  const canvas = document.createElement('canvas')
  canvas.width = sheetW * scale
  canvas.height = sheetH * scale
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false })
  if (!gl) throw new Error('This browser cannot show finishes — it has no WebGL2.')

  const program = gl.createProgram()
  if (!program) throw new Error('could not create program')
  const vs = compile(gl, gl.VERTEX_SHADER, VERT)
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG)
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`finish shader: ${gl.getProgramInfoLog(program)}`)
  }
  gl.useProgram(program)

  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
  const posLoc = gl.getAttribLocation(program, 'pos')
  gl.enableVertexAttribArray(posLoc)
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

  const tex = {
    ground: makeTexture(gl),
    word: makeTexture(gl),
    prevGround: makeTexture(gl),
    prevWord: makeTexture(gl),
  }
  const u = (name: string) => gl.getUniformLocation(program, name)
  const loc = {
    ground: u('uGround'),
    word: u('uWord'),
    prevGround: u('uPrevGround'),
    prevWord: u('uPrevWord'),
    offset: u('uOffset'),
    prevOffset: u('uPrevOffset'),
    fade: u('uFade'),
    on: u('uOn'),
    scan: u('uScan'),
    riso: u('uRiso'),
    grain: u('uGrain'),
    px: u('uPx'),
  }
  gl.uniform1i(loc.ground, 0)
  gl.uniform1i(loc.word, 1)
  gl.uniform1i(loc.prevGround, 2)
  gl.uniform1i(loc.prevWord, 3)
  gl.uniform2f(loc.px, 1 / canvas.width, 1 / canvas.height)

  let offset: [number, number] = [0, 0]
  let prevOffset: [number, number] = [0, 0]
  let fade = 0
  let finishes: FinishState = finishState()
  let dead = false
  // the images currently on the GPU, kept so they can become the previous pair
  // on the next rebuild — the fade over them is what turns a rebuild into a morph
  let liveGround: HTMLImageElement | null = null
  let liveWord: HTMLImageElement | null = null

  const upload = (t: WebGLTexture, img: HTMLImageElement | null) => {
    gl.bindTexture(gl.TEXTURE_2D, t)
    if (img) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
    else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]))
    }
  }

  /** one finish's dials, normalised so the shader never has to know their ranges */
  function packed(f: Finish): [number, number, number] {
    const held = finishes[f.id]
    const at = (i: number) => {
      const spec = f.params[i]
      if (!spec) return 0
      const v = held?.params[spec.key] ?? spec.default
      return spec.key === 'angle' ? (v * Math.PI) / 180 : (v - spec.min) / (spec.max - spec.min || 1)
    }
    return [at(0), at(1), at(2)]
  }

  return {
    canvas,
    async setSheet(ground, word) {
      const [g, w] = await Promise.all([decode(ground), word ? decode(word) : null])
      if (dead) return
      upload(tex.prevGround, liveGround)
      upload(tex.prevWord, liveWord)
      prevOffset = [offset[0], offset[1]]
      upload(tex.ground, g)
      upload(tex.word, w)
      liveGround = g
      liveWord = w
    },
    setOffset(dx, dy) {
      offset = [dx / sheetW, dy / sheetH]
    },
    setFinishes(next) {
      finishes = next
    },
    setFade(f) {
      fade = Math.max(0, Math.min(1, f))
    },
    draw() {
      if (dead) return
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, tex.ground)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, tex.word)
      gl.activeTexture(gl.TEXTURE2)
      gl.bindTexture(gl.TEXTURE_2D, tex.prevGround)
      gl.activeTexture(gl.TEXTURE3)
      gl.bindTexture(gl.TEXTURE_2D, tex.prevWord)
      gl.uniform2f(loc.offset, offset[0], offset[1])
      gl.uniform2f(loc.prevOffset, prevOffset[0], prevOffset[1])
      gl.uniform1f(loc.fade, fade)
      // the uniforms are positional, so the order here is FINISHES' order,
      // which is the order the shader applies them in
      const [scan, riso, grain] = FINISHES
      gl.uniform3f(
        loc.on,
        finishes[scan.id]?.on ? 1 : 0,
        finishes[riso.id]?.on ? 1 : 0,
        finishes[grain.id]?.on ? 1 : 0,
      )
      gl.uniform3f(loc.scan, ...packed(scan))
      gl.uniform3f(loc.riso, ...packed(riso))
      gl.uniform3f(loc.grain, ...packed(grain))
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    },
    destroy() {
      dead = true
      liveGround = null
      liveWord = null
      gl.deleteProgram(program)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      gl.deleteBuffer(buf)
      for (const t of Object.values(tex)) gl.deleteTexture(t)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}
