import { memo, useEffect, useRef } from 'react'
import { isFrame, pictureBitmap } from '../../lib/frames'

/**
 * Visualise Spots (the Heal tool): the picture as white on black where it
 * stands out from its surroundings, so dust and specks that hide in a busy
 * or bright picture show as dots. Each pixel's luminance against the mean of
 * the 9 × 9 around it, past a threshold that `level` (0…100) lowers. On the
 * GPU; without WebGL2 nothing is drawn.
 */
const VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos;
  gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0);
}`

const FS = `#version 300 es
precision highp float;
uniform sampler2D uPicture;
uniform float uThreshold;
in vec2 vUv;
out vec4 o;
float L(ivec2 p, ivec2 size) {
  vec3 c = texelFetch(uPicture, clamp(p, ivec2(0), size - 1), 0).rgb;
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}
void main() {
  ivec2 size = textureSize(uPicture, 0);
  // Rows as the bitmap holds them, top first (an ImageBitmap is not flipped on upload).
  ivec2 p = ivec2(vUv.x * float(size.x), (1.0 - vUv.y) * float(size.y));
  float sum = 0.0;
  for (int dy = -4; dy <= 4; dy++)
    for (int dx = -4; dx <= 4; dx++) sum += L(p + ivec2(dx, dy), size);
  float d = abs(L(p, size) - sum / 81.0);
  float v = smoothstep(uThreshold, uThreshold * 2.5, d);
  o = vec4(vec3(v), 1.0);
}`

interface Gl {
  gl: WebGL2RenderingContext
  tex: WebGLTexture
  threshold: WebGLUniformLocation | null
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
      out = { gl, tex, threshold: gl.getUniformLocation(p, 'uThreshold') }
    }
  }
  contexts.set(c, out)
  return out
}

/** The threshold a level means: 0 shows only strong specks, 100 the faintest. */
function spotThreshold(level: number): number {
  const t = Math.min(100, Math.max(0, level)) / 100
  return 0.06 * Math.pow(0.08, t)
}

export const SpotsOverlay = memo(function SpotsOverlay({
  url,
  level
}: {
  url: string
  level: number
}): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  // The picture, uploaded once per picture; the level only draws again.
  const loaded = useRef<string | null>(null)
  useEffect(() => {
    let live = true
    const c = ref.current
    const g = c && glFor(c)
    if (!c || !g) return
    const draw = (): void => {
      const { gl } = g
      gl.viewport(0, 0, c.width, c.height)
      gl.uniform1f(g.threshold, spotThreshold(level))
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }
    if (loaded.current === url) {
      draw()
      return
    }
    void (async () => {
      const bmp = isFrame(url)
        ? await pictureBitmap(url)
        : await createImageBitmap(await (await fetch(url)).blob())
      if (!live) return bmp.close()
      const { gl, tex } = g
      c.width = bmp.width
      c.height = bmp.height
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bmp)
      bmp.close()
      loaded.current = url
      draw()
    })().catch(() => undefined)
    return () => {
      live = false
    }
  }, [url, level])
  return <canvas ref={ref} className="overlay-canvas fill" />
})
