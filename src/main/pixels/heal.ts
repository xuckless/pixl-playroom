/**
 * A heal, clone, fill or eye stroke baked into pixels, as Photoshop's healing
 * brush does: computed once on the photo as it is (every step before it laid
 * on, so it samples what earlier strokes healed), its changed pixels kept as a
 * small patch in the project, and a pixel step added. It has no outline and
 * no handles afterwards; History undoes it like any edit.
 *
 * The stroke is drawn over the picture the loupe shows (after lens
 * correction); a patch lives on the photo's own pixels (before it), so the
 * stroke is put there through the lens map first, and stays on its subject
 * whatever the lens correction does later. The engine's own retouch makes the
 * pixels: the stroke's region rendered with it and without it, and the patch
 * is where the two differ (times the selected mask, frozen, when one clips it).
 */
import { existsSync, readFileSync } from 'fs'
import { rm } from 'fs/promises'
import { join } from 'path'
import type { LensCorrection } from '../../shared/engine-types'
import type { PixelStep } from '../../shared/pixels'
import { newId, type Recipe } from '../../shared/recipe'
import {
  compileRetouch,
  featherOf,
  SPOT_LABEL,
  type P,
  type RetouchSpot
} from '../../shared/retouch'
import { pngSamples16 } from '../pngio'
import { inpainterRef } from '../ai/inpainter'
import { BACKGROUND_THREADS, blankRequest } from '../source'
import type { FreezeContext } from './freeze'
import { lensMap, moves } from './lensmap'
import { rampFraction } from './ops'
import type { PixelDeps } from './working'

export interface BakeContext extends FreezeContext {
  deps: PixelDeps
  recipe: Recipe
  /** The recipe's lens correction (what the stroke was drawn after). */
  lens: LensCorrection | null
  /** Freeze a mask on the photo's own pixels (freeze.ts's `freezeMask`); null when it selects nothing. */
  freeze(recipe: Recipe, layerId: string): Promise<string | null>
  /** Keep a file in the photo's project; its blob's hash. */
  store(
    file: string,
    info: { kind: string; codec: string; width: number; height: number }
  ): Promise<string>
}

/** Corrected-frame fractions to the photo's own, through the lens map (read once per map). */
const mappers = new Map<string, (p: P) => P>()

async function toSource(ctx: BakeContext): Promise<(p: P) => P> {
  if (!moves(ctx.lens)) return (p) => p
  const path = await lensMap(ctx.deps, ctx.lens!, ctx.master.width, ctx.master.height)
  let f = mappers.get(path)
  if (!f) {
    const m = pngSamples16(readFileSync(path))
    const at = (x: number, y: number, c: number): number =>
      m.data[(y * m.width + x) * 3 + c] / 65535
    f = (p) => {
      const mx = Math.min(m.width - 1, Math.max(0, p.x * m.width - 0.5))
      const my = Math.min(m.height - 1, Math.max(0, p.y * m.height - 0.5))
      const x0 = Math.floor(mx)
      const y0 = Math.floor(my)
      const x1 = Math.min(m.width - 1, x0 + 1)
      const y1 = Math.min(m.height - 1, y0 + 1)
      const fx = mx - x0
      const fy = my - y0
      const bil = (c: number): number =>
        (at(x0, y0, c) * (1 - fx) + at(x1, y0, c) * fx) * (1 - fy) +
        (at(x0, y1, c) * (1 - fx) + at(x1, y1, c) * fx) * fy
      return { x: rampFraction(bil(0), m.width), y: rampFraction(bil(1), m.height) }
    }
    if (mappers.size > 8) mappers.clear()
    mappers.set(path, f)
  }
  return f
}

/**
 * How much the lens map stretches distances about `p` (corrected-frame
 * fractions) on a `w × h` frame: a spot's size on the photo is its drawn
 * size times this.
 */
export function localScale(map: (p: P) => P, p: P, w: number, h: number): number {
  const e = 0.005
  const a = map(p)
  const bx = map({ x: p.x + e, y: p.y })
  const by = map({ x: p.x, y: p.y + e })
  const sx = Math.hypot((bx.x - a.x) * w, (bx.y - a.y) * h) / (e * w)
  const sy = Math.hypot((by.x - a.x) * w, (by.y - a.y) * h) / (e * h)
  const k = (sx + sy) / 2
  return Number.isFinite(k) && k > 0 ? k : 1
}

/** The pixels a spot can touch on a `w × h` frame: its points, its size and its feather, and a little more. */
export function spotBounds(
  s: RetouchSpot,
  w: number,
  h: number
): { x: number; y: number; width: number; height: number } {
  const short = Math.min(w, h)
  const reach = (Math.max(s.radius, s.radiusY || 0) + 3 * featherOf(s).radius) * short + 4
  const xs = s.points.map((p) => p.x * w)
  const ys = s.points.map((p) => p.y * h)
  const x = Math.max(0, Math.floor(Math.min(...xs) - reach))
  const y = Math.max(0, Math.floor(Math.min(...ys) - reach))
  const x1 = Math.min(w, Math.ceil(Math.max(...xs) + reach))
  const y1 = Math.min(h, Math.ceil(Math.max(...ys) + reach))
  return { x, y, width: Math.max(1, x1 - x), height: Math.max(1, y1 - y) }
}

