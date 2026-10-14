/**
 * Resolve's scopes off the main thread: the picture's pixels binned into the
 * waveform, parade, vectorscope and CIE counts (shared/scopes.ts), handed
 * back as buffers to paint.
 */
import { binScopes, type ScopeKind, type ScopePixels } from '../../../shared/scopes'

interface Job {
  id: number
  want: ScopeKind[]
  /** An SDR picture (or Full HDR's companion): drawn and read as Display P3. */
  bitmap?: ImageBitmap
  /** Full HDR: encoded floats already sampled from the F16 frame. */
  floats?: { width: number; height: number; data: Float32Array }
  /** The selected mask's plane, for the scopes "in mask": stretched over the picture. */
  mask?: ImageBitmap
}

const post = (
  self as unknown as { postMessage(m: unknown, t?: Transferable[]): void }
).postMessage.bind(self)

/** A mask plane at the picture's size, as RGBA bytes (its grey in each channel). */
function planeOf(bmp: ImageBitmap, width: number, height: number): Uint8ClampedArray {
  const c = new OffscreenCanvas(width, height)
  const ctx = c.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D
  ctx.drawImage(bmp, 0, 0, width, height)
  bmp.close()
  return ctx.getImageData(0, 0, width, height).data
}

function pixelsOf(bmp: ImageBitmap): ScopePixels {
  const c = new OffscreenCanvas(bmp.width, bmp.height)
  const ctx = c.getContext('2d', {
    colorSpace: 'display-p3',
    willReadFrequently: true
  }) as OffscreenCanvasRenderingContext2D
  ctx.drawImage(bmp, 0, 0)
  bmp.close()
  const img = ctx.getImageData(0, 0, c.width, c.height, { colorSpace: 'display-p3' })
  return { width: img.width, height: img.height, data: img.data }
}

self.onmessage = (e: MessageEvent<Job>): void => {
  const { id, want, bitmap, floats, mask } = e.data
  try {
    const t0 = performance.now()
    const px = floats ?? (bitmap ? pixelsOf(bitmap) : null)
    if (!px) throw new Error('no pixels')
    const bins = binScopes(px, { want, mask: mask ? planeOf(mask, px.width, px.height) : null })
    const ms = performance.now() - t0
    const buffers = [bins.waveform, bins.parade, bins.vector, bins.cie]
      .filter((b): b is Uint32Array => b !== null)
      .map((b) => b.buffer as ArrayBuffer)
    post({ id, bins, ms }, buffers)
  } catch (err) {
    post({ id, error: String(err) })
  }
}
