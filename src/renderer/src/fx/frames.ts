import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'

/**
 * Draw a demand-driven canvas at `fps` while `running` and the window can be
 * seen, and not at all otherwise: a slow scene needs no more, and a still
 * one draws no frames.
 */
export function useFrameLimit(fps: number, running = true): void {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    if (!running) return
    invalidate()
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') invalidate()
    }, 1000 / fps)
    return () => clearInterval(t)
  }, [invalidate, fps, running])
}
