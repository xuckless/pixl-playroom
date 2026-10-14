/**
 * What PIXL demosaic is told about a frame's noise when the engine cannot
 * read it from the frame itself (E64: a plane with too few flat brightness
 * levels, "state it with MosaicNoise::Stated"). Every PIXL develop that
 * reads the noise reports it, plane by plane (`variance = k·x + σ²`); this
 * keeps it by camera and ISO, so a frame of the same camera can be stated
 * the noise its siblings were measured to have. Kept beside the models
 * (`raw-noise.json`), across runs.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import log from 'electron-log/main'
import {
  noiseOfPlanes,
  statedNoiseFor as statedFrom,
  type NoiseBook,
  type NoisePlane,
  type Shot,
  type StatedNoise
} from '../../shared/rawnoise'

export type { NoisePlane, Shot, StatedNoise }

type Book = NoiseBook

/** Where the book is kept: set as the app starts (`keepNoiseIn`); nowhere, it lives in memory. */
let where: string | null = null
let book: Book | null = null
/** Counts what was kept: a frame stood in for before can be tried again once it moves. */
let kept = 0

/** How many measurements were kept this run (a frame refused for want of one is retried after). */
export function noiseKept(): number {
  return kept
}

/** Keep the book at `path` (the app's models folder's `raw-noise.json`). */
export function keepNoiseIn(path: string): void {
  where = path
  book = null
}

function load(): Book {
  if (book) return book
  if (!where) return (book = {})
  try {
    const v = JSON.parse(readFileSync(where, 'utf8')) as unknown
    book = v && typeof v === 'object' ? (v as Book) : {}
  } catch {
    book = {}
  }
  return book
}

function save(): void {
  if (!where) return
  try {
    mkdirSync(dirname(where), { recursive: true })
    writeFileSync(where, JSON.stringify(book ?? {}, null, 1))
  } catch (err) {
    log.warn('raw noise not kept', (err as Error).message)
  }
}

/** Keep what a develop measured for this camera at this ISO. */
export function remember(shot: Shot, planes: readonly NoisePlane[] | null | undefined): void {
  const n = noiseOfPlanes(planes)
  if (!n || !shot.camera || !shot.iso) return
  const b = load()
  const iso = String(Math.round(shot.iso))
  const had = b[shot.camera]?.[iso]
  if (had && had.k === n.k && had.sigma2 === n.sigma2) return
  b[shot.camera] = { ...b[shot.camera], [iso]: n }
  kept++
  save()
}

/** The noise to state for a frame the engine cannot read, from what was measured here. */
export function statedNoiseFor(shot: Shot): ReturnType<typeof statedFrom> {
  return statedFrom(shot, load())
}
