import { memo, useEffect, useRef } from 'react'
import { loadImage } from '../../lib/image'

/**
 * The colours of the headroom overlay, by how far above white a pixel sits
 * (0 at white … 1 at the working peak): nothing at white, then amber, orange
 * and magenta at the peak — warm like a highlight, and never a colour the
 * clipping overlay uses.
 */
const STOPS: [number, [number, number, number]][] = [
  [0, [255, 200, 90]],
  [0.5, [255, 130, 40]],
  [1, [240, 60, 200]]
]

const LUT = (() => {
  const t = new Uint8ClampedArray(256 * 4)
  for (let i = 1; i < 256; i++) {
    const v = i / 255
    let k = 0
    while (k < STOPS.length - 2 && v > STOPS[k + 1][0]) k++
    const [a, ca] = STOPS[k]
    const [b, cb] = STOPS[k + 1]
    const f = Math.min(1, Math.max(0, (v - a) / (b - a)))
    for (let c = 0; c < 3; c++) t[i * 4 + c] = ca[c] + (cb[c] - ca[c]) * f
    // Faint just above white, strong toward the peak.
    t[i * 4 + 3] = 70 + 150 * v
  }
  return t
})()

// ── on the GPU ───────────────────────────────────────────────────────────────

const VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos;
  gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0);
}`

/** STOPS and LUT above, as a shader: the same colours and the same alpha, premultiplied. */
const FS = `#version 300 es
precision mediump float;
uniform sampler2D uPlane;
in vec2 vUv;
out vec4 o;
void main() {
  float v = texelFetch(uPlane, ivec2(vUv.x * float(textureSize(uPlane, 0).x), (1.0 - vUv.y) * float(textureSize(uPlane, 0).y)), 0).r;
  if (v < 0.5 / 255.0) { o = vec4(0.0); return; }
  vec3 a = vec3(255.0, 200.0, 90.0) / 255.0;
  vec3 b = vec3(255.0, 130.0, 40.0) / 255.0;
  vec3 m = vec3(240.0, 60.0, 200.0) / 255.0;
  vec3 c = v <= 0.5 ? mix(a, b, v / 0.5) : mix(b, m, (v - 0.5) / 0.5);
  float al = (70.0 + 150.0 * v) / 255.0;
  o = vec4(c * al, al);
}`

const contexts = new WeakMap<HTMLCanvasElement, WebGL2RenderingContext | null>()

function glFor(c: HTMLCanvasElement): WebGL2RenderingContext | null {
  if (contexts.has(c)) return contexts.get(c) ?? null
  let out: WebGL2RenderingContext | null = null
  const gl = c.getContext('webgl2', { premultipliedAlpha: true, antialias: false })
  if (gl) {
    const p = gl.createProgram() as WebGLProgram
    let ok = true
    for (const [type, src] of [
      [gl.VERTEX_SHADER, VS],
      [gl.FRAGMENT_SHADER, FS]
    ] as const) {
      const sh = gl.createShader(type) as WebGLShader
      gl.shaderSource(sh, src)
      gl.compileShader(sh)
      ok &&= !!gl.getShaderParameter(sh, gl.COMPILE_STATUS)
      gl.attachShader(p, sh)
    }
    gl.bindAttribLocation(p, 0, 'aPos')
    gl.linkProgram(p)
    if (ok && gl.getProgramParameter(p, gl.LINK_STATUS)) {
      gl.useProgram(p)
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
      gl.enableVertexAttribArray(0)
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
      gl.bindTexture(gl.TEXTURE_2D, gl.createTexture())
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.uniform1i(gl.getUniformLocation(p, 'uPlane'), 0)
      out = gl
    }
  }
  contexts.set(c, out)
  return out
}

/** The plane coloured by a shader; false where WebGL2 cannot (the CPU then does it). */
async function drawOnGpu(c: HTMLCanvasElement, url: string, live: () => boolean): Promise<boolean> {
  const gl = glFor(c)
  if (!gl) return false
  const bmp = await createImageBitmap(await (await fetch(url)).blob(), {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none'
  })
  if (!live()) {
    bmp.close()
    return true
  }
  c.width = bmp.width
  c.height = bmp.height
  gl.viewport(0, 0, c.width, c.height)
  // An ImageBitmap is not flipped on upload (Chromium ignores the flag for
  // one): its rows stay top first, and the shader reads them from the top.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bmp)
  bmp.close()
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  return true
}

/** The plane coloured on the CPU (no WebGL2): a pass over every pixel. */
async function drawInPlace(c: HTMLCanvasElement, url: string, live: () => boolean): Promise<void> {
  const img = await loadImage(url)
  if (!live()) return
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  const ctx = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
  ctx.drawImage(img, 0, 0)
  const data = ctx.getImageData(0, 0, c.width, c.height)
  const px = data.data
  for (let i = 0; i < px.length; i += 4) {
    const v = px[i]
    px[i] = LUT[v * 4]
    px[i + 1] = LUT[v * 4 + 1]
    px[i + 2] = LUT[v * 4 + 2]
    px[i + 3] = LUT[v * 4 + 3]
  }
  ctx.putImageData(data, 0, 0)
}

/**
 * Where an HDR picture rises above white, from the engine's headroom plane:
 * coloured by a shader on the GPU (a 5 MP pass on the CPU per settled render
 * otherwise), on the CPU only where WebGL2 cannot.
 */
export const HeadroomOverlay = memo(function HeadroomOverlay({
  url
}: {
  url: string
}): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let live = true
    const c = ref.current
    if (!c) return
    void drawOnGpu(c, url, () => live)
      .then((done) => (done ? undefined : drawInPlace(c, url, () => live)))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [url])
  return <canvas ref={ref} className="overlay-canvas fill" />
})
