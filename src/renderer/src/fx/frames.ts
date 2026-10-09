import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { useEfficient } from '../lib/efficient'

/**
 * Draw a demand-driven canvas at `fps` while `wanted` and the window can be
 * seen, and not at all otherwise: a slow scene needs no more, and a still
 * one draws no frames. The efficient UI (Playroom not the active app, or
 * "Always flat") holds every scene on its last frame.
 */
export function useFrameLimit(fps: number, wanted = true): void {
  const invalidate = useThree((s) => s.invalidate)
  const efficient = useEfficient()
  const running = wanted && !efficient
  useEffect(() => {
    if (!running) return
    invalidate()
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') invalidate()
    }, 1000 / fps)
    return () => clearInterval(t)
  }, [invalidate, fps, running])
}
