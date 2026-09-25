import { useSyncExternalStore } from 'react'

/**
 * How richly effects may run: WebGL scenes, CSS stand-ins where WebGL is
 * unavailable or has failed, or still pictures when the user asked for
 * reduced motion.
 */
export type FxMode = 'webgl' | 'css' | 'static'

const REDUCED = '(prefers-reduced-motion: reduce)'
let webgl: boolean | undefined
const listeners = new Set<() => void>()

function probeWebgl(): boolean {
  if (webgl !== undefined) return webgl
  try {
    const c = document.createElement('canvas')
    const gl = c.getContext('webgl2')
    webgl = gl !== null
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    webgl = false
  }
  return webgl
}

/**
 * Watch a scene's canvas: a context lost while the canvas is still on the
 * page is a real failure; one lost because the scene was put away (three.js
 * releases its context on unmount) is not.
 */
export function watchContext(canvas: HTMLCanvasElement): void {
  canvas.addEventListener(
    'webglcontextlost',
    () => {
      setTimeout(() => {
        if (canvas.isConnected) disableWebgl()
      }, 0)
    },
    { once: true }
  )
}

/** A scene lost its context or failed to start: use the CSS stand-ins from now on. */
export function disableWebgl(): void {
  webgl = false
  listeners.forEach((l) => l())
}

function subscribe(cb: () => void): () => void {
  const mq = window.matchMedia(REDUCED)
  mq.addEventListener('change', cb)
  listeners.add(cb)
  return () => {
    mq.removeEventListener('change', cb)
    listeners.delete(cb)
  }
}

function snapshot(): FxMode {
  if (window.matchMedia(REDUCED).matches) return 'static'
  return probeWebgl() ? 'webgl' : 'css'
}

export function useFxMode(): FxMode {
  return useSyncExternalStore(subscribe, snapshot, () => 'static' as FxMode)
}

/** Whether the window can be seen (scenes pause when it cannot). */
export function useDocumentVisible(): boolean {
  return useSyncExternalStore(
    (cb) => {
      document.addEventListener('visibilitychange', cb)
      return () => document.removeEventListener('visibilitychange', cb)
    },
    () => document.visibilityState === 'visible',
    () => true
  )
}
