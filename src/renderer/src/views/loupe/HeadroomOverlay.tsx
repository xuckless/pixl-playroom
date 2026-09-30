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

/** Where an HDR picture rises above white, from the engine's headroom plane. */
export const HeadroomOverlay = memo(function HeadroomOverlay({
  url
}: {
  url: string
}): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let live = true
    void loadImage(url)
      .then((img) => {
        const c = ref.current
        if (!live || !c) return
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
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [url])
  return <canvas ref={ref} className="overlay-canvas fill" />
})
