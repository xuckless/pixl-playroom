/**
 * Clipping overlay off the main thread: fetch the rendered picture, mark
 * blown highlights and crushed shadows, and hand back a bitmap to draw.
 */
import { markClipping } from '../lib/clipping'

interface Job {
  id: number
  url: string
}

const post = (
  self as unknown as { postMessage(m: unknown, t?: Transferable[]): void }
).postMessage.bind(self)

self.onmessage = async (e: MessageEvent<Job>): Promise<void> => {
  const { id, url } = e.data
  try {
    const blob = await (await fetch(url)).blob()
    const bmp = await createImageBitmap(blob)
    const c = new OffscreenCanvas(bmp.width, bmp.height)
    const ctx = c.getContext('2d', {
      willReadFrequently: true
    }) as OffscreenCanvasRenderingContext2D
    ctx.drawImage(bmp, 0, 0)
    bmp.close()
    const data = ctx.getImageData(0, 0, c.width, c.height)
    markClipping(data.data)
    ctx.putImageData(data, 0, 0)
    const out = c.transferToImageBitmap()
    post({ id, bitmap: out }, [out])
  } catch (err) {
    post({ id, error: String(err) })
  }
}
