/**
 * The noise book filled before any develop (engine 0.21.0, E65): the first
 * RAW of each camera and ISO the library meets has its noise read by the
 * engine's `rawNoise` (the read a PIXL demosaic develop makes, to the bit,
 * developing nothing: under a second), so a later frame of that camera
 * whose noise cannot be read has its siblings' to be stated from
 * (`noisebook.ts`). One read at a time, in the background engine, after
 * the thumbnail that probed it; each camera and ISO once a run, and never
 * again once the book has it.
 */
import log from 'electron-log/main'
import type { RawNoiseReport, SourceInfo } from '../../shared/engine-types'
import type { EngineClient } from '../engine/client'
import type { PhotoRow } from '../db'
import { BACKGROUND_THREADS, DNG_OPCODES, isLinearRaw } from '../source'
import { measuredHere, remember, type NoisePlane, type Shot } from './noisebook'

/** Cameras and ISOs asked for this run (read, being read, or found unreadable). */
const asked = new Set<string>()
let queue: Promise<void> = Promise.resolve()

/** What a read says, as a develop's `noise_planes` (the planes it has a line for). */
export function planesOfRead(report: Pick<RawNoiseReport, 'planes'>): NoisePlane[] {
  return report.planes.flatMap((p) =>
    p.noise ? [{ plane: p.plane, k: p.noise.k, sigma2: p.noise.sigma2, fit: p.noise.fit }] : []
  )
}

/** Read a RAW's noise into the book when its camera and ISO are not in it yet. */
export function fillNoiseBook(
  engine: Pick<EngineClient, 'rawNoise'>,
  row: Pick<PhotoRow, 'path' | 'camera' | 'iso' | 'is_raw'>,
  info: Pick<SourceInfo, 'input' | 'dng' | 'raw_cfa'>
): Promise<void> {
  const shot: Shot = { camera: row.camera, iso: row.iso }
  if (row.is_raw !== 1 || info.input !== 'Raw' || isLinearRaw(info) || !info.raw_cfa) return queue
  if (!shot.camera || !shot.iso || measuredHere(shot)) return queue
  const key = `${shot.camera}@${Math.round(shot.iso)}`
  if (asked.has(key)) return queue
  asked.add(key)
  queue = queue.then(async () => {
    try {
      const read = await engine.rawNoise({
        source: { Path: row.path },
        // The area and opcodes the master's Scene develop reads (`rawMaster`).
        crop: 'Best',
        dng_opcodes: DNG_OPCODES,
        noise: 'MeasuredGreenFloor',
        threads: BACKGROUND_THREADS,
        limits: null
      })
      remember(shot, planesOfRead(read))
      log.info('raw noise read for the book', key, read.noise_from, `${read.read_ms} ms`)
    } catch (err) {
      // An engine without it, or a frame it cannot read: the develops fill the book instead.
      log.info('raw noise not read', key, (err as Error).message)
    }
  })
  return queue
}
