/**
 * The loupe's own mask, on the GPU: each component's plane (a gradient drawn
 * from its numbers, a lasso filled, a painted plane uploaded, a range keyed
 * on the picture), feathered, joined in order into the layer's mask, and
 * shown over the photo crossfaded with the engine's plane. Planes are kept
 * by what shapes them, so dragging one gradient redraws that one only.
 */
import { radialGeometry } from '../../../../../shared/gradients'
import { featherRadius, featherSigmaPx, planeKey } from '../../../../../shared/maskpreview'
import {
  EDGE_SHIFT_SPAN,
  offsetPolygon,
  shiftPixels,
  type MaskEdge
} from '../../../../../shared/maskedge'
import type { MaskMode } from '../../../../../shared/engine-types'
import type { MaskComponentSetting } from '../../../../../shared/recipe'
import {
  BLUR_FS,
  COMPONENT_FS,
  JOIN_FS,
  MORPH_FS,
  PBLUR_FS,
  RANGE_FS,
  SHADE_FS,
  SHAPE_FS,
  VS
} from './shaders'

/** Planes in the base frame are drawn this many pixels on their long edge. */
export const BASE_EDGE = 1024
/** The widest Gaussian the blur shader takes, in texels (its loop reaches 3σ ≤ 64). */
const MAX_SIGMA = 16
/** The frosted copy of the picture behind the glass: this wide at most, blurred this much (texels). */
const FROST_EDGE = 512
const FROST_SIGMA = 5

export type ViewMode =
  'colour' | 'image-black' | 'image-white' | 'white-black' | 'outline' | 'glass' | 'ghost'
const VIEW_INDEX: Record<ViewMode, number> = {
  colour: 0,
  'image-black': 1,
  'image-white': 2,
  'white-black': 3,
  outline: 4,
  glass: 5,
  ghost: 6
}
const MODE_INDEX: Record<MaskMode, number> = { Add: 0, Subtract: 1, Intersect: 2 }

interface Target {
  tex: WebGLTexture
  fb: WebGLFramebuffer
  w: number
  h: number
}

interface Plane {
  key: string
  target: Target
  /** In the base frame (else display space: a range, keyed on the picture as shown). */
  base: boolean
}

export interface Join {
  c: MaskComponentSetting
  /** How it joins the mask (see `maskJoins`). */
  mode: MaskMode
  /** For a painted component: its plane, decoded (turned upside down, as GL keeps it). */
  bitmap?: ImageBitmap
}

export interface Frame {
  joins: Join[]
  layerInvert: boolean
  /** Display → base, as a column-major mat3. */
  toBase: Float32Array
  /** The base frame's size in pixels (its aspect is what counts). */
  baseW: number
  baseH: number
  /** The picture as shown, for ranges (upside down, as GL keeps it). */
  picture: ImageBitmap | null
  pictureKey: string
  live: number
  view: ViewMode
  tint: [number, number, number]
  alpha: number
  reveal: number
  /** Molten glass: seconds, and how much its rim light moves (0 still). */
  time?: number
  flow?: number
}

