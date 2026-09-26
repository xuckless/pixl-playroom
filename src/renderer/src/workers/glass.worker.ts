/**
 * Liquid glass maps off the main thread: the lens's per-pixel optics and
 * the two PNG encodes, handed back as data URLs for the SVG filter.
 */
import { lensPixels, type GlassMaps, type GlassShape } from '../components/glass/maps'
import { base64 } from '../lib/png'

const post = (self as unknown as { postMessage(m: unknown): void }).postMessage.bind(self)

async function url(data: Uint8ClampedArray<ArrayBuffer>, w: number, h: number): Promise<string> {
  const c = new OffscreenCanvas(w, h)
  ;(c.getContext('2d') as OffscreenCanvasRenderingContext2D).putImageData(
    new ImageData(data, w, h),
    0,
    0
  )
  const blob = await c.convertToBlob({ type: 'image/png' })
  return `data:image/png;base64,${base64(new Uint8Array(await blob.arrayBuffer()))}`
}

self.onmessage = async (e: MessageEvent<{ id: number; shape: GlassShape }>): Promise<void> => {
  const { id, shape } = e.data
  try {
    const px = lensPixels(shape)
    const maps: GlassMaps | null = px
      ? {
          displacement: await url(px.displacement, px.w, px.h),
          specular: await url(px.specular, px.w, px.h),
          scale: px.scale
        }
      : null
    post({ id, maps })
  } catch {
    post({ id, maps: null })
  }
}
