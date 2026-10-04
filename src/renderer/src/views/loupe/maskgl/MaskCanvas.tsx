import { useEffect, useMemo, useRef, useState } from 'react'
import { maskJoins } from '../../../../../shared/maskpreview'
import type { LocalLayer } from '../../../../../shared/recipe'
import { displayToBase, type P, type ViewGeometry } from '../../../../../shared/view'
import { planePng } from '../../../lib/planes'
import { lastSentRev, useDevelop } from '../../../state/develop'
import { useUi, type OverlayMode } from '../../../state/ui'
import { BASE_EDGE, MaskGl, type Join, type ViewMode } from './MaskGl'
import { useMaskDraft, useMaskGlBroken } from './state'
import { useAiJobs } from '../../../state/jobs'

/** The canvas is at most this many device pixels on its long edge (the tint is soft). */
const MAX_EDGE = 2048
/** How long the loupe's mask takes to give way to the engine's once they agree. */
const AGREE_MS = 180
/** How long a mask from a model takes to wipe in. */
const REVEAL_MS = 1100
/** How strongly the outline shows while a mask changes with the overlay off. */
const GHOST_ALPHA = 0.85
/** With the overlay off, how long the changing mask's outline stays, then fades (ms). */
const GHOST_HOLD_MS = 900
const GHOST_FADE_MS = 400
/** A hovered mask shows at least this strongly, overlay on or off. */
const HOVER_OPACITY = 55
/** So does the Objects tool's selection while it is made. */
const SELECT_OPACITY = 55

/** The shade's strength for a view at the overlay's opacity (0…100): glass reads stronger. */
function alphaFor(view: ViewMode, opacity: number): number {
  const a = opacity / 100
  return view === 'glass' ? Math.min(1, Math.max(0.35, a * 1.6)) : a
}

/**
 * A canvas's drawing, kept a moment after the canvas lets go of it. A WebGL
 * context given up (`dispose`) stays lost for its canvas, so a canvas
 * mounted again at once (React's StrictMode does, in development) found a
 * dead one, and the loupe fell back to the CSS overlay, which cannot show a
 * shape being drawn (an Objects selection, a lasso). Mounted again, it takes
 * this one back; let go for good, it is given up a tick later.
 */
const parked = new WeakMap<
  HTMLCanvasElement,
  { gl: MaskGl; timer: ReturnType<typeof setTimeout> }
>()

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

/** The picture for keying ranges: the mask is drawn at most this wide, so no larger. */
const PICTURE_EDGE = 1024

