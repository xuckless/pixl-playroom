/**
 * The brush, off the main thread and on the GPU. The loupe hands this worker
 * its stroke canvas (an OffscreenCanvas) and then only dab positions; here
 * each dab is a quad drawn into a half-float stroke texture, where blending
 * computes the build-up `s + a·(1 − s)` of `shared/brush.ts` exactly, and
 * Auto Mask weighs each pixel by its colour distance (Lab ΔE) from the
 * colour under the brush, read from the picture on the GPU. At the end the
 * stroke joins the plane in one pass, is read back, and leaves as a grey PNG
 * encoded here. Where WebGL2 cannot render to float textures, the same
 * worker paints on the CPU with `shared/brush.ts`.
 */
import { autoMaskWeight, composeStroke, deltaE, srgbToLab, stampDab } from '../../../shared/brush'
import { encodeGreyPng } from '../lib/png'

/** An affine map of normalised points: x' = a·x + b·y + c, y' = d·x + e·y + f. */
export type Affine = [number, number, number, number, number, number]

export interface Dab {
  /** Centre and radius in plane pixels. */
  x: number
  y: number
  r: number
  flow: number
  /** The centre in display coordinates (Auto Mask's reference colour). */
  dx: number
  dy: number
  /** The centre and radius on the stroke canvas, CSS pixels (CPU preview). */
  sx: number
  sy: number
  sr: number
}

export interface Screen {
  /** The canvas's size, CSS pixels, and the device pixel ratio. */
  w: number
  h: number
  dpr: number
  /** Canvas pixel → display coordinates: display = (offset + canvas) / size. */
  ox: number
  oy: number
  rw: number
  rh: number
  /** Display → base (normalised). */
  toBase: Affine
}

export type BrushIn =
  | { t: 'init'; canvas: OffscreenCanvas }
  | { t: 'screen'; screen: Screen }
  | {
      t: 'begin'
      w: number
      h: number
      png: string | null
      softness: number
      erase: boolean
      /** The picture, for Auto Mask; null without it. */
      picture: string | null
      /** Base (normalised) → display. */
      toDisplay: Affine
    }
  | { t: 'dabs'; dabs: Dab[] }
  | { t: 'end'; id: number; density: number }
  | { t: 'cancel' }

export type BrushOut = { t: 'done'; id: number; png: string | null; error?: string }

const post = (m: BrushOut): void => (self as unknown as Worker).postMessage(m)

// ── shaders ──────────────────────────────────────────────────────────────────

const QUAD_VS = `#version 300 es
in vec2 aPos;
uniform vec4 uRect; // x0, y0, x1, y1 in target pixels
uniform vec2 uSize; // target size
void main() {
  vec2 p = mix(uRect.xy, uRect.zw, aPos);
  gl_Position = vec4(p / uSize * 2.0 - 1.0, 0.0, 1.0);
}`

const LAB = `
vec3 lin(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
float f(float t) { return t > 0.008856 ? pow(t, 1.0 / 3.0) : 7.787 * t + 16.0 / 116.0; }
vec3 lab(vec3 srgb) {
  vec3 c = lin(srgb);
  float X = (0.4124 * c.r + 0.3576 * c.g + 0.1805 * c.b) / 0.95047;
  float Y = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  float Z = (0.0193 * c.r + 0.1192 * c.g + 0.9505 * c.b) / 1.08883;
  float fx = f(X), fy = f(Y), fz = f(Z);
  return vec3(116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz));
}`

/** One dab: flow × falloff × Auto Mask, blended onto the stroke as s + a(1 − s). */
const DAB_FS = `#version 300 es
precision highp float;
uniform vec2 uCentre;   // plane pixels
uniform float uR;       // plane pixels
uniform float uInner;
uniform float uFlow;
uniform vec2 uPlane;    // plane size
uniform bool uAuto;
uniform sampler2D uPicture;
uniform vec2 uRef;      // display coords of the dab's centre
uniform mat3 uToDisplay;
out vec4 o;
${LAB}
void main() {
  float d = distance(gl_FragCoord.xy, uCentre);
  if (d > uR) discard;
  float t = uR > uInner ? smoothstep(uInner, uR, d) : (d < uInner ? 0.0 : 1.0);
  float a = uFlow * (1.0 - t);
  if (uAuto) {
    vec2 disp = (uToDisplay * vec3(gl_FragCoord.xy / uPlane, 1.0)).xy;
    float dE = distance(lab(texture(uPicture, uRef).rgb), lab(texture(uPicture, disp).rgb));
    a *= 1.0 - smoothstep(6.0, 18.0, dE);
  }
  o = vec4(a);
}`

