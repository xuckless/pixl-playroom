import { loadImage } from '../../lib/image'

/**
 * An engine plane (one grey channel) drawn over the picture in colour: the
 * headroom overlay's and the gamut warning's. A fragment shader colours it
 * on the GPU (a 5 MP pass on the CPU per settled render otherwise); `lut`,
 * the same colours and alpha for each of the 256 values, does it on the
 * CPU only where WebGL2 cannot.
 */
export interface PlaneColours {
  /** Reads `float v` (0…1) and writes the premultiplied `o`. */
  shade: string
  /** RGBA for each value 0…255 (not premultiplied). */
  lut: Uint8ClampedArray
}

const VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos;
  gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0);
}`

const fragment = (shade: string): string => `#version 300 es
precision mediump float;
uniform sampler2D uPlane;
in vec2 vUv;
out vec4 o;
void main() {
  float v = texelFetch(uPlane, ivec2(vUv.x * float(textureSize(uPlane, 0).x), (1.0 - vUv.y) * float(textureSize(uPlane, 0).y)), 0).r;
  if (v < 0.5 / 255.0) { o = vec4(0.0); return; }
${shade}
}`

const contexts = new WeakMap<HTMLCanvasElement, WebGL2RenderingContext | null>()

/** The canvas's WebGL2 context with `shade`'s program in use (each overlay keeps its own canvas). */
function glFor(c: HTMLCanvasElement, shade: string): WebGL2RenderingContext | null {
  if (contexts.has(c)) return contexts.get(c) ?? null
  let out: WebGL2RenderingContext | null = null
  const gl = c.getContext('webgl2', { premultipliedAlpha: true, antialias: false })
  if (gl) {
    const p = gl.createProgram() as WebGLProgram
    let ok = true
    for (const [type, src] of [
      [gl.VERTEX_SHADER, VS],
      [gl.FRAGMENT_SHADER, fragment(shade)]
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
async function drawOnGpu(
  c: HTMLCanvasElement,
  url: string,
  colours: PlaneColours,
  live: () => boolean
): Promise<boolean> {
  const gl = glFor(c, colours.shade)
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
async function drawInPlace(
  c: HTMLCanvasElement,
  url: string,
  { lut }: PlaneColours,
  live: () => boolean
): Promise<void> {
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
    px[i] = lut[v * 4]
    px[i + 1] = lut[v * 4 + 1]
    px[i + 2] = lut[v * 4 + 2]
    px[i + 3] = lut[v * 4 + 3]
  }
  ctx.putImageData(data, 0, 0)
}

/** The plane at `url` into `c` in `colours`: on the GPU, on the CPU only where WebGL2 cannot. */
export function drawPlane(
  c: HTMLCanvasElement,
  url: string,
  colours: PlaneColours,
  live: () => boolean
): Promise<void> {
  return drawOnGpu(c, url, colours, live)
    .then((done) => (done ? undefined : drawInPlace(c, url, colours, live)))
    .catch(() => undefined)
}
