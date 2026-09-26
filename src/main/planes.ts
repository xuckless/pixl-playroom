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
import type { LinearComponent, RadialComponent } from '../shared/recipe'
import { decodePng, encodeGreyPng } from './pngio'

/** Gradient planes kept per photo: dragging a gradient writes a new one per settled position. */
const KEEP_GRADIENTS = 64

/** Write whole or not at all: another thread may be writing the same plane. */
function writeAtomic(file: string, data: Buffer): void {
  const tmp = `${file}.${process.pid}-${threadId}.tmp`
  writeFileSync(tmp, data)
  renameSync(tmp, file)
}

export function writeGradientPlane(
  file: string,
  c: LinearComponent | RadialComponent,
  user: Orientation
): void {
  const w = Math.max(1, Math.round(c.width))
  const h = Math.max(1, Math.round(c.height))
  const turned = orientPlane(user, rasteriseGradient(c), w, h)
  writeAtomic(file, encodeGreyPng(turned.data, turned.width, turned.height))
}

export function writeBrushPlane(file: string, png: string, user: Orientation): void {
  const buf = Buffer.from(png, 'base64')
  if (user === 'Normal') return writeAtomic(file, buf)
  const d = decodePng(buf)
  const turned = orientPlane(user, new Uint8Array(d.rows), d.width, d.height)
  writeAtomic(file, encodeGreyPng(turned.data, turned.width, turned.height))
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