/** The stroke (capped at density) united with, or taken from, the plane. */
const COMPOSE_FS = `#version 300 es
precision highp float;
uniform sampler2D uPlaneTex;
uniform sampler2D uStroke;
uniform float uCap;
uniform bool uErase;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float plane = texelFetch(uPlaneTex, p, 0).r;
  float s = min(texelFetch(uStroke, p, 0).r, uCap);
  float v = uErase ? plane * (1.0 - s) : plane + s * (1.0 - plane);
  o = vec4(v, v, v, 1.0);
}`

/** The stroke so far, tinted, on the loupe's canvas. */
const PREVIEW_FS = `#version 300 es
precision highp float;
uniform sampler2D uStroke;
uniform vec2 uCanvas;   // canvas size, device pixels
uniform float uDpr;
uniform vec4 uMap;      // ox, oy, rw, rh
uniform mat3 uToBase;
uniform vec4 uTint;
out vec4 o;
void main() {
  vec2 css = vec2(gl_FragCoord.x, uCanvas.y - gl_FragCoord.y) / uDpr;
  vec2 disp = (uMap.xy + css) / uMap.zw;
  vec2 base = (uToBase * vec3(disp, 1.0)).xy;
  if (base.x < 0.0 || base.y < 0.0 || base.x > 1.0 || base.y > 1.0) discard;
  float s = texture(uStroke, base).r;
  o = uTint * min(1.0, s * 1.6);
}`

// ── state ────────────────────────────────────────────────────────────────────

let canvas: OffscreenCanvas | null = null
let screen: Screen | null = null
let gpu: Gpu | null = null
let cpu: Cpu | null = null
/** Messages are handled one after another; a stroke's start decodes before its dabs land. */
let chain: Promise<void> = Promise.resolve()

interface Stroke {
  w: number
  h: number
  softness: number
  erase: boolean
  toDisplay: Affine
  auto: boolean
}
let stroke: Stroke | null = null

const mat3 = (m: Affine): Float32Array =>
  // column-major: x' = a·x + b·y + c
  new Float32Array([m[0], m[3], 0, m[1], m[4], 0, m[2], m[5], 1])

