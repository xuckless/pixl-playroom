import { useEffect, useState } from 'react'

/** An element's size, observed; `ref` is a callback ref so the element may come and go. */
export function useSize(): [
  (el: HTMLDivElement | null) => void,
  { w: number; h: number },
  HTMLDivElement | null
] {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    if (!el) return
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth
      const h = el.clientHeight
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }))
    })
    // The observer reports the first size itself, as soon as it observes.
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return [setEl, size, el]
}
