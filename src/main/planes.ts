/**
 * Drawing mask planes into files the engine reads: a gradient rasterised
 * from its geometry, a painted brush plane turned to the user's orientation.
 * Pure pixel work with no Electron, run by the pixels worker (and here, on
 * the main thread, only if the worker is gone).
 */
import { readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { threadId } from 'worker_threads'
import type { Orientation } from '../shared/engine-types'
import { rasteriseGradient } from '../shared/gradients'
import { orientPlane } from '../shared/orientation'
import { warpPlane, type PlaneWarp } from '../shared/lensframe'
import { applyEdge, type MaskEdge } from '../shared/maskedge'
import { paintStrokes } from '../shared/brush'
import type { BrushStrokeSetting, GradientComponent } from '../shared/recipe'
import { decodePng, encodeGreyPng } from './pngio'

/** Gradient planes kept per photo: dragging a gradient writes a new one per settled position. */
const KEEP_GRADIENTS = 64
/**
 * Planes are cache files the engine reads straight away: fast deflate beats
 * small files (a 512 px ramp encodes about five times faster than at 6).
 */
const PLANE_DEFLATE = 1
/** Pruning lists the whole folder: after this many writes, or this long, not on every one. */
const PRUNE_EVERY = 32
const PRUNE_MS = 10_000

/** Write whole or not at all: another thread may be writing the same plane. */
function writeAtomic(file: string, data: Buffer): void {
  const tmp = `${file}.${process.pid}-${threadId}.tmp`
  writeFileSync(tmp, data)
  renameSync(tmp, file)
}

export function writeGradientPlane(file: string, c: GradientComponent, user: Orientation): void {
  const w = Math.max(1, Math.round(c.width))
  const h = Math.max(1, Math.round(c.height))
  const turned = orientPlane(user, applyEdge(rasteriseGradient(c), w, h, c.edge), w, h)
  writeAtomic(file, encodeGreyPng(turned.data, turned.width, turned.height, PLANE_DEFLATE))
}

/** A grey plane, 8 bits, row by row. */
export interface GreyPlane {
  data: Uint8Array
  width: number
  height: number
}

/**
 * A brush's strokes to paint into its plane (shared/strokes.ts: where they
 * can't go to the engine as they are). `width × height` is the brush's
 * plane size: they are painted at BAKE_SCALE times it.
 */
export interface PaintedStrokes {
  list: BrushStrokeSetting[]
  width: number
  height: number
}

/** Strokes painted into a plane at twice a brush plane's size: 2048 px on the long edge. */
const BAKE_SCALE = 2

/**
 * A brush's plane as the engine would paint it: its PNG (if any), and its
 * strokes painted over it at BAKE_SCALE times the brush's size (the plane
 * stretched to that, bilinearly). Without strokes, the PNG as it is.
 */
export function paintedPlane(png: string, strokes?: PaintedStrokes): GreyPlane {
  const d = png ? decodePng(Buffer.from(png, 'base64')) : null
  const given = d ? { data: new Uint8Array(d.rows), width: d.width, height: d.height } : null
  if (!strokes || strokes.list.length === 0)
    return given ?? { data: new Uint8Array(1), width: 1, height: 1 }
  const w = Math.max(1, Math.round(strokes.width * BAKE_SCALE))
  const h = Math.max(1, Math.round(strokes.height * BAKE_SCALE))
  const plane = new Float32Array(w * h)
  if (given) {
    const full = { data: new Uint8Array(w * h).fill(255), width: w, height: h }
    const under = cutToObject(given, full)
    for (let i = 0; i < plane.length; i++) plane[i] = under.data[i] / 255
  }
  paintStrokes(plane, w, h, strokes.list)
  const data = new Uint8Array(w * h)
  for (let i = 0; i < data.length; i++) data[i] = Math.round(plane[i] * 255)
  return { data, width: w, height: h }
}

/**
 * A painted (or AI) plane turned to the user's orientation, its edge moved
 * and hardened; with `strokes`, painted over first (`paintedPlane`); with
 * `warp`, then re-warped from the lens it was drawn under to the one
 * rendered; with `object` (Snap to edges on a stroke), then cut to the
 * object at the object's size, so its edge is the object's.
 */
export function writeBrushPlane(
  file: string,
  png: string,
  user: Orientation,
  edge?: MaskEdge,
  object?: GreyPlane,
  warp?: PlaneWarp,
  strokes?: PaintedStrokes
): void {
  const painted = strokes && strokes.list.length > 0
  if (user === 'Normal' && !edge && !object && !warp && !painted)
    return writeAtomic(file, Buffer.from(png, 'base64'))
  let plane = paintedPlane(png, strokes)
  if (warp) plane = { ...plane, data: warpPlane(plane.data, plane.width, plane.height, warp) }
  if (object) plane = cutToObject(plane, object)
  const shaped = applyEdge(plane.data, plane.width, plane.height, edge)
  const turned = orientPlane(user, shaped, plane.width, plane.height)
  writeAtomic(file, encodeGreyPng(turned.data, turned.width, turned.height, PLANE_DEFLATE))
}

/** A stroke kept to an object: the stroke, stretched to the object's size, times the object. */
export function cutToObject(
  stroke: { data: Uint8Array; width: number; height: number },
  object: { data: Uint8Array; width: number; height: number }
): { data: Uint8Array; width: number; height: number } {
  const { width: W, height: H } = object
  const { data: s, width: w, height: h } = stroke
  const out = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    // The stroke sampled bilinearly at this pixel's centre.
    const sy = Math.min(h - 1, Math.max(0, ((y + 0.5) * h) / H - 0.5))
    const y0 = Math.floor(sy)
    const y1 = Math.min(h - 1, y0 + 1)
    const fy = sy - y0
    for (let x = 0; x < W; x++) {
      const o = object.data[y * W + x]
      if (o === 0) continue
      const sx = Math.min(w - 1, Math.max(0, ((x + 0.5) * w) / W - 0.5))
      const x0 = Math.floor(sx)
      const x1 = Math.min(w - 1, x0 + 1)
      const fx = sx - x0
      const top = s[y0 * w + x0] * (1 - fx) + s[y0 * w + x1] * fx
      const bottom = s[y1 * w + x0] * (1 - fx) + s[y1 * w + x1] * fx
      out[y * W + x] = Math.round(((top * (1 - fy) + bottom * fy) * o) / 255)
    }
  }
  return { data: out, width: W, height: H }
}

