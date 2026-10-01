import { useEffect, useRef, useState } from 'react'
import { maskJoins } from '../../../../../shared/maskpreview'
import type { LocalLayer } from '../../../../../shared/recipe'
import { displayToBase, type P, type ViewGeometry } from '../../../../../shared/view'
import { planePng } from '../../../lib/planes'
import { lastSentRev, useDevelop } from '../../../state/develop'
import { useUi, type OverlayMode } from '../../../state/ui'
import { BASE_EDGE, MaskGl, type Join, type ViewMode } from './MaskGl'
import { useMaskGlBroken } from './state'
import { useAiJobs } from '../../../state/jobs'

/** The canvas is at most this many device pixels on its long edge (the tint is soft). */
const MAX_EDGE = 2048
/** How long the loupe's mask takes to give way to the engine's once they agree. */
const AGREE_MS = 180
/** How long a mask from a model takes to wipe in. */
const REVEAL_MS = 1100
/** How strongly the outline shows while a mask changes with the overlay off. */
const GHOST_ALPHA = 0.85

/** For automation: what the preview did, and its own mask to compare with the engine's. */
const stats = { composes: 0, lastComposeMs: 0, agreed: 0, target: 0, engineRev: -1, live: 0 }
let current: MaskGl | null = null
;(window as unknown as { __maskPreview: unknown }).__maskPreview = {
  stats,
  read: () => current?.readMask() ?? null
}

/** Normalised display → base as a column-major mat3 (the map is affine). */
function toBaseMat(g: ViewGeometry): Float32Array {
  const f = (p: P): P => displayToBase(g, p)
  const o = f({ x: 0, y: 0 })
  const x = f({ x: 1, y: 0 })
  const y = f({ x: 0, y: 1 })
  return new Float32Array([x.x - o.x, x.y - o.y, 0, y.x - o.x, y.y - o.y, 0, o.x, o.y, 1])
}

/** The base frame (the file upright) at the planes' size. */
function baseSize(g: ViewGeometry): { w: number; h: number } {
  const turned = ['Transpose', 'Rotate90', 'Transverse', 'Rotate270'].includes(g.user)
  const w = turned ? g.height : g.width
  const h = turned ? g.width : g.height
  const k = BASE_EDGE / Math.max(w, h)
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }
}

const decodeOpts: ImageBitmapOptions = {
  imageOrientation: 'flipY',
  premultiplyAlpha: 'none',
  colorSpaceConversion: 'none'
}

async function bitmapOf(url: string): Promise<ImageBitmap> {
  return createImageBitmap(await (await fetch(url)).blob(), decodeOpts)
}

/** Painted planes, decoded, by what the component holds (its reference or its PNG). */
const brushBitmaps = new Map<string, ImageBitmap | Promise<ImageBitmap | null>>()
function brushKey(c: { ref?: string; png: string }): string {
  return c.ref ?? `png:${c.png.length}:${c.png.slice(-64)}`
}

function viewOf(mode: OverlayMode): ViewMode {
  return mode === 'color' || mode === 'color-bw' ? 'colour' : mode
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number): number => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0), f(8), f(4)]
}

/** What decides a layer's mask (not its sliders): a change to it means the engine is behind. */
const shapeOf = (l: LocalLayer | undefined): string =>
  l ? JSON.stringify([l.components, l.invert]) : ''

/**
 * The selected mask over the photo, drawn by the loupe itself from the
 * recipe (see MaskGl) and so in step with every handle, slider and lasso,
 * then handed over to the engine's plane when a render of the same recipe
 * arrives. With the overlay off, a mask that is changing shows as a faint
 * outline until the engine catches up.
 */
