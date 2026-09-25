import { useEffect } from 'react'

/** Fetch the WebGL scenes' code once the app is idle, so the first use starts at once. */
export function usePrefetchFx(): void {
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500))
    const h = idle(() => {
      void import('./ProcessingSphere')
      void import('./AmbientGradient')
    })
    return () => {
      if (window.cancelIdleCallback) window.cancelIdleCallback(h as number)
    }
  }, [])
}
