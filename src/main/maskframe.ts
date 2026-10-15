/**
 * Masks drawn under another lens than the one rendered (shared/lensframe.ts),
 * carried over with the corrections' own ST maps: each made once by the
 * engine (pixels/lensmap.ts, a coordinate ramp corrected) and decoded here,
 * a few kept in memory. Every render, export, thumbnail and frozen mask
 * compiles with `maskFramesFor`; a lens edit settling rewrites the recipe
 * with `rebaseMasks`; the loupe asks for `maskGrid`.
 *
 * ENGINE-REQUESTS E85 (masks on the source frame, and `mapPoints`) would let
 * the engine place them itself: then this module goes.
 */
import { readFile } from 'fs/promises'
import { renderedLens } from '../shared/edits'
import type { Distortion, LensCorrection } from '../shared/engine-types'
import {
  frameMap,
  framesIn,
  lensFrameKey,
  lensFrameOf,
  makeGrid,
  ownLensFrame,
  placeMasks,
  planeWarp,
  sameLensFrame,
  warpPlane,
  type FrameMaps,
  type LensFrame,
  type LensGrid,
  type MaskFrames,
  type PlaneWarp,
  type StMap
} from '../shared/lensframe'
import { hash32, type Recipe } from '../shared/recipe'
import { lensMap, rampSize } from './pixels/lensmap'
import { rampFraction } from './pixels/ops'
import type { PixelDeps } from './pixels/working'
import { encodeGreyPng, grey8, pngSamples16 } from './pngio'

/** What making a map takes: the engine, the photo's cache, and the pixels worker (the ramp). */
export type FrameDeps = Pick<PixelDeps, 'engine' | 'cacheDir' | 'work'>

/** Decoded maps kept: about 6 MB each, at most a few lenses in play at once. */
const KEEP = 6
const decoded = new Map<string, Promise<StMap>>()
/** The maps decoded and ready (a draft uses only these). */
const ready = new Set<string>()
/** Planes' warps, by the pair of frames (`planeWarpFor`). */
const warps = new Map<string, PlaneWarp>()

const mapKey = (frame: Distortion, w: number, h: number): string =>
  `${lensFrameKey(frame)}|${w}x${h}`

/** A frame as the correction a map is made with: its geometry alone. */
function correctionOf(frame: Distortion): LensCorrection {
  return {
    distortion: frame,
    lateral_ca: null,
    vignetting: null,
    outside: 'Crop',
    resampler: 'Bilinear'
  }
}

/** A frame's ST map over a `w × h` photo (null: no correction, the identity). */
export async function stMap(
  deps: FrameDeps,
  frame: LensFrame,
  w: number,
  h: number
): Promise<StMap | null> {
  if (!frame) return null
  const key = mapKey(frame, w, h)
  let p = decoded.get(key)
  if (p) {
    // The newest last: the oldest goes first.
    decoded.delete(key)
    decoded.set(key, p)
    return p
  }
  p = (async () => {
    const file = await lensMap(deps, correctionOf(frame), w, h)
    const png = pngSamples16(await readFile(file))
    const ramp = rampSize(w, h)
    const n = png.width * png.height
    const sx = new Float32Array(n)
    const sy = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      sx[i] = rampFraction(png.data[i * png.channels] / 65535, ramp.w)
      sy[i] = rampFraction(png.data[i * png.channels + 1] / 65535, ramp.h)
    }
    ready.add(key)
    return { w: png.width, h: png.height, sx, sy }
  })()
  p.catch(() => {
    decoded.delete(key)
    ready.delete(key)
  })
  decoded.set(key, p)
  while (decoded.size > KEEP) {
    const oldest = decoded.keys().next().value as string
    decoded.delete(oldest)
    ready.delete(oldest)
  }
  return p
}