export function MaskCanvas({
  g,
  w,
  h
}: {
  g: ViewGeometry
  w: number
  h: number
}): React.JSX.Element | null {
  const canvas = useRef<HTMLCanvasElement>(null)
  const glRef = useRef<MaskGl | null>(null)
  const layerId = useDevelop((s) => s.layerId)
  const layer = useDevelop((s) => s.recipe?.layers.find((l) => l.id === s.layerId))
  const mask = useDevelop((s) => (s.mask && s.mask.layerId === s.layerId ? s.mask : null))
  const pictureUrl = useDevelop((s) => s.picture?.url ?? null)
  const overlay = useDevelop((s) => s.overlay)
  const o = useUi((s) => s.maskOverlay)
  const [bitmapTick, setBitmapTick] = useState(0)
  const [engineBmp, setEngineBmp] = useState<{ url: string; bmp: ImageBitmap } | null>(null)
  const [picture, setPicture] = useState<{ url: string; bmp: ImageBitmap } | null>(null)
  // The recipe number the loupe's mask is ahead of the engine at, and how
  // far the handover has gone (1: the loupe's, 0: the engine's).
  const target = useRef(0)
  const live = useRef(1)
  const frame = useRef(0)
  const lastLayer = useRef<string | null>(null)
  // A mask a model just added is wiped in (0…1 down the photo).
  const reveal = useAiJobs((s) => s.reveal)
  const revealAt = useRef(1)
  const redraw = useRef<(() => void) | null>(null)

  // Set before the edit reaches the engine: the store calls this inside the
  // edit, and the edit is sent as the next number.
  useEffect(() => {
    const s0 = useDevelop.getState()
    let id = s0.layerId
    let shape = shapeOf(s0.recipe?.layers.find((l) => l.id === id))
    return useDevelop.subscribe((s) => {
      const next = shapeOf(s.recipe?.layers.find((l) => l.id === s.layerId))
      if (next === shape && s.layerId === id) return
      // A different mask selected shows the engine's plane as soon as it
      // has one for it; an edit waits for the engine to draw that edit.
      target.current = s.layerId === id ? lastSentRev() + 1 : 0
      id = s.layerId
      shape = next
      stats.target = target.current
    })
  }, [])

  useEffect(() => {
    const c = canvas.current
    if (!c) return
    try {
      glRef.current = new MaskGl(c)
      current = glRef.current
    } catch {
      useMaskGlBroken.setState({ broken: true })
      return
    }
    const lost = (): void => useMaskGlBroken.setState({ broken: true })
    c.addEventListener('webglcontextlost', lost)
    return () => {
      c.removeEventListener('webglcontextlost', lost)
      glRef.current?.dispose()
      if (current === glRef.current) current = null
      glRef.current = null
    }
  }, [])

  // The engine's plane for this mask, decoded.
  useEffect(() => {
    if (!mask?.url) return
    let on = true
    void bitmapOf(mask.url)
      .then((bmp) => on && setEngineBmp({ url: mask.url, bmp }))
      .catch(() => undefined)
    return () => {
      on = false
    }
  }, [mask?.url])

  // The picture, for ranges.
  const hasRange = layer?.components.some((c) => c.kind === 'range') ?? false
  useEffect(() => {
    if (!hasRange || !pictureUrl) return
    let on = true
    void bitmapOf(pictureUrl)
      .then((bmp) => on && setPicture({ url: pictureUrl, bmp }))
      .catch(() => undefined)
    return () => {
      on = false
    }
  }, [hasRange, pictureUrl])

  const dpr = window.devicePixelRatio || 1
  const k = Math.min(1, MAX_EDGE / (Math.max(w, h) * dpr))
  const cw = Math.max(1, Math.round(w * dpr * k))
  const ch = Math.max(1, Math.round(h * dpr * k))

  useEffect(() => {
    const gl = glRef.current
    const c = canvas.current
    if (!gl || !c) return
    if (c.width !== cw || c.height !== ch) {
      c.width = cw
      c.height = ch
    }
    if (!layer) {
      gl.haveAcc = false
      gl.setEngine(null, '')
      gl.shade({
        layerInvert: false,
        live: 0,
        view: 'colour',
        tint: [0, 0, 0],
        alpha: 0,
        reveal: 1
      })
      return
    }
    // Painted planes: decode what is missing, and come back when it is.
    const joins: Join[] = []
    let waiting = false
    for (const { c: comp, mode } of maskJoins(layer.components)) {
      if (comp.kind !== 'brush') {
        joins.push({ c: comp, mode })
        continue
      }
      const key = brushKey(comp)
      const got = brushBitmaps.get(key)
      if (got instanceof ImageBitmap) joins.push({ c: comp, mode, bitmap: got })
      else {
        waiting = true
        if (!got) {
          const p = planePng(comp)
            .then((b64) => {
              const bytes = Uint8Array.from(atob(b64), (x) => x.charCodeAt(0))
              return createImageBitmap(new Blob([bytes], { type: 'image/png' }), decodeOpts)
            })
            .then((bmp) => {
              brushBitmaps.set(key, bmp)
              if (brushBitmaps.size > 24)
                brushBitmaps.delete(brushBitmaps.keys().next().value as string)
              setBitmapTick((t) => t + 1)
              return bmp
            })
            .catch(() => null)
          brushBitmaps.set(key, p)
        }
      }
    }
    const base = baseSize(g)
    const t0 = performance.now()
    const composed =
      !waiting &&
      joins.length > 0 &&
      gl.compose({
        joins,
        layerInvert: layer.invert,
        toBase: toBaseMat(g),
        baseW: base.w,
        baseH: base.h,
        picture: picture?.bmp ?? null,
        pictureKey: picture?.url ?? '',
        live: 1,
        view: 'colour',
        tint: [0, 0, 0],
        alpha: 0,
        reveal: 1
      })
    if (composed) {
      stats.composes++
      stats.lastComposeMs = Math.round((performance.now() - t0) * 10) / 10
      lastLayer.current = layer.id
    } else if (lastLayer.current !== layer.id || joins.length === 0) {
      // Nothing of this mask's own yet: only the engine's plane can show.
      gl.haveAcc = false
    }
    gl.setEngine(engineBmp?.url === mask?.url ? (engineBmp?.bmp ?? null) : null, mask?.url ?? '')

    // Hand over to the engine once it has drawn this recipe (or at once, when
    // the loupe has nothing to show).
    const agreed =
      gl.haveEngine &&
      mask !== null &&
      (mask.rev ?? 0) >= target.current &&
      mask.url === engineBmp?.url
    stats.engineRev = mask?.rev ?? -1
    const goal = !gl.haveAcc ? 0 : agreed ? 0 : 1
    const tint = hslToRgb(layer.overlayHue ?? o.hue, 0.9, 0.55)
    const draw = (): void => {
      const ghost = !overlay
      gl.shade({
        layerInvert: layer.invert,
        live: live.current,
        view: ghost ? 'outline' : viewOf(o.mode),
        tint,
        alpha: ghost
          ? GHOST_ALPHA * live.current
          : o.mode === 'outline'
            ? Math.max(0.9, o.opacity / 100)
            : o.opacity / 100,
        reveal: revealAt.current
      })
      stats.live = live.current
    }
    redraw.current = draw
    cancelAnimationFrame(frame.current)
    if (goal === 1 || live.current <= goal) {
      live.current = goal
      draw()
      return
    }
    stats.agreed++
    const from = live.current
    const start = performance.now()
    const step = (): void => {
      const t = Math.min(1, (performance.now() - start) / AGREE_MS)
      live.current = from * (1 - t * t * (3 - 2 * t))
      draw()
      if (t < 1) frame.current = requestAnimationFrame(step)
    }
    frame.current = requestAnimationFrame(step)
  }, [layer, layerId, mask, engineBmp, picture, overlay, o, g, cw, ch, bitmapTick])

  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  useEffect(() => {
    if (!reveal || reveal.layerId !== layerId) return
    let raf = 0
    const step = (): void => {
      const t = Math.min(1, (performance.now() - reveal.at) / REVEAL_MS)
      revealAt.current = t < 1 ? t * t * (3 - 2 * t) : 1
      redraw.current?.()
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(raf)
      revealAt.current = 1
    }
  }, [reveal, layerId])

  return <canvas ref={canvas} className="mask-canvas" />
}
