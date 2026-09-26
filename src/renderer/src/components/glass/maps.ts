/**
 * Liquid glass, the way a lens bends what is behind it: a displacement map
 * that tells an SVG filter where each pixel of the backdrop should be read
 * from, and a specular map for the light caught on the rim. Both are drawn
 * once per size and shape and kept.
 *
 * The glass is a slab with a rounded-rectangle outline whose edge rises in a
 * convex "squircle" bevel. A vertical ray through the bevel refracts
 * (Snell's law, glass index ~1.5) and lands displaced towards the inside;
 * the flat middle passes light straight through. A "magnify" lens bulges
 * across its whole face instead, like the loupe of a watch crystal.
 *
 * The per-pixel work and the PNG encoding run in the glass worker; a
 * surface shows its last maps (or frost) until new ones arrive.
 */

export interface GlassShape {
  width: number
  height: number
  /** Corner radius in pixels (a circle when it is half the short side). */
  radius: number
  /** Width of the curved rim, in pixels. */
  bezel: number
  /** Scales how far the rim bends light (1 = glass). */
  strength: number
  /** A lens that magnifies its whole face, not only its rim. */
  magnify: boolean
}

export interface GlassMaps {
  displacement: string
  specular: string
  /** The feDisplacementMap scale that decodes the map's offsets. */
  scale: number
}

const IOR = 1.5

/** The bevel's height at `t` (0 at the outer edge, 1 where the flat top starts). */
function bevel(t: number): number {
  return Math.pow(1 - Math.pow(1 - t, 4), 0.25)
}

/**
 * Signed distance to a rounded rectangle centred at the origin (negative
 * inside), and the outward normal there.
 */
function sdf(
  px: number,
  py: number,
  hw: number,
  hh: number,
  r: number
): { d: number; nx: number; ny: number } {
  const qx = Math.abs(px) - (hw - r)
  const qy = Math.abs(py) - (hh - r)
  const ox = Math.max(qx, 0)
  const oy = Math.max(qy, 0)
  const outside = Math.hypot(ox, oy)
  const d = outside + Math.min(Math.max(qx, qy), 0) - r
  let nx: number
  let ny: number
  if (outside > 0) {
    nx = ox / outside
    ny = oy / outside
  } else if (qx > qy) {
    nx = 1
    ny = 0
  } else {
    nx = 0
    ny = 1
  }
  return { d, nx: nx * Math.sign(px || 1), ny: ny * Math.sign(py || 1) }
}

/** A shape's size, rounding and key: shapes with the same key share their maps. */
export function shapeKey(
  shape: GlassShape
): { key: string; w: number; h: number; r: number; bez: number } | null {
  const w = Math.max(1, Math.round(shape.width))
  const h = Math.max(1, Math.round(shape.height))
  if (w < 4 || h < 4) return null
  const r = Math.min(shape.radius, w / 2, h / 2)
  const bez = Math.max(1, Math.min(shape.bezel, w / 2, h / 2))
  return { key: `${w}x${h}:${r}:${bez}:${shape.strength}:${shape.magnify ? 1 : 0}`, w, h, r, bez }
}

export interface LensPixels {
  w: number
  h: number
  /** RGBA rows: the displacement map, then the specular map. */
  displacement: Uint8ClampedArray<ArrayBuffer>
  specular: Uint8ClampedArray<ArrayBuffer>
  scale: number
}

