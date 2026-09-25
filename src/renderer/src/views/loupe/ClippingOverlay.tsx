import { memo, useEffect, useRef } from 'react'
import { markClipping } from '../../lib/clipping'
import { loadImage } from '../../lib/image'

type Reply = { id: number; bitmap?: ImageBitmap; error?: string }

let worker: Worker | null | undefined
let nextId = 0
const waiting = new Map<number, (r: Reply) => void>()

/** The shared clipping worker, or null where workers cannot start (the overlay then works in place). */
function clippingWorker(): Worker | null {
  if (worker !== undefined) return worker
  try {
    worker = new Worker(new URL('../../workers/clipping.worker.ts', import.meta.url), {
      type: 'module'
    })
    worker.onmessage = (e: MessageEvent<Reply>) => {
      waiting.get(e.data.id)?.(e.data)
      waiting.delete(e.data.id)
    }
    worker.onerror = () => {
      worker = null
      for (const [id, done] of waiting) done({ id, error: 'worker failed' })
      waiting.clear()
    }
  } catch {
    worker = null
  }
  return worker
}

async function inPlace(url: string): Promise<ImageBitmap> {
  const img = await loadImage(url)
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  const ctx = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
  ctx.drawImage(img, 0, 0)
  const data = ctx.getImageData(0, 0, c.width, c.height)
  markClipping(data.data)
  ctx.putImageData(data, 0, 0)
  return createImageBitmap(c)
}

function clippingBitmap(url: string): Promise<ImageBitmap> {
  const w = clippingWorker()
  if (!w) return inPlace(url)
  return new Promise((resolve, reject) => {
    const id = ++nextId
    waiting.set(id, (r) => {
      if (r.bitmap) resolve(r.bitmap)
      else inPlace(url).then(resolve, reject)
    })
    w.postMessage({ id, url })
  })
}

/** Red over blown highlights, blue over crushed shadows, worked out off the main thread. */
export const ClippingOverlay = memo(function ClippingOverlay({
  url
}: {
  url: string
}): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let live = true
    void clippingBitmap(url)
      .then((bmp) => {
        const c = ref.current
        if (!live || !c) return bmp.close()
        c.width = bmp.width
        c.height = bmp.height
        const ctx = c.getContext('2d') as CanvasRenderingContext2D
        ctx.clearRect(0, 0, c.width, c.height)
        ctx.drawImage(bmp, 0, 0)
        bmp.close()
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [url])
  return <canvas ref={ref} className="overlay-canvas fill" />
})