async function bitmapOf(src: string | Blob, w?: number, h?: number): Promise<ImageBitmap> {
  const blob = typeof src === 'string' ? await (await fetch(src)).blob() : src
  return createImageBitmap(blob, {
    premultiplyAlpha: 'none',
    ...(w && h ? { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' as const } : {})
  })
}

const pngBlob = (b64: string): Blob =>
  new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' })

// ── GPU ──────────────────────────────────────────────────────────────────────

class Gpu {
  private dab: WebGLProgram
  private compose: WebGLProgram
  private preview: WebGLProgram
  private quad: WebGLVertexArrayObject
  private strokeTex: WebGLTexture | null = null
  private strokeFb: WebGLFramebuffer | null = null
  private planeTex: WebGLTexture | null = null
  private pictureTex: WebGLTexture | null = null
  private pictureUrl: string | null = null
  private w = 0
  private h = 0

  static create(c: OffscreenCanvas): Gpu | null {
    const gl = c.getContext('webgl2', { premultipliedAlpha: true, antialias: false })
    if (!gl || !gl.getExtension('EXT_color_buffer_float')) return null
    try {
      return new Gpu(gl)
    } catch {
      return null
    }
  }

  private constructor(private readonly gl: WebGL2RenderingContext) {
    this.dab = this.program(QUAD_VS, DAB_FS)
    this.compose = this.program(QUAD_VS, COMPOSE_FS)
    this.preview = this.program(QUAD_VS, PREVIEW_FS)
    const vao = gl.createVertexArray() as WebGLVertexArrayObject
    gl.bindVertexArray(vao)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
    for (const p of [this.dab, this.compose, this.preview]) {
      const loc = gl.getAttribLocation(p, 'aPos')
      if (loc < 0) continue
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    }
    this.quad = vao
  }

  private program(vs: string, fs: string): WebGLProgram {
    const gl = this.gl
    const p = gl.createProgram() as WebGLProgram
    for (const [type, src] of [
      [gl.VERTEX_SHADER, vs],
      [gl.FRAGMENT_SHADER, fs]
    ] as const) {
      const s = gl.createShader(type) as WebGLShader
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(s) ?? '')
      gl.attachShader(p, s)
    }
    gl.bindAttribLocation(p, 0, 'aPos')
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? '')
    return p
  }

  private texture(): WebGLTexture {
    const gl = this.gl
    const t = gl.createTexture() as WebGLTexture
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return t
  }

  private u(p: WebGLProgram, name: string): WebGLUniformLocation | null {
    return this.gl.getUniformLocation(p, name)
  }

  private draw(
    p: WebGLProgram,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    w: number,
    h: number
  ): void {
    const gl = this.gl
    gl.uniform4f(this.u(p, 'uRect'), x0, y0, x1, y1)
    gl.uniform2f(this.u(p, 'uSize'), w, h)
    gl.bindVertexArray(this.quad)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  async begin(s: Stroke, png: string | null, picture: string | null): Promise<void> {
    const gl = this.gl
    this.w = s.w
    this.h = s.h
    // The stroke: a half-float target, cleared.
    if (this.strokeTex) gl.deleteTexture(this.strokeTex)
    if (this.strokeFb) gl.deleteFramebuffer(this.strokeFb)
    this.strokeTex = this.texture()
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, s.w, s.h, 0, gl.RGBA, gl.HALF_FLOAT, null)
    this.strokeFb = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.strokeFb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.strokeTex, 0)
    gl.viewport(0, 0, s.w, s.h)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    // The plane it joins: the component's PNG, or nothing.
    if (this.planeTex) gl.deleteTexture(this.planeTex)
    this.planeTex = this.texture()
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    if (png) {
      const bmp = await bitmapOf(pngBlob(png), s.w, s.h)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, bmp)
      bmp.close()
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, s.w, s.h, 0, gl.RED, gl.UNSIGNED_BYTE, null)
    }
    // The picture Auto Mask reads, kept while it stays the same.
    if (picture && picture !== this.pictureUrl) {
      const bmp = await bitmapOf(picture)
      if (this.pictureTex) gl.deleteTexture(this.pictureTex)
      this.pictureTex = this.texture()
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bmp)
      bmp.close()
      this.pictureUrl = picture
    }
  }

  dabs(s: Stroke, dabs: Dab[]): void {
    const gl = this.gl
    const p = this.dab
    gl.useProgram(p)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.strokeFb)
    gl.viewport(0, 0, this.w, this.h)
    gl.enable(gl.BLEND)
    // s' = a + s·(1 − a) = s + a·(1 − s)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR)
    gl.uniform2f(this.u(p, 'uPlane'), this.w, this.h)
    gl.uniform1i(this.u(p, 'uAuto'), s.auto && this.pictureTex ? 1 : 0)
    gl.uniformMatrix3fv(this.u(p, 'uToDisplay'), false, mat3(s.toDisplay))
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.pictureTex)
    gl.uniform1i(this.u(p, 'uPicture'), 0)
    for (const d of dabs) {
      if (d.r <= 0 || d.flow <= 0) continue
      gl.uniform2f(this.u(p, 'uCentre'), d.x, d.y)
      gl.uniform1f(this.u(p, 'uR'), d.r)
      gl.uniform1f(this.u(p, 'uInner'), d.r * (1 - Math.min(100, Math.max(0, s.softness)) / 100))
      gl.uniform1f(this.u(p, 'uFlow'), d.flow)
      gl.uniform2f(this.u(p, 'uRef'), d.dx, d.dy)
      this.draw(p, d.x - d.r - 1, d.y - d.r - 1, d.x + d.r + 1, d.y + d.r + 1, this.w, this.h)
    }
    gl.disable(gl.BLEND)
    this.show(s)
  }

  /** The stroke on the loupe's canvas. */
  show(s: Stroke | null): void {
    const gl = this.gl
    const c = canvas
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    if (!c) return
    gl.viewport(0, 0, c.width, c.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (!s || !screen || !this.strokeTex) return
    const p = this.preview
    gl.useProgram(p)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.strokeTex)
    gl.uniform1i(this.u(p, 'uStroke'), 0)
    gl.uniform2f(this.u(p, 'uCanvas'), c.width, c.height)
    gl.uniform1f(this.u(p, 'uDpr'), screen.dpr)
    gl.uniform4f(this.u(p, 'uMap'), screen.ox, screen.oy, screen.rw, screen.rh)
    gl.uniformMatrix3fv(this.u(p, 'uToBase'), false, mat3(screen.toBase))
    // Premultiplied: the accent while painting, a shadow while erasing.
    const t = s.erase ? [0.04, 0.04, 0.055, 0.4] : [0.62, 0.55, 0.92, 0.3]
    gl.uniform4f(this.u(p, 'uTint'), t[0] * t[3], t[1] * t[3], t[2] * t[3], t[3])
    this.draw(p, 0, 0, c.width, c.height, c.width, c.height)
  }

  /** The plane after the stroke, as 8-bit grey rows. */
  finish(s: Stroke, density: number): Uint8Array {
    const gl = this.gl
    const outTex = this.texture()
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, s.w, s.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    const fb = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, outTex, 0)
    gl.viewport(0, 0, s.w, s.h)
    const p = this.compose
    gl.useProgram(p)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.planeTex)
    gl.uniform1i(this.u(p, 'uPlaneTex'), 0)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.strokeTex)
    gl.uniform1i(this.u(p, 'uStroke'), 1)
    gl.uniform1f(this.u(p, 'uCap'), Math.min(1, Math.max(0, density)))
    gl.uniform1i(this.u(p, 'uErase'), s.erase ? 1 : 0)
    this.draw(p, 0, 0, s.w, s.h, s.w, s.h)
    const rgba = new Uint8Array(s.w * s.h * 4)
    gl.readPixels(0, 0, s.w, s.h, gl.RGBA, gl.UNSIGNED_BYTE, rgba)
    gl.deleteFramebuffer(fb)
    gl.deleteTexture(outTex)
    gl.activeTexture(gl.TEXTURE0)
    const grey = new Uint8Array(s.w * s.h)
    for (let i = 0; i < grey.length; i++) grey[i] = rgba[i * 4]
    return grey
  }
}

