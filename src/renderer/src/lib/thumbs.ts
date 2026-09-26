import { useEffect, type RefObject } from 'react'
import { api } from './api'

/**
 * Thumbnails are made in folder order; the ones on screen are asked for
 * first. Tiles still waiting for a thumbnail are watched as they scroll into
 * view, and their keys go to the front of the queue in small batches.
 */
const BATCH_MS = 150

const keyOf = new WeakMap<Element, string>()
const seen = new Set<string>()
let timer: ReturnType<typeof setTimeout> | undefined
let io: IntersectionObserver | undefined

function flush(): void {
  timer = undefined
  const keys = [...seen]
  seen.clear()
  if (keys.length) void api.library.prioritize(keys).catch(() => undefined)
}

function observer(): IntersectionObserver {
  io ??= new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const k = e.isIntersecting ? keyOf.get(e.target) : undefined
        if (k) seen.add(k)
      }
      if (seen.size && !timer) timer = setTimeout(flush, BATCH_MS)
    },
    { rootMargin: '200px' }
  )
  return io
}

/** Ask for this tile's thumbnail first while it is on screen and `waiting`. */
export function useThumbFirst(ref: RefObject<Element | null>, key: string, waiting: boolean): void {
  useEffect(() => {
    const el = ref.current
    if (!el || !waiting) return
    keyOf.set(el, key)
    const o = observer()
    o.observe(el)
    return () => o.unobserve(el)
  }, [ref, key, waiting])
}
