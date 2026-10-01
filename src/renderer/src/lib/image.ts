import { frameBitmap, isFrame, whenFrame } from './frames'

/** Load an image the renderer can read pixels from. */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`cannot load ${url}`))
    img.src = url
  })
}

async function frameOrThrow(url: string): Promise<ImageBitmap> {
  const bmp = frameBitmap(url) ?? (await whenFrame(url))
  if (!bmp) throw new Error('the preview frame is gone')
  return bmp
}

/** The average colour of a `size × size` patch of an image around a normalised point, 0…1. */
export async function samplePatch(
  url: string,
  nx: number,
  ny: number,
  size = 5,
  /** `display-p3` reads the preview's own values (it is rendered in Display P3), unclipped. */
  space: PredefinedColorSpace = 'srgb'
): Promise<[number, number, number]> {
  // A preview frame is read where it is (only the patch is drawn from it).
  const img = isFrame(url) ? await frameOrThrow(url) : await loadImage(url)
  const w = 'naturalWidth' in img ? img.naturalWidth : img.width
  const h = 'naturalHeight' in img ? img.naturalHeight : img.height
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d', {
    willReadFrequently: true,
    colorSpace: space
  }) as CanvasRenderingContext2D
  const px = Math.floor(nx * w) - Math.floor(size / 2)
  const py = Math.floor(ny * h) - Math.floor(size / 2)
  // Only the patch is drawn and read back, never the whole picture.
  ctx.drawImage(img, px, py, size, size, 0, 0, size, size)
  const d = ctx.getImageData(0, 0, size, size, { colorSpace: space }).data
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue
    r += d[i]
    g += d[i + 1]
    b += d[i + 2]
    n++
  }
  n = Math.max(1, n) * 255
  return [r / n, g / n, b / n]
}