// ── CPU fallback ─────────────────────────────────────────────────────────────

interface Cpu {
  plane: Float32Array
  stroke: Float32Array
  lab: { w: number; h: number; data: Float32Array } | null
}

async function cpuBegin(s: Stroke, png: string | null, picture: string | null): Promise<Cpu> {
  const plane = new Float32Array(s.w * s.h)
  if (png) {
    const bmp = await bitmapOf(pngBlob(png), s.w, s.h)
    const c = new OffscreenCanvas(s.w, s.h)
    const ctx = c.getContext('2d') as OffscreenCanvasRenderingContext2D
    ctx.drawImage(bmp, 0, 0)
    bmp.close()
    const d = ctx.getImageData(0, 0, s.w, s.h).data
    for (let i = 0; i < plane.length; i++) plane[i] = d[i * 4] / 255
  }
  let lab: Cpu['lab'] = null
  if (picture) {
    const bmp = await bitmapOf(picture)
    const k = Math.min(1, 1024 / Math.max(bmp.width, bmp.height))
    const w = Math.max(1, Math.round(bmp.width * k))
    const h = Math.max(1, Math.round(bmp.height * k))
    const c = new OffscreenCanvas(w, h)
    const ctx = c.getContext('2d') as OffscreenCanvasRenderingContext2D
    ctx.drawImage(bmp, 0, 0, w, h)
    bmp.close()
    const d = ctx.getImageData(0, 0, w, h).data
    const data = new Float32Array(w * h * 3)
    for (let i = 0; i < w * h; i++) data.set(srgbToLab(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]), i * 3)
    lab = { w, h, data }
  }
  return { plane, stroke: new Float32Array(s.w * s.h), lab }
}