/** A picture decoded, straight to `width` across when given (its height follows). */
async function bitmapOf(url: string, width?: number): Promise<ImageBitmap> {
  const blob = await (await fetch(url)).blob()
  return createImageBitmap(
    blob,
    width ? { ...decodeOpts, resizeWidth: width, resizeQuality: 'medium' } : decodeOpts
  )
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
const shapeOf = (
  l: LocalLayer | undefined
): { components: LocalLayer['components'] | undefined; invert: boolean } => ({
  components: l?.components,
  invert: l?.invert ?? false
})

/**
 * The selected mask over the photo, drawn by the loupe itself from the
 * recipe (see MaskGl) and so in step with every handle, slider and lasso,
 * then handed over to the engine's plane when a render of the same recipe
 * arrives. With the overlay off, a mask that is changing shows as a faint
 * outline until the engine catches up.
 *
 * With `hover`, the mask under the pointer in the masks panel instead (or
 * none): drawn from its components alone, overlay on or off, at least
 * HOVER_OPACITY strong, the same way the selected one is.
 */
export function MaskCanvas({
  g,
  w,
  h,
  hover
}: {
  g: ViewGeometry
  w: number
  h: number
  hover?: string | null
}): React.JSX.Element | null {
  const canvas = useRef<HTMLCanvasElement>(null)
  const glRef = useRef<MaskGl | null>(null)
  const isHover = hover !== undefined
  const selectedId = useDevelop((s) => s.layerId)
  const layerId = isHover ? hover : selectedId
  // The mask's shape, by identity: its sliders moving leave these as they
  // are, so nothing here redraws on a slider's tick.
  const saved = useDevelop((s) => s.recipe?.layers.find((l) => l.id === layerId)?.components)
  // A shape still being drawn (a lasso before it closes) shows as part of the mask.
  const draftNow = useMaskDraft((s) => s.draft)
  const draft = isHover ? null : draftNow
  const components = useMemo(() => (draft && saved ? [...saved, draft] : saved), [draft, saved])
  const layerInvert = useDevelop(
    (s) => s.recipe?.layers.find((l) => l.id === layerId)?.invert ?? false
  )
  const overlayHue = useDevelop((s) => s.recipe?.layers.find((l) => l.id === layerId)?.overlayHue)
  const mask = useDevelop((s) => (!isHover && s.mask && s.mask.layerId === layerId ? s.mask : null))
  // The picture a range keys on: the settled one (a draft per tick would be
  // decoded per tick), its last one kept while drafts come and go.
  const pictureUrl = useDevelop((s) =>
    s.picture && s.picture.kind !== 'draft' ? s.picture.url : null
  )
  const overlayOn = useDevelop((s) => s.overlay)
  // The Objects tool's selection being made (what a hover, a box or a click
  // would take) shows plainly, overlay on or off: as a tint, since the glass's
  // rim alone hardly shows what is taken.
  const selecting = useDevelop((s) => !isHover && s.tool === 'objects')
  const overlay = isHover || overlayOn || selecting
  const o = useUi((s) => s.maskOverlay)
  const glass = o.mode === 'glass'
  const [bitmapTick, setBitmapTick] = useState(0)
  const [engineBmp, setEngineBmp] = useState<{ url: string; bmp: ImageBitmap } | null>(null)
  const [picture, setPicture] = useState<{ url: string; bmp: ImageBitmap } | null>(null)
  // What is held when the canvas goes, closed with it.
  const held = useRef<ImageBitmap[]>([])
  useEffect(() => {
    held.current = [engineBmp?.bmp, picture?.bmp].filter((b): b is ImageBitmap => !!b)
  }, [engineBmp, picture])
  useEffect(() => () => held.current.forEach((b) => b.close()), [])
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
  // When the mask's shape last changed: the overlay-off outline fades after it.
  const ghostFrom = useRef(0)
  const ghostFrame = useRef(0)

  // Set before the edit reaches the engine: the store calls this inside the
  // edit, and the edit is sent as the next number.
  useEffect(() => {
    if (isHover) return
    const s0 = useDevelop.getState()
    let id = s0.layerId
    let shape = shapeOf(s0.recipe?.layers.find((l) => l.id === id))
    return useDevelop.subscribe((s) => {
      const next = shapeOf(s.recipe?.layers.find((l) => l.id === s.layerId))
      if (next.components === shape.components && next.invert === shape.invert && s.layerId === id)
        return
      // A different mask selected shows the engine's plane as soon as it
      // has one for it; an edit waits for the engine to draw that edit.
      target.current = s.layerId === id ? lastSentRev() + 1 : 0
      id = s.layerId
      shape = next
      stats.target = target.current
    })
  }, [isHover])

  useEffect(() => {
    const c = canvas.current
    if (!c) return
    // Mounted again at once (StrictMode does, in development): the same one.
    const kept = parked.get(c)
    if (kept) {
      clearTimeout(kept.timer)
      parked.delete(c)
      glRef.current = kept.gl
    } else {
      try {
        glRef.current = new MaskGl(c)
      } catch {
        useMaskGlBroken.setState({ broken: true })
        return
      }
    }
    if (!isHover) current = glRef.current
    const lost = (): void => useMaskGlBroken.setState({ broken: true })
    c.addEventListener('webglcontextlost', lost)
    return () => {
      c.removeEventListener('webglcontextlost', lost)
      const gl = glRef.current
      if (current === gl) current = null
      glRef.current = null
      if (gl) parked.set(c, { gl, timer: setTimeout(() => (parked.delete(c), gl.dispose()), 0) })
    }
  }, [isHover])

  // The engine's plane for this mask, decoded. A bitmap holds its pixels
  // until closed (tens of MB, a draft a frame): each goes when replaced.
  useEffect(() => {
    if (!mask?.url) return
    let on = true
    void bitmapOf(mask.url)
      .then((bmp) => {
        if (!on) return bmp.close()
        setEngineBmp((was) => {
          if (was && was.bmp !== bmp) was.bmp.close()
          return { url: mask.url, bmp }
        })
      })
      .catch(() => undefined)
    return () => {
      on = false
    }
  }, [mask?.url])

  // The picture, for ranges and for the glass to show through.
  const hasRange = components?.some((c) => c.kind === 'range') ?? false
  const needPicture = hasRange || glass
  const isHdr = useDevelop((s) => s.session?.isHdr ?? false)
  const hdrRange = isHdr && hasRange
  useEffect(() => {
    if (!needPicture || !pictureUrl) return
    let on = true
    // Decoded straight to the size the mask is keyed at, not the render's.
    const p = useDevelop.getState().picture
    const k = p ? Math.min(1, PICTURE_EDGE / Math.max(p.width, p.height)) : 1
    const width = p && k < 1 ? Math.max(1, Math.round(p.width * k)) : undefined
    void bitmapOf(pictureUrl, width)
      .then((bmp) => {
        if (!on) return bmp.close()
        setPicture((was) => {
          if (was && was.bmp !== bmp) was.bmp.close()
          return { url: pictureUrl, bmp }
        })
      })
      .catch(() => undefined)
    return () => {
      on = false
    }
  }, [needPicture, pictureUrl])

  const dpr = window.devicePixelRatio || 1
  const k = Math.min(1, MAX_EDGE / (Math.max(w, h) * dpr))
  const cw = Math.max(1, Math.round(w * dpr * k))
  const ch = Math.max(1, Math.round(h * dpr * k))

  // The loupe's own mask, composed when its shape (or the frame) changes.
  useEffect(() => {
    const gl = glRef.current
    const c = canvas.current
    if (!gl || !c) return
    if (c.width !== cw || c.height !== ch) {
      c.width = cw
      c.height = ch
    }
    if (!components || !layerId) return
    // Painted planes: decode what is missing, and come back when it is.
    const joins: Join[] = []
    let waiting = false
    for (const { c: comp, mode } of maskJoins(components)) {
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
              if (brushBitmaps.size > 24) {
                const oldest = brushBitmaps.keys().next().value as string
                const gone = brushBitmaps.get(oldest)
                if (gone instanceof ImageBitmap) gone.close()
                brushBitmaps.delete(oldest)
              }
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
        layerInvert,
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
      lastLayer.current = layerId
    } else if (lastLayer.current !== layerId || joins.length === 0) {
      // Nothing of this mask's own yet: only the engine's plane can show.
      gl.haveAcc = false
    }
  }, [components, layerInvert, layerId, picture, g, cw, ch, bitmapTick])

  // Shown: the loupe's mask or the engine's, handed over as the engine catches up.
  useEffect(() => {
    const gl = glRef.current
    const c = canvas.current
    if (!gl || !c) return
    if (!components) {
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
    gl.setEngine(engineBmp?.url === mask?.url ? (engineBmp?.bmp ?? null) : null, mask?.url ?? '')
    gl.setPicture(picture?.bmp ?? null, picture?.url ?? '')

    // Hand over to the engine once it has drawn this recipe (or at once, when
    // the loupe has nothing to show).
    const agreed =
      !draft &&
      // An HDR photo's ranges: the engine keys its plane on the HDR working
      // values (a coverage plane needs Preserve), the picture on the tone
      // mapped ones; the loupe keys on the picture as shown, as the picture
      // does, so its own mask stays (ENGINE-REQUESTS E39).
      !hdrRange &&
      gl.haveEngine &&
      mask !== null &&
      (mask.rev ?? 0) >= target.current &&
      mask.url === engineBmp?.url
    stats.engineRev = mask?.rev ?? -1
    const goal = !gl.haveAcc ? 0 : agreed ? 0 : 1
    const tint = hslToRgb(overlayHue ?? o.hue, 0.9, 0.55)
    const draw = (): void => {
      const ghost = !overlay
      // Each component in its own colour: golden-angle steps round from the overlay's hue.
      if (!ghost && !isHover && o.byComponent && viewOf(o.mode) === 'colour') {
        const n = components.length
        const colours = Array.from({ length: Math.max(1, n) }, (_, i) =>
          hslToRgb(((overlayHue ?? o.hue) + i * 137.508) % 360, 0.9, 0.55)
        )
        if (gl.shadeComponents(colours, o.opacity / 100)) {
          stats.live = 1
          return
        }
      }
      const chosen = viewOf(o.mode)
      const view = ghost ? 'ghost' : selecting && chosen === 'glass' ? 'colour' : chosen
      const opacity = isHover
        ? Math.max(o.opacity, HOVER_OPACITY)
        : selecting
          ? Math.max(o.opacity, SELECT_OPACITY)
          : o.opacity
      const t = performance.now()
      gl.shade({
        layerInvert,
        live: live.current,
        view,
        tint,
        alpha: ghost
          ? GHOST_ALPHA *
            live.current *
            Math.min(1, Math.max(0, 1 - (t - ghostFrom.current - GHOST_HOLD_MS) / GHOST_FADE_MS))
          : view === 'outline'
            ? Math.max(0.9, opacity / 100)
            : alphaFor(view, opacity),
        reveal: revealAt.current,
        px: w > 0 ? cw / w : 1
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
  }, [
    components,
    draft,
    hdrRange,
    isHover,
    selecting,
    layerInvert,
    overlayHue,
    layerId,
    mask,
    engineBmp,
    picture,
    overlay,
    o,
    g,
    w,
    cw,
    ch,
    bitmapTick
  ])

  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  // A change to the mask's shape shows its outline with the overlay off, for
  // a moment: whether or not the engine ever answers (an edit it refuses).
  useEffect(() => {
    if (overlay || !components) return
    ghostFrom.current = performance.now()
    cancelAnimationFrame(ghostFrame.current)
    const step = (): void => {
      redraw.current?.()
      if (performance.now() - ghostFrom.current < GHOST_HOLD_MS + GHOST_FADE_MS)
        ghostFrame.current = requestAnimationFrame(step)
    }
    ghostFrame.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(ghostFrame.current)
  }, [overlay, components])

  useEffect(() => {
    if (isHover || !reveal || reveal.layerId !== layerId) return
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
  }, [reveal, layerId, isHover])

  return <canvas ref={canvas} className={`mask-canvas${isHover ? ' hover' : ''}`} />
}
