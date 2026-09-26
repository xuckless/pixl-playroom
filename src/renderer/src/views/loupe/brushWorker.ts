import type { BrushIn, BrushOut } from '../../workers/brush.worker'

/**
 * The brush worker, one for the app, started the first time the brush is
 * used. A brush layer gives it its canvas (transferred, so the worker draws
 * the stroke there itself) and then its dabs; a stroke's end comes back as
 * the plane's PNG.
 */
class BrushWorker {
  private readonly worker = new Worker(new URL('../../workers/brush.worker.ts', import.meta.url), {
    type: 'module'
  })
  private readonly waiting = new Map<number, (r: BrushOut) => void>()
  private readonly attached = new WeakSet<HTMLCanvasElement>()
  private nextId = 0

  constructor() {
    this.worker.onmessage = (e: MessageEvent<BrushOut>) => {
      this.waiting.get(e.data.id)?.(e.data)
      this.waiting.delete(e.data.id)
    }
    this.worker.onerror = (e) => {
      for (const [id, done] of this.waiting) done({ t: 'done', id, png: null, error: e.message })
      this.waiting.clear()
    }
  }

  post(m: BrushIn, transfer: Transferable[] = []): void {
    this.worker.postMessage(m, transfer)
  }

  /** A callback ref for the stroke's canvas: its drawing moves to the worker. */
  attach = (el: HTMLCanvasElement | null): void => {
    if (!el || this.attached.has(el)) return
    this.attached.add(el)
    const canvas = el.transferControlToOffscreen()
    this.post({ t: 'init', canvas }, [canvas])
  }

  /** End the stroke: the plane after it, as a grey PNG in base64 (null if nothing was painted). */
  finish(density: number): Promise<string | null> {
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      this.waiting.set(id, (r) => (r.error ? reject(new Error(r.error)) : resolve(r.png)))
      this.post({ t: 'end', id, density })
    })
  }
}

let shared: BrushWorker | null = null

export function brushWorker(): BrushWorker {
  shared ??= new BrushWorker()
  return shared
}
