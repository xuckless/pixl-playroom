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

/** The average colour of a `size × size` patch of an image around a normalised point, 0…1. */
export async function samplePatch(
  url: string,
  nx: number,
  ny: number,
  size = 5
): Promise<[number, number, number]> {
  const img = await loadImage(url)
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
  const px = Math.floor(nx * img.naturalWidth) - Math.floor(size / 2)
  const py = Math.floor(ny * img.naturalHeight) - Math.floor(size / 2)
  // Only the patch is drawn and read back, never the whole picture.
  ctx.drawImage(img, px, py, size, size, 0, 0, size, size)
  const d = ctx.getImageData(0, 0, size, size).data
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