/** Frozen masks, by what shapes them and the frame they were frozen on. */
const frozen = new Map<string, string>()

/**
 * Bake one stroke. `spot` is as the Heal tool makes it (base-frame fractions,
 * its source picked); `layerId` the mask that clips it, if any. The step, or
 * null when the stroke changed nothing (or fell outside the photo).
 */
export async function bakeSpot(
  ctx: BakeContext,
  spot: RetouchSpot,
  layerId: string | null
): Promise<PixelStep | null> {
  const { master, deps } = ctx
  const W = master.width
  const H = master.height
  const map = await toSource(ctx)
  // Its size too: drawn on the corrected picture, the correction stretches it
  // on the photo (the feather is a share of the size, and follows).
  const centre = {
    x: spot.points.reduce((t, p) => t + p.x, 0) / Math.max(1, spot.points.length),
    y: spot.points.reduce((t, p) => t + p.y, 0) / Math.max(1, spot.points.length)
  }
  const k = moves(ctx.lens) ? localScale(map, centre, W, H) : 1
  const onPhoto: RetouchSpot = {
    ...spot,
    points: spot.points.map(map),
    source: spot.source ? map(spot.source) : null,
    radius: spot.radius * k,
    radiusY: spot.radiusY ? spot.radiusY * k : spot.radiusY
  }
  // A Remove's model (MI-GAN): asked for only when one is baked.
  const inpainter = spot.kind === 'remove' ? await inpainterRef() : null
  if (spot.kind === 'remove' && !inpainter)
    throw new Error('download the object remover (MI-GAN) in Settings → AI models first')
  const retouch = compileRetouch([onPhoto], 'Normal', W, H, inpainter)
  if (!retouch) return null
  const region = spotBounds(onPhoto, W, H)
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const render = async (out: string, withStroke: boolean): Promise<void> => {
    await deps.engine.convert({
      ...blankRequest(master.path, out, master.input),
      pixel: { depth: 'Sixteen', channels: 3 },
      encode: { Png: { compression: 'Fast', filter: 'Sub' } },
      metadata: { exif: false, icc: true, xmp: false, iptc: false },
      color: 'Preserve',
      retouch: withStroke ? retouch : null,
      region: { ...region, margin: 16 },
      threads: BACKGROUND_THREADS
    })
  }
  const a = join(deps.cacheDir, `heal-${stamp}-with.png`)
  const b = join(deps.cacheDir, `heal-${stamp}-without.png`)
  const patchFile = join(deps.cacheDir, `heal-${stamp}-patch.png`)
  const bake = async (): Promise<PixelStep | null> => {
    await Promise.all([render(a, true), render(b, false)])
    const layer = layerId ? ctx.recipe.layers.find((l) => l.id === layerId) : undefined
    let mask: { path: string; at: { x: number; y: number } } | undefined
    if (layer) {
      // What shapes the frozen mask: its components over this frame through
      // the lens; a colour or luminance range also keys on the picture (the
      // pixels and the grade under it). Not the master's file, which every
      // stroke renames.
      const keyed = layer.components.some((c) => c.kind === 'range')
      const sig = JSON.stringify([
        W,
        H,
        layer.components,
        layer.invert,
        ctx.lens,
        keyed ? [master.path, { ...ctx.recipe, layers: [], pixels: [], retouch: [] }] : null
      ])
      let plane = frozen.get(sig)
      // Swept since (a day unused): frozen again.
      if (plane && !existsSync(plane)) plane = undefined
      if (!plane) {
        plane = (await ctx.freeze(ctx.recipe, layer.id)) ?? undefined
        if (!plane) return null
        if (frozen.size > 16) frozen.clear()
        frozen.set(sig, plane)
      }
      mask = { path: plane, at: { x: region.x, y: region.y } }
    }
    const placed = (await deps.work({
      op: 'patch',
      withStroke: a,
      without: b,
      out: patchFile,
      mask
    })) as { x: number; y: number; w: number; h: number } | null
    if (!placed) return null
    const blob = await ctx.store(patchFile, {
      kind: 'pixels',
      codec: 'png',
      width: placed.w,
      height: placed.h
    })
    const what = SPOT_LABEL[spot.kind]
    return {
      id: newId(),
      kind: 'retouch',
      label: layer ? `${what} in ${layer.name}` : what,
      blob,
      alpha: null,
      scope: layer?.name ?? null,
      opacity: 100,
      width: W,
      height: H,
      rect: { x: region.x + placed.x, y: region.y + placed.y, w: placed.w, h: placed.h },
      // The spot itself too, so a later develop can bake it again.
      params: { spot: spot.kind, geometry: JSON.stringify(spot) }
    }
  }
  // Its renders and patch are only on the way to the project: gone after.
  try {
    return await bake()
  } finally {
    for (const f of [a, b, patchFile]) await rm(f, { force: true }).catch(() => undefined)
  }
}
