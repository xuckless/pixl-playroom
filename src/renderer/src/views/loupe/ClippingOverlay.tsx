import { memo, useEffect, useRef } from 'react'
import { markClipping } from '../../lib/clipping'
import { loadImage } from '../../lib/image'

type Reply = { id: number; bitmap?: ImageBitmap; error?: string }

let worker: Worker | null | undefined
let nextId = 0
const waiting = new Map<number, (r: Reply) => void>()

/** The shared clipping worker, or null where workers cannot start (the overlay then works in place). */
function clippingWorker(): Worker | null {
  if (worker !== undefined) return worker
  try {
    worker = new Worker(new URL('../../workers/clipping.worker.ts', import.meta.url), {
      type: 'module'
    })
    worker.onmessage = (e: MessageEvent<Reply>) => {
      waiting.get(e.data.id)?.(e.data)
      waiting.delete(e.data.id)
    }
    worker.onerror = () => {
      worker = null
      for (const [id, done] of waiting) done({ id, error: 'worker failed' })
      waiting.clear()
    }
  } catch {
    worker = null
  }
  return worker
}

async function inPlace(url: string): Promise<ImageBitmap> {
  const img = await loadImage(url)
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  const ctx = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
  ctx.drawImage(img, 0, 0)
  const data = ctx.getImageData(0, 0, c.width, c.height)
  markClipping(data.data)
  ctx.putImageData(data, 0, 0)
  return createImageBitmap(c)
}

function clippingBitmap(url: string): Promise<ImageBitmap> {
  const w = clippingWorker()
  if (!w) return inPlace(url)
  return new Promise((resolve, reject) => {
    const id = ++nextId
    waiting.set(id, (r) => {
      if (r.bitmap) resolve(r.bitmap)
      else inPlace(url).then(resolve, reject)
    })
    w.postMessage({ id, url })
  })
}

// ── on the GPU ───────────────────────────────────────────────────────────────

const VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos;
  gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0);
}`

/** The thresholds of lib/clipping.ts: a channel at 254+ is blown, all at 1 or below crushed. */
const FS = `#version 300 es
precision mediump float;
uniform sampler2D uPicture;
in vec2 vUv;
out vec4 o;
void main() {
  vec3 c = texelFetch(uPicture, ivec2(vUv * vec2(textureSize(uPicture, 0))), 0).rgb * 255.0;
  float hi = max(c.r, max(c.g, c.b));
  float a = 220.0 / 255.0;
  if (hi >= 253.5) o = vec4(vec3(255.0, 60.0, 90.0) / 255.0 * a, a);
  else if (hi <= 1.5) o = vec4(vec3(90.0, 120.0, 255.0) / 255.0 * a, a);
  else o = vec4(0.0);
}`

interface Gl {
  gl: WebGL2RenderingContext
  tex: WebGLTexture
}
const contexts = new WeakMap<HTMLCanvasElement, Gl | null>()

function glFor(c: HTMLCanvasElement): Gl | null {
  if (contexts.has(c)) return contexts.get(c) ?? null
  let out: Gl | null = null
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
      const tex = gl.createTexture() as WebGLTexture
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.uniform1i(gl.getUniformLocation(p, 'uPicture'), 0)
      out = { gl, tex }
    }
  }
  contexts.set(c, out)
  return out
}

/** Mark the picture's clipping on the canvas with a shader; false where WebGL2 cannot. */
async function drawOnGpu(c: HTMLCanvasElement, url: string, live: () => boolean): Promise<boolean> {
  const g = glFor(c)
  if (!g) return false
  // Decoded off the main thread, the file's own values (clipping is in its encoding).
  const bmp = await createImageBitmap(await (await fetch(url)).blob(), {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none'
  })
  if (!live()) {
    bmp.close()
    return true
  }
  const { gl, tex } = g
  c.width = bmp.width
  c.height = bmp.height
  gl.viewport(0, 0, c.width, c.height)
  gl.bindTexture(gl.TEXTURE_2D, tex)
  // Rows as the file stores them, top first: the quad draws them the right way up.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bmp)
  bmp.close()
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  return true
}

/**
 * Red over blown highlights, blue over crushed shadows: marked by a shader
 * over the picture on the GPU, or (without WebGL2) worked out in a worker.
 */
export const ClippingOverlay = memo(function ClippingOverlay({
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
      .then(async (done) => {
        if (done) return
        const bmp = await clippingBitmap(url)
        if (!live) return bmp.close()
        c.width = bmp.width
        c.height = bmp.height
        const ctx = c.getContext('2d') as CanvasRenderingContext2D
        ctx.clearRect(0, 0, c.width, c.height)
        ctx.drawImage(bmp, 0, 0)
        bmp.close()
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [url])
  return <canvas ref={ref} className="overlay-canvas fill" />
})
