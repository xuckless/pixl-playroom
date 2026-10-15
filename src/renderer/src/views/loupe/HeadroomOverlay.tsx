import { memo, useEffect, useRef } from 'react'
import { drawPlane, type PlaneColours } from './planeOverlay'

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

/** STOPS and LUT above, as a shader: the same colours and the same alpha, premultiplied. */
const HEADROOM: PlaneColours = {
  lut: LUT,
  shade: `  vec3 a = vec3(255.0, 200.0, 90.0) / 255.0;
  vec3 b = vec3(255.0, 130.0, 40.0) / 255.0;
  vec3 m = vec3(240.0, 60.0, 200.0) / 255.0;
  vec3 c = v <= 0.5 ? mix(a, b, v / 0.5) : mix(b, m, (v - 0.5) / 0.5);
  float al = (70.0 + 150.0 * v) / 255.0;
  o = vec4(c * al, al);`
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
    void drawPlane(c, url, HEADROOM, () => live)
    return () => {
      live = false
    }
  }, [url])
  return <canvas ref={ref} className="overlay-canvas fill" />
})