export class MaskGl {
  readonly gl: WebGL2RenderingContext
  private readonly programs: Record<string, WebGLProgram> = {}
  private readonly uniforms = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>()
  private readonly planes = new Map<string, Plane>()
  private acc: [Target | null, Target | null] = [null, null]
  private scratch: Target | null = null
  private engine: WebGLTexture | null = null
  private engineKey = ''
  private picture: WebGLTexture | null = null
  private pictureKey = ''
  private pictureSize = { w: 0, h: 0 }
  /** The picture blurred, behind the glass: made once per picture. */
  private frost: [Target | null, Target | null] = [null, null]
  private frostKey = ''
  private polygonCanvas: OffscreenCanvas | null = null
  /** The last mask composed, and whether it is there to show. */
  private accIndex = 0
  /** Its components' planes and how they join, for showing them one by one. */
  private composed: { plane: Plane; join: Join }[] = []
  private composedToBase: Float32Array | null = null
  haveAcc = false
  haveEngine = false

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      premultipliedAlpha: true,
      antialias: false,
      preserveDrawingBuffer: true
    })
    if (!gl) throw new Error('no WebGL2')
    this.gl = gl
    for (const [name, fs] of Object.entries({
      shape: SHAPE_FS,
      blur: BLUR_FS,
      range: RANGE_FS,
      join: JOIN_FS,
      shade: SHADE_FS,
      morph: MORPH_FS,
      component: COMPONENT_FS,
      pblur: PBLUR_FS
    }))
      this.programs[name] = this.program(fs)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  }

  private program(fs: string): WebGLProgram {
    const gl = this.gl
    const p = gl.createProgram() as WebGLProgram
    for (const [type, src] of [
      [gl.VERTEX_SHADER, VS],
      [gl.FRAGMENT_SHADER, fs]
    ] as const) {
      const sh = gl.createShader(type) as WebGLShader
      gl.shaderSource(sh, src)
      gl.compileShader(sh)
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(sh) ?? 'shader')
      gl.attachShader(p, sh)
    }
    gl.bindAttribLocation(p, 0, 'aPos')
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(p) ?? 'link')
    this.uniforms.set(p, new Map())
    return p
  }

  private u(p: WebGLProgram, name: string): WebGLUniformLocation | null {
    const m = this.uniforms.get(p)!
    if (!m.has(name)) m.set(name, this.gl.getUniformLocation(p, name))
    return m.get(name) ?? null
  }

  private texture(filter: number = this.gl.LINEAR): WebGLTexture {
    const gl = this.gl
    const t = gl.createTexture() as WebGLTexture
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return t
  }

  private target(w: number, h: number, old?: Target | null): Target {
    const gl = this.gl
    if (old && old.w === w && old.h === h) return old
    if (old) {
      gl.deleteTexture(old.tex)
      gl.deleteFramebuffer(old.fb)
    }
    const tex = this.texture()
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, null)
    const fb = gl.createFramebuffer() as WebGLFramebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    return { tex, fb, w, h }
  }

  /** A colour render target (the frost). */
  private targetRgba(w: number, h: number, old: Target | null): Target {
    const gl = this.gl
    if (old && old.w === w && old.h === h) return old
    if (old) {
      gl.deleteTexture(old.tex)
      gl.deleteFramebuffer(old.fb)
    }
    const tex = this.texture()
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    const fb = gl.createFramebuffer() as WebGLFramebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    return { tex, fb, w, h }
  }

  /** The picture as shown (decoded upside down), for ranges and the glass. */
  setPicture(bitmap: ImageBitmap | null, key: string): void {
    if (!bitmap || key === this.pictureKey) return
    this.picture ??= this.texture()
    this.upload(bitmap, this.picture)
    this.pictureKey = key
    this.pictureSize = { w: bitmap.width, h: bitmap.height }
  }

  /** The frosted picture, blurred once per picture (two passes of the Gaussian). */
  private frosted(): WebGLTexture | null {
    if (!this.picture || !this.pictureSize.w) return null
    if (this.frostKey === this.pictureKey && this.frost[1]) return this.frost[1].tex
    const gl = this.gl
    const k = Math.min(1, FROST_EDGE / Math.max(this.pictureSize.w, this.pictureSize.h))
    const w = Math.max(8, Math.round(this.pictureSize.w * k))
    const h = Math.max(8, Math.round(this.pictureSize.h * k))
    this.frost = [this.targetRgba(w, h, this.frost[0]), this.targetRgba(w, h, this.frost[1])]
    const p = this.programs.pblur
    gl.useProgram(p)
    gl.uniform1f(this.u(p, 'uSigma'), FROST_SIGMA)
    this.bind(p, 0, 'uSrc', this.picture)
    gl.uniform2f(this.u(p, 'uStep'), 1 / w, 0)
    this.run(p, this.frost[0], w, h)
    this.bind(p, 0, 'uSrc', this.frost[0]!.tex)
    gl.uniform2f(this.u(p, 'uStep'), 0, 1 / h)
    this.run(p, this.frost[1], w, h)
    this.frostKey = this.pictureKey
    return this.frost[1]!.tex
  }

  private run(p: WebGLProgram, into: Target | null, w: number, h: number): void {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, into ? into.fb : null)
    gl.viewport(0, 0, w, h)
    gl.uniform2f(this.u(p, 'uSize'), w, h)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  private bind(p: WebGLProgram, unit: number, name: string, tex: WebGLTexture): void {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.uniform1i(this.u(p, name), unit)
  }

  /** Upload a decoded image (already upside down) as a texture. */
  private upload(bitmap: ImageBitmap | OffscreenCanvas, into: WebGLTexture): void {
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, into)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bitmap)
  }

  setEngine(bitmap: ImageBitmap | null, key: string): void {
    if (!bitmap) {
      this.haveEngine = false
      this.engineKey = ''
      return
    }
    if (key === this.engineKey) return
    this.engine ??= this.texture()
    this.upload(bitmap, this.engine)
    this.engineKey = key
    this.haveEngine = true
  }

  /** A component's plane, redrawn only when what shapes it changed. */
  private plane(j: Join, f: Frame, cw: number, ch: number): Plane | null {
    const gl = this.gl
    const c = j.c
    const base = c.kind !== 'range'
    const fullW = base ? f.baseW : cw
    const fullH = base ? f.baseH : ch
    // A wide feather is drawn smaller: the blur hides the resolution, and
    // keeps to a kernel the shader can take.
    const sigmaFull = featherSigmaPx(featherRadius(c), Math.min(fullW, fullH))
    const k = sigmaFull > MAX_SIGMA ? MAX_SIGMA / sigmaFull : 1
    const bw = Math.max(8, Math.round(fullW * k))
    const bh = Math.max(8, Math.round(fullH * k))
    const sigma = sigmaFull * k
    const key = `${planeKey(c)}|${bw}x${bh}|${c.kind === 'range' ? f.pictureKey : ''}|${
      c.kind === 'brush' ? (j.bitmap ? 'bmp' : 'none') : ''
    }`
    const had = this.planes.get(c.id)
    if (had && had.key === key) return had
    const t = this.target(bw, bh, had?.target)
    const plane: Plane = { key, target: t, base }
    if (c.kind === 'linear' || c.kind === 'radial') {
      const p = this.programs.shape
      gl.useProgram(p)
      gl.uniform2f(this.u(p, 'uPlane'), c.width, c.height)
      if (c.kind === 'linear') {
        const sx = c.start.x * c.width
        const sy = c.start.y * c.height
        gl.uniform1i(this.u(p, 'uKind'), 0)
        gl.uniform4f(this.u(p, 'uLine'), sx, sy, c.end.x * c.width - sx, c.end.y * c.height - sy)
      } else {
        const g = radialGeometry(c)
        gl.uniform1i(this.u(p, 'uKind'), 1)
        gl.uniform4f(this.u(p, 'uEllipse'), g.cx, g.cy, g.rx, g.ry)
        const inner = 1 - Math.min(100, Math.max(0, c.softness)) / 100
        gl.uniform3f(this.u(p, 'uTurn'), Math.cos(-g.angle), Math.sin(-g.angle), inner)
      }
      this.run(p, t, bw, bh)
    } else if (c.kind === 'polygon') {
      // A filled outline: the canvas draws it (non-zero, as the engine fills).
      const oc = (this.polygonCanvas ??= new OffscreenCanvas(bw, bh))
      if (oc.width !== bw || oc.height !== bh) {
        oc.width = bw
        oc.height = bh
      }
      const ctx = oc.getContext('2d') as OffscreenCanvasRenderingContext2D
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, bw, bh)
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, bw, bh)
      // Upside down, as GL keeps textures. Moved by its edge as the
      // compiler moves it (shared/maskedge.ts), on the base frame's shape.
      ctx.setTransform(bw, 0, 0, -bh, 0, bh)
      ctx.beginPath()
      const by =
        ((c.edge?.shift ?? 0) / 100) * EDGE_SHIFT_SPAN - (c.edge?.inside ? featherRadius(c) : 0)
      const points = offsetPolygon(c.points, by, f.baseW, f.baseH)
      points.forEach((q, i) => (i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y)))
      ctx.closePath()
      ctx.fillStyle = '#fff'
      ctx.fill('nonzero')
      gl.bindTexture(gl.TEXTURE_2D, t.tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, oc)
    } else if (c.kind === 'brush') {
      if (!j.bitmap) return null
      gl.bindTexture(gl.TEXTURE_2D, t.tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, bw, bh, 0, gl.RED, gl.UNSIGNED_BYTE, null)
      // Uploaded, then drawn to the plane's size by the blur with no width (a copy).
      const src = this.texture()
      this.upload(j.bitmap, src)
      const p = this.programs.blur
      gl.useProgram(p)
      this.bind(p, 0, 'uSrc', src)
      gl.uniform2f(this.u(p, 'uStep'), 0, 0)
      gl.uniform1f(this.u(p, 'uSigma'), 0.001)
      this.run(p, t, bw, bh)
      gl.deleteTexture(src)
    } else {
      if (!this.picture) return null
      const p = this.programs.range
      gl.useProgram(p)
      this.bind(p, 0, 'uPicture', this.picture)
      const band = (
        n: string,
        b: { centre: number; width: number; softness: number } | null
      ): void => {
        gl.uniform4f(this.u(p, n), b?.centre ?? 0, b?.width ?? 0, b?.softness ?? 0, b ? 1 : 0)
      }
      band('uHue', c.hue)
      band('uSat', c.saturation)
      band('uLuma', c.luma)
      this.run(p, t, bw, bh)
    }
    // A painted or gradient plane's edge moved and hardened, as the engine's is.
    if (c.kind === 'brush' || c.kind === 'linear' || c.kind === 'radial')
      plane.target = this.edged(plane.target, bw, bh, c.edge)
    const tt = plane.target
    // Feather: a Gaussian across the plane, in its own pixels.
    if (sigma > 0.35) {
      this.scratch = this.target(bw, bh, this.scratch)
      const p = this.programs.blur
      gl.useProgram(p)
      gl.uniform1f(this.u(p, 'uSigma'), sigma)
      this.bind(p, 0, 'uSrc', tt.tex)
      gl.uniform2f(this.u(p, 'uStep'), 1 / bw, 0)
      this.run(p, this.scratch, bw, bh)
      this.bind(p, 0, 'uSrc', this.scratch.tex)
      gl.uniform2f(this.u(p, 'uStep'), 0, 1 / bh)
      this.run(p, tt, bw, bh)
    }
    this.planes.set(c.id, plane)
    return plane
  }

  /**
   * `t` with the edge applied (shared/maskedge.ts): the octagon's four
   * min/max passes (a square, then the two diagonals), the last also
   * hardening. Ping-pongs with the scratch target; returns where it ended.
   */
  private edged(t: Target, w: number, h: number, edge: MaskEdge | undefined): Target {
    if (!edge) return t
    const r = Math.min(128, shiftPixels(edge.shift, w, h))
    const tHalf = Math.floor((r - Math.round(r * (Math.SQRT2 - 1))) / 2)
    const a = r - 2 * tHalf
    const harden = 1 + (Math.min(100, Math.max(0, edge.harden)) / 100) * 9
    const passes: [number, number, number][] = [
      [1 / w, 0, a],
      [0, 1 / h, a],
      [1 / w, 1 / h, tHalf],
      [-1 / w, 1 / h, tHalf]
    ].filter(([, , rad]) => rad > 0) as [number, number, number][]
    if (passes.length === 0 && harden === 1) return t
    if (passes.length === 0) passes.push([0, 0, 0])
    const gl = this.gl
    const p = this.programs.morph
    gl.useProgram(p)
    gl.uniform1i(this.u(p, 'uGrow'), edge.shift > 0 ? 1 : 0)
    let src = t
    let dst = (this.scratch = this.target(w, h, this.scratch))
    passes.forEach(([sx, sy, rad], i) => {
      this.bind(p, 0, 'uSrc', src.tex)
      gl.uniform2f(this.u(p, 'uStep'), sx, sy)
      gl.uniform1i(this.u(p, 'uR'), rad)
      gl.uniform1f(this.u(p, 'uHarden'), i === passes.length - 1 ? harden : 1)
      this.run(p, dst, w, h)
      ;[src, dst] = [dst, src]
    })
    // The scratch is whichever target the result is not in.
    this.scratch = dst
    return src
  }

  /**
   * Compose the loupe's mask from `f.joins`. False when a plane it needs is
   * not ready (a painted plane still decoding, a range with no picture yet).
   */
  compose(f: Frame): boolean {
    const gl = this.gl
    const cw = this.canvas.width
    const ch = this.canvas.height
    this.setPicture(f.picture, f.pictureKey)
    const planes: Plane[] = []
    for (const j of f.joins) {
      const p = this.plane(j, f, cw, ch)
      if (!p) return false
      planes.push(p)
    }
    const live = new Set(f.joins.map((j) => j.c.id))
    for (const [id, p] of this.planes)
      if (!live.has(id)) {
        gl.deleteTexture(p.target.tex)
        gl.deleteFramebuffer(p.target.fb)
        this.planes.delete(id)
      }
    this.acc = [this.target(cw, ch, this.acc[0]), this.target(cw, ch, this.acc[1])]
    const p = this.programs.join
    gl.useProgram(p)
    gl.uniformMatrix3fv(this.u(p, 'uToBase'), false, f.toBase)
    let from = 0
    planes.forEach((plane, i) => {
      const j = f.joins[i]
      const into = this.acc[1 - from]!
      this.bind(p, 0, 'uAcc', this.acc[from]!.tex)
      this.bind(p, 1, 'uComp', plane.target.tex)
      gl.uniform1i(this.u(p, 'uFirst'), i === 0 ? 1 : 0)
      gl.uniform1i(this.u(p, 'uBase'), plane.base ? 1 : 0)
      gl.uniform1i(this.u(p, 'uMode'), MODE_INDEX[j.mode])
      gl.uniform1i(this.u(p, 'uInvert'), j.c.invert ? 1 : 0)
      gl.uniform1f(this.u(p, 'uOpacity'), Math.min(1, Math.max(0, j.c.opacity / 100)))
      this.run(p, into, cw, ch)
      from = 1 - from
    })
    this.accIndex = from
    this.haveAcc = planes.length > 0
    this.composed = planes.map((plane, i) => ({ plane, join: f.joins[i] }))
    this.composedToBase = f.toBase
    return true
  }

  /**
   * The last mask composed shown a component at a time, each in its colour
   * (`colours[i]`, linear 0…1), in order, at `alpha`: what each part covers.
   * False when there is nothing composed to show.
   */
  shadeComponents(colours: [number, number, number][], alpha: number): boolean {
    if (!this.haveAcc || this.composed.length === 0 || !this.composedToBase) return false
    const gl = this.gl
    const cw = this.canvas.width
    const ch = this.canvas.height
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, cw, ch)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    const p = this.programs.component
    gl.useProgram(p)
    gl.uniformMatrix3fv(this.u(p, 'uToBase'), false, this.composedToBase)
    gl.uniform1f(this.u(p, 'uAlpha'), alpha)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    this.composed.forEach(({ plane, join }, i) => {
      const [r, g, b] = colours[i % colours.length]
      this.bind(p, 0, 'uComp', plane.target.tex)
      gl.uniform1i(this.u(p, 'uBase'), plane.base ? 1 : 0)
      gl.uniform1i(this.u(p, 'uInvert'), join.c.invert ? 1 : 0)
      gl.uniform1f(this.u(p, 'uOpacity'), Math.min(1, Math.max(0, join.c.opacity / 100)))
      gl.uniform3f(this.u(p, 'uTint'), r, g, b)
      gl.uniform1i(this.u(p, 'uHatch'), join.mode === 'Subtract' ? 1 : 0)
      this.run(p, null, cw, ch)
    })
    gl.disable(gl.BLEND)
    return true
  }

  /** Show the mask over the photo (the loupe's, the engine's, or between them). */
  shade(
    f: Pick<Frame, 'layerInvert' | 'live' | 'view' | 'tint' | 'alpha' | 'reveal' | 'time' | 'flow'>
  ): void {
    const gl = this.gl
    const cw = this.canvas.width
    const ch = this.canvas.height
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, cw, ch)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (!this.haveAcc && !this.haveEngine) return
    const frost = f.view === 'glass' ? this.frosted() : null
    const p = this.programs.shade
    gl.useProgram(p)
    if (frost && this.picture) {
      this.bind(p, 2, 'uPicture', this.picture)
      this.bind(p, 3, 'uFrost', frost)
    }
    gl.uniform1i(this.u(p, 'uHavePicture'), frost ? 1 : 0)
    gl.uniform1f(this.u(p, 'uTime'), f.time ?? 0)
    gl.uniform1f(this.u(p, 'uFlow'), f.flow ?? 0)
    const acc = this.acc[this.accIndex]
    if (acc) this.bind(p, 0, 'uAcc', acc.tex)
    if (this.engine) this.bind(p, 1, 'uEngine', this.engine)
    gl.uniform1i(this.u(p, 'uHaveAcc'), this.haveAcc && acc ? 1 : 0)
    gl.uniform1i(this.u(p, 'uHaveEngine'), this.haveEngine ? 1 : 0)
    gl.uniform1i(this.u(p, 'uLayerInvert'), f.layerInvert ? 1 : 0)
    gl.uniform1f(this.u(p, 'uLive'), f.live)
    gl.uniform1i(this.u(p, 'uView'), VIEW_INDEX[f.view])
    gl.uniform3f(this.u(p, 'uTint'), f.tint[0], f.tint[1], f.tint[2])
    gl.uniform1f(this.u(p, 'uAlpha'), f.alpha)
    gl.uniform1f(this.u(p, 'uReveal'), f.reveal)
    this.run(p, null, cw, ch)
  }

  /** The loupe's own mask as 8-bit rows, top down (for comparing with the engine's). */
  readMask(): { data: Uint8Array; width: number; height: number } | null {
    const acc = this.acc[this.accIndex]
    if (!acc || !this.haveAcc) return null
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, acc.fb)
    const rgba = new Uint8Array(acc.w * acc.h * 4)
    gl.readPixels(0, 0, acc.w, acc.h, gl.RGBA, gl.UNSIGNED_BYTE, rgba)
    const out = new Uint8Array(acc.w * acc.h)
    for (let y = 0; y < acc.h; y++)
      for (let x = 0; x < acc.w; x++) out[(acc.h - 1 - y) * acc.w + x] = rgba[(y * acc.w + x) * 4]
    return { data: out, width: acc.w, height: acc.h }
  }

  dispose(): void {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}