/** Each frame's map, by key. */
async function mapsOf(
  deps: FrameDeps,
  frames: LensFrame[],
  w: number,
  h: number
): Promise<FrameMaps> {
  const maps: FrameMaps = {}
  for (const f of frames) maps[lensFrameKey(f)] = await stMap(deps, f, w, h)
  return maps
}

/**
 * What carries `recipe`'s masks and spots to the lens it renders with, for
 * `compile`; null when they are all on it (nothing mapped, nothing made: a
 * photo with no correction that moves pixels, or masks drawn on the picture
 * as it is). `wait` false (a draft, a slider moving): only maps already
 * made are used, and without them the masks show unmapped until the
 * settled render, which makes them (a lens slider dragged is a new
 * correction every frame).
 */
export async function maskFramesFor(
  deps: FrameDeps,
  recipe: Recipe,
  isRaw: boolean,
  w: number,
  h: number,
  wait = true
): Promise<MaskFrames | null> {
  const to = lensFrameOf(renderedLens(recipe, isRaw))
  const frames = framesIn(recipe)
  if (frames.every((f) => sameLensFrame(f, to))) return null
  const all = [to, ...frames]
  if (!wait && !all.every((f) => !f || ready.has(mapKey(f, w, h)))) return null
  return { to, maps: await mapsOf(deps, all, w, h) }
}

/**
 * The recipe with its masks and spots on its own lens (a lens edit
 * settling: the distortion, a profile, a defish), as `placeMasks` rebases
 * them; `recipe` itself when they already are.
 */
export async function rebaseMasks(
  deps: FrameDeps,
  recipe: Recipe,
  w: number,
  h: number
): Promise<Recipe> {
  const to = ownLensFrame(recipe)
  const frames = framesIn(recipe)
  const maps = await mapsOf(deps, [to, ...frames], w, h)
  return placeMasks(recipe, { to, maps }, 'rebase')
}

/** The loupe's grid between the masks' frame and the frame rendered; null when they agree. */
export async function maskGrid(
  deps: FrameDeps,
  masks: LensFrame,
  rendered: LensFrame,
  w: number,
  h: number
): Promise<LensGrid | null> {
  if (sameLensFrame(masks, rendered)) return null
  const maps = await mapsOf(deps, [masks, rendered], w, h)
  return makeGrid(frameMap(maps, rendered, masks), frameMap(maps, masks, rendered))
}

/**
 * A plane drawn on frame `from` re-warped onto the frame rendered: the
 * warp, and a short name for the file it makes (main/brushes.ts). Null when
 * it is on that frame already.
 */
export function planeWarpFor(
  frames: MaskFrames,
  from: LensFrame
): { key: string; warp: PlaneWarp } | null {
  if (sameLensFrame(from, frames.to)) return null
  const key = `lf${hash32(`${lensFrameKey(from)}>${lensFrameKey(frames.to)}`).toString(16)}`
  // Each pixel of the new plane reads where it was on the old one; made
  // once per pair of frames (every render asks).
  let warp = warps.get(key)
  if (!warp) {
    warp = planeWarp(frameMap(frames.maps, frames.to, from))
    warps.set(key, warp)
    if (warps.size > KEEP * 2) warps.delete(warps.keys().next().value as string)
  }
  return { key, warp }
}

/**
 * A plane (base64 grey PNG) drawn on frame `from`, re-warped onto frame
 * `to`: what the brush paints into when a plane kept as it was across a
 * lens edit is painted again.
 */
export async function planeOnFrame(
  deps: FrameDeps,
  png: string,
  from: LensFrame,
  to: LensFrame,
  w: number,
  h: number
): Promise<string> {
  if (sameLensFrame(from, to)) return png
  const maps = await mapsOf(deps, [from, to], w, h)
  const g = grey8(Buffer.from(png, 'base64'))
  const warp = planeWarp(frameMap(maps, to, from))
  return encodeGreyPng(warpPlane(g.data, g.width, g.height, warp), g.width, g.height).toString(
    'base64'
  )
}