/** The maps' pixels: pure arithmetic, run by the glass worker. */
export function lensPixels(shape: GlassShape): LensPixels | null {
  const k = shapeKey(shape)
  if (!k) return null
  const { w, h, r, bez } = k

  // The largest offset the rim produces: a ray through the steepest part of
  // the bevel, bent by the glass, travelling the slab's thickness.
  const thickness = bez * 0.9 * shape.strength
  const lensK = shape.magnify ? 0.18 * shape.strength : 0
  const maxD = Math.max(1, thickness * 0.9 + lensK * Math.max(w, h) * 0.5)

  const dd = new Uint8ClampedArray(w * h * 4)
  const sd = new Uint8ClampedArray(w * h * 4)
  const hw = w / 2
  const hh = h / 2
  // Light from the upper left, a little in front.
  const lx = -0.62
  const ly = -0.78

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const px = x + 0.5 - hw
      const py = y + 0.5 - hh
      const { d, nx, ny } = sdf(px, py, hw, hh, r)
      let ox = 0
      let oy = 0
      let lit = 0
      const inside = -d
      if (inside >= 0 && inside < bez) {
        const t = inside / bez
        // Slope of the bevel along the inward normal, by a small difference.
        const e = 1 / bez
        const slope = (bevel(Math.min(1, t + e)) - bevel(Math.max(0, t - e))) / (2 * e) / bez
        const theta1 = Math.atan(slope * bez * 0.5)
        const theta2 = Math.asin(Math.sin(theta1) / IOR)
        const shift = thickness * bevel(t) * Math.tan(theta1 - theta2)
        // Read the backdrop from further in: the rim squeezes what is behind it.
        ox -= nx * shift
        oy -= ny * shift
        // The rim catches the light where its normal faces it.
        const facing = Math.max(0, nx * lx + ny * ly)
        const back = Math.max(0, -(nx * lx + ny * ly))
        const edge = Math.pow(1 - t, 2.2)
        lit = Math.min(1, Math.pow(facing, 3) * edge * 1.1 + Math.pow(back, 4) * edge * 0.35)
      }
      if (lensK > 0 && inside >= 0) {
        // A magnifying crystal: read from nearer the centre.
        const fall = Math.min(1, inside / Math.max(1, bez * 2))
        ox -= px * lensK * fall
        oy -= py * lensK * fall
      }
      dd[i] = Math.round(128 + (ox / maxD) * 127)
      dd[i + 1] = Math.round(128 + (oy / maxD) * 127)
      dd[i + 2] = 128
      dd[i + 3] = 255
      sd[i] = 255
      sd[i + 1] = 255
      sd[i + 2] = 255
      sd[i + 3] = Math.round(lit * 200)
    }
  }
  return { w, h, displacement: dd, specular: sd, scale: maxD * 2 }
}

// ── the maps, made in the glass worker ───────────────────────────────────────

const cache = new Map<string, GlassMaps>()
const making = new Map<string, Promise<GlassMaps | null>>()
let worker: Worker | null | undefined
let nextId = 0
const replies = new Map<number, (m: GlassMaps | null) => void>()

function glassWorker(): Worker | null {
  if (worker !== undefined) return worker
  try {
    worker = new Worker(new URL('../../workers/glass.worker.ts', import.meta.url), {
      type: 'module'
    })
    worker.onmessage = (e: MessageEvent<{ id: number; maps: GlassMaps | null }>) => {
      replies.get(e.data.id)?.(e.data.maps)
      replies.delete(e.data.id)
    }
    worker.onerror = () => {
      worker = null
      for (const [, done] of replies) done(null)
      replies.clear()
    }
  } catch {
    worker = null
  }
  return worker
}

/** Where no worker can run: the same pixels, drawn here. */
function drawHere(shape: GlassShape): GlassMaps | null {
  const px = lensPixels(shape)
  if (!px) return null
  const url = (data: Uint8ClampedArray<ArrayBuffer>): string => {
    const c = document.createElement('canvas')
    c.width = px.w
    c.height = px.h
    ;(c.getContext('2d') as CanvasRenderingContext2D).putImageData(
      new ImageData(data, px.w, px.h),
      0,
      0
    )
    return c.toDataURL('image/png')
  }
  return { displacement: url(px.displacement), specular: url(px.specular), scale: px.scale }
}

/** The maps for a shape if they are made already. */
export function cachedGlassMaps(shape: GlassShape): GlassMaps | null {
  const k = shapeKey(shape)
  return k ? (cache.get(k.key) ?? null) : null
}

/** The maps for a shape, made off the main thread once and kept. */
export function glassMaps(shape: GlassShape): Promise<GlassMaps | null> {
  const k = shapeKey(shape)
  if (!k) return Promise.resolve(null)
  const hit = cache.get(k.key)
  if (hit) return Promise.resolve(hit)
  const running = making.get(k.key)
  if (running) return running
  const w = glassWorker()
  const p = (
    w
      ? new Promise<GlassMaps | null>((resolve) => {
          const id = ++nextId
          replies.set(id, resolve)
          w.postMessage({ id, shape })
        })
      : Promise.resolve(drawHere(shape))
  ).then((maps) => {
    making.delete(k.key)
    if (maps) {
      if (cache.size > 96) cache.delete(cache.keys().next().value as string)
      cache.set(k.key, maps)
    }
    return maps
  })
  making.set(k.key, p)
  return p
}
