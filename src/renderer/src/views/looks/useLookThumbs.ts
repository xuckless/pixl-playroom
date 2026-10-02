/**
 * The Looks browser's thumbnails: the cards on screen (and a little beyond)
 * are asked of the main process in the order they are shown, again whenever
 * the photo's recipe changes; what comes back is kept per photo, so the
 * browser opened again shows them at once. A card is the photo as clicking
 * the look would leave it: with a look applied, that look swapped for it.
 */
import { useCallback, useEffect, useRef } from 'react'
import { create } from 'zustand'
import type { LookThumbEvent } from '../../../../shared/ipc'
import { api } from '../../lib/api'
import { lookBase } from '../../lib/applyLook'
import { useDevelop } from '../../state/develop'

interface ThumbsState {
  /** The photo the thumbnails are of. */
  key: string | null
  byId: Record<string, LookThumbEvent>
}

export const useThumbs = create<ThumbsState>(() => ({ key: null, byId: {} }))

let listening = false
function listen(): void {
  if (listening) return
  listening = true
  api.looks.onThumb((e) => {
    const s = useThumbs.getState()
    if (e.key !== s.key) return
    useThumbs.setState({ byId: { ...s.byId, [e.id]: e } })
  })
}

/** Counts asks across the app's life: main drops one that arrives after a newer. */
let token = 0
/** How long the cards on screen must hold still before they are asked for. */
const ASK_MS = 90

/**
 * Watch cards scrolled into `root`; ask for theirs. `order` is every id in
 * the order shown. Returns the ref each card puts on its element.
 */
export function useLookThumbs(
  root: React.RefObject<HTMLElement | null>,
  order: string[],
  edge: number
): (id: string) => (el: HTMLElement | null) => void {
  const key = useDevelop((s) => s.session?.key ?? null)
  const recipe = useDevelop((s) => s.recipe)
  const visible = useRef(new Set<string>())
  const els = useRef(new Map<string, HTMLElement>())
  const observer = useRef<IntersectionObserver | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const orderRef = useRef(order)

  const ask = useCallback((): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const d = useDevelop.getState()
      // Each card shows what clicking it gives: the applied look swapped for it.
      const base = lookBase()
      if (!d.session || !base) return
      const ids = orderRef.current.filter((id) => visible.current.has(id))
      if (ids.length === 0) return
      void api.looks
        .thumbs({ key: d.session.key, token: ++token, base, ids, edge })
        .catch(() => undefined)
    }, ASK_MS)
  }, [edge])

  // A new photo starts an empty set.
  useEffect(() => {
    listen()
    if (useThumbs.getState().key !== key) useThumbs.setState({ key, byId: {} })
  }, [key])

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.look
          if (!id) continue
          if (e.isIntersecting) visible.current.add(id)
          else visible.current.delete(id)
        }
        ask()
      },
      // A row or two beyond the edge, so a scroll finds them made.
      { root: root.current, rootMargin: '320px 0px' }
    )
    observer.current = io
    for (const el of els.current.values()) io.observe(el)
    return () => {
      io.disconnect()
      observer.current = null
    }
  }, [root, ask])

  // The photo changed (a look applied, a slider), or the cards did: those on screen again.
  useEffect(() => {
    orderRef.current = order
    ask()
  }, [recipe, order, ask])

  // Closed: main stops making cards nobody will see.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      const k = useDevelop.getState().session?.key
      if (k) void api.looks.cancel(k).catch(() => undefined)
    },
    []
  )

  // One ref per card for the browser's life: a new one each render would
  // unobserve and observe the card again, and ask again, every time.
  const refs = useRef(new Map<string, (el: HTMLElement | null) => void>())
  return useCallback((id: string) => {
    let ref = refs.current.get(id)
    if (!ref) {
      ref = (el) => {
        const old = els.current.get(id)
        if (old && old !== el) {
          observer.current?.unobserve(old)
          els.current.delete(id)
          visible.current.delete(id)
        }
        if (el) {
          el.dataset.look = id
          els.current.set(id, el)
          observer.current?.observe(el)
        }
      }
      refs.current.set(id, ref)
    }
    return ref
  }, [])
}
