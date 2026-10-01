/**
 * Preview frames: drafts the engine sends as pixels (RGBA, Display P3) over
 * their own port, not as files (main/render.ts). A render event names one as
 * `frame:<id>` in its `url`; this keeps the last few as bitmaps, so the loupe
 * draws one without decoding anything, and everything that reads a picture
 * (`pictureBitmap`) takes a frame or a file alike.
 */

/** Frames kept: the one shown, the one fading out, and a couple on their way. */
const KEEP = 4
/** How long a render event waits for its frame before it is dropped. */
const WAIT_MS = 2000

const frames = new Map<string, ImageBitmap>()
const waiting = new Map<string, ((b: ImageBitmap | null) => void)[]>()

export const isFrame = (url: string): boolean => url.startsWith('frame:')

/** A frame's bitmap, while it is kept. */
export function frameBitmap(url: string): ImageBitmap | undefined {
  return frames.get(url)
}

/** Resolves with the frame once it is here (at once if it is), or null after WAIT_MS. */
export function whenFrame(url: string): Promise<ImageBitmap | null> {
  const hit = frames.get(url)
  if (hit) return Promise.resolve(hit)
  return new Promise((resolve) => {
    const done = (b: ImageBitmap | null): void => {
      clearTimeout(timer)
      resolve(b)
    }
    const timer = setTimeout(() => {
      const list = waiting.get(url)?.filter((f) => f !== done) ?? []
      if (list.length > 0) waiting.set(url, list)
      else waiting.delete(url)
      resolve(null)
    }, WAIT_MS)
    waiting.set(url, [...(waiting.get(url) ?? []), done])
  })
}

function keep(url: string, bmp: ImageBitmap): void {
  frames.set(url, bmp)
  for (const done of waiting.get(url) ?? []) done(bmp)
  waiting.delete(url)
  // The oldest go; a canvas that drew one keeps its pixels.
  while (frames.size > KEEP) {
    const [old, b] = frames.entries().next().value as [string, ImageBitmap]
    frames.delete(old)
    b.close()
  }
}

interface FrameMessage {
  pixlFrame?: { frame: string; width: number; height: number; data: ArrayBuffer }
}

window.addEventListener('message', (e: MessageEvent<FrameMessage>) => {
  const f = e.source === window ? e.data?.pixlFrame : undefined
  if (!f) return
  const image = new ImageData(new Uint8ClampedArray(f.data), f.width, f.height, {
    colorSpace: 'display-p3'
  })
  void createImageBitmap(image).then(
    (bmp) => keep(`frame:${f.frame}`, bmp),
    () => undefined
  )
})

/**
 * A picture as a bitmap, whether a frame or a file (fetched and decoded),
 * optionally at `width` (aspect kept). A frame's own bitmap is never handed
 * out: the caller owns what it gets and may close or transfer it.
 */
export async function pictureBitmap(url: string, width?: number): Promise<ImageBitmap> {
  const opts: ImageBitmapOptions | undefined = width
    ? { resizeWidth: Math.max(1, Math.round(width)), resizeQuality: 'medium' }
    : undefined
  if (isFrame(url)) {
    const bmp = frameBitmap(url) ?? (await whenFrame(url))
    if (!bmp) throw new Error('the preview frame is gone')
    return createImageBitmap(bmp, opts ?? {})
  }
  const blob = await (await fetch(url)).blob()
  return createImageBitmap(blob, opts ?? {})
}