function labAt(l: NonNullable<Cpu['lab']>, x: number, y: number): [number, number, number] {
  const px = Math.min(l.w - 1, Math.max(0, Math.floor(x * l.w)))
  const py = Math.min(l.h - 1, Math.max(0, Math.floor(y * l.h)))
  const i = (py * l.w + px) * 3
  return [l.data[i], l.data[i + 1], l.data[i + 2]]
}

function cpuDabs(c: Cpu, s: Stroke, dabs: Dab[]): void {
  const m = s.toDisplay
  const ctx = canvas?.getContext('2d') as OffscreenCanvasRenderingContext2D | null
  for (const d of dabs) {
    let weight: ((x: number, y: number) => number) | undefined
    const lab = c.lab
    if (s.auto && lab) {
      const centre = labAt(lab, d.dx, d.dy)
      weight = (x, y) => {
        const bx = (x + 0.5) / s.w
        const by = (y + 0.5) / s.h
        return autoMaskWeight(
          deltaE(centre, labAt(lab, m[0] * bx + m[1] * by + m[2], m[3] * bx + m[4] * by + m[5]))
        )
      }
    }
    stampDab(c.stroke, s.w, s.h, d.x, d.y, d.r, s.softness, d.flow, weight)
    if (ctx && screen) {
      ctx.setTransform(screen.dpr, 0, 0, screen.dpr, 0, 0)
      ctx.fillStyle = s.erase ? 'rgba(10,10,14,0.22)' : 'rgba(157,139,234,0.16)'
      ctx.beginPath()
      ctx.arc(d.sx, d.sy, d.sr, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

function clearCanvas(): void {
  if (gpu) return gpu.show(null)
  const ctx = canvas?.getContext('2d') as OffscreenCanvasRenderingContext2D | null
  if (ctx && canvas) {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  }
}

// ── messages ─────────────────────────────────────────────────────────────────

async function handle(m: BrushIn): Promise<void> {
  switch (m.t) {
    case 'init':
      canvas = m.canvas
      gpu = Gpu.create(canvas)
      return
    case 'screen':
      screen = m.screen
      if (canvas) {
        canvas.width = Math.max(1, Math.round(m.screen.w * m.screen.dpr))
        canvas.height = Math.max(1, Math.round(m.screen.h * m.screen.dpr))
      }
      if (gpu) gpu.show(stroke)
      return
    case 'begin': {
      stroke = {
        w: m.w,
        h: m.h,
        softness: m.softness,
        erase: m.erase,
        toDisplay: m.toDisplay,
        auto: m.picture !== null
      }
      if (gpu) await gpu.begin(stroke, m.png, m.picture)
      else cpu = await cpuBegin(stroke, m.png, m.picture)
      return
    }
    case 'dabs':
      if (!stroke) return
      if (gpu) gpu.dabs(stroke, m.dabs)
      else if (cpu) cpuDabs(cpu, stroke, m.dabs)
      return
    case 'end': {
      const s = stroke
      stroke = null
      try {
        if (!s) return post({ t: 'done', id: m.id, png: null })
        let grey: Uint8Array
        if (gpu) grey = gpu.finish(s, m.density)
        else if (cpu) {
          const out = composeStroke(cpu.plane, cpu.stroke, m.density, s.erase)
          grey = new Uint8Array(out.length)
          for (let i = 0; i < out.length; i++) grey[i] = Math.round(out[i] * 255)
        } else return post({ t: 'done', id: m.id, png: null })
        cpu = null
        post({ t: 'done', id: m.id, png: await encodeGreyPng(grey, s.w, s.h) })
      } finally {
        clearCanvas()
      }
      return
    }
    case 'cancel':
      stroke = null
      cpu = null
      clearCanvas()
      return
  }
}

self.onmessage = (e: MessageEvent<BrushIn>): void => {
  const m = e.data
  chain = chain
    .then(() => handle(m))
    .catch((err) => {
      if (m.t === 'end') post({ t: 'done', id: m.id, png: null, error: String(err) })
      else console.warn('brush worker', err)
    })
}
