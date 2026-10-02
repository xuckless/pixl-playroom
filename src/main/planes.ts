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
import { applyEdge, type MaskEdge } from '../shared/maskedge'
import type { GradientComponent } from '../shared/recipe'
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

/**
 * A painted (or AI) plane turned to the user's orientation, its edge moved
 * and hardened; with `object` (Snap to edges on a stroke), first cut to the
 * object at the object's size, so its edge is the object's.
 */
export function writeBrushPlane(
  file: string,
  png: string,
  user: Orientation,
  edge?: MaskEdge,
  object?: { data: Uint8Array; width: number; height: number }
): void {
  const buf = Buffer.from(png, 'base64')
  if (user === 'Normal' && !edge && !object) return writeAtomic(file, buf)
  const d = decodePng(buf)
  let plane: { data: Uint8Array; width: number; height: number } = {
    data: new Uint8Array(d.rows),
    width: d.width,
    height: d.height
  }
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
