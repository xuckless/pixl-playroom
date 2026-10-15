import { memo, useEffect, useRef } from 'react'
import {
  GAMUT_COLOUR,
  GAMUT_SCALE,
  GAMUT_THRESHOLD,
  gamutAlpha
} from '../../../../shared/gamutwarning'
import { drawPlane, type PlaneColours } from './planeOverlay'

const LUT = (() => {
  const t = new Uint8ClampedArray(256 * 4)
  for (let i = 1; i < 256; i++) {
    t.set(GAMUT_COLOUR, i * 4)
    t[i * 4 + 3] = Math.round(gamutAlpha(i / 255) * 255)
  }
  return t
})()

const f = (n: number): string => n.toFixed(4)

/** `gamutAlpha` and the colour as a shader, premultiplied. */
const GAMUT: PlaneColours = {
  lut: LUT,
  shade: `  float de = v * ${f(GAMUT_SCALE)};
  if (de < ${f(GAMUT_THRESHOLD)}) { o = vec4(0.0); return; }
  float k = clamp((de - ${f(GAMUT_THRESHOLD)}) / ${f(GAMUT_SCALE - GAMUT_THRESHOLD)}, 0.0, 1.0);
  float al = 0.55 + 0.35 * k;
  vec3 c = vec3(${GAMUT_COLOUR.map((x) => f(x / 255)).join(', ')});
  o = vec4(c * al, al);`
}

/**
 * The gamut warning (soft proofing): where the picture holds colours the
 * export's colour space cannot, from the engine's ΔE2000 plane. Marked from
 * ΔE 2, deeper the further out a colour lies.
 */
export const GamutOverlay = memo(function GamutOverlay({
  url
}: {
  url: string
}): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let live = true
    const c = ref.current
    if (!c) return
    void drawPlane(c, url, GAMUT, () => live)
    return () => {
      live = false
    }
  }, [url])
  return <canvas ref={ref} className="overlay-canvas fill" />
})