/** Per folder: writes since it was last pruned, and when that was. */
const pruned = new Map<string, { writes: number; at: number }>()

/** Whether a folder is due a prune after one more write (counting it). */
export function pruneDue(
  state: { writes: number; at: number } | undefined,
  now: number
): { due: boolean; next: { writes: number; at: number } } {
  const s = state ?? { writes: 0, at: now }
  const writes = s.writes + 1
  const due = writes >= PRUNE_EVERY || now - s.at >= PRUNE_MS
  return { due, next: due ? { writes: 0, at: now } : { writes, at: s.at } }
}

/** Prune a folder's gradient planes when it is due (see `pruneDue`). */
export function pruneGradientsSometimes(dir: string): void {
  const { due, next } = pruneDue(pruned.get(dir), Date.now())
  pruned.set(dir, next)
  if (due) pruneGradients(dir)
}

/** Keep the newest gradient planes, drop the rest. */
export function pruneGradients(dir: string): void {
  try {
    const files = readdirSync(dir)
      .filter((f) => f.startsWith('grad-') && f.endsWith('.png'))
      .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
    if (files.length <= KEEP_GRADIENTS) return
    files.sort((a, b) => b.t - a.t)
    for (const { f } of files.slice(KEEP_GRADIENTS)) unlinkSync(join(dir, f))
  } catch {
    // another process may hold one open (Windows); it goes next time
  }
}
