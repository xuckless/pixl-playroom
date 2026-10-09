/**
 * The app's side of the working pixels: a photo's full-resolution frame to
 * lay steps on, and what working.ts needs (the photo's cache, its project's
 * blobs, the pixels worker).
 */
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import type { SourceInfo } from '../../shared/engine-types'
import type { PhotoRow } from '../db'
import type { EngineClient } from '../engine/client'
import { exists } from '../exists'
import type { IndexClient } from '../indexer/client'
import { keyOf } from '../keys'
import { paths } from '../paths'
import { ensureMaster, type ProxyFile } from '../proxy'
import type { RawDevelopAsk } from '../ai/rawdevelop'
import { BACKGROUND_THREADS, blankRequest, sourceOrientation, versionStamp } from '../source'
import { pixels } from '../workers/pool'
import type { PixelDeps } from './working'

const making = new Map<string, Promise<ProxyFile>>()

/**
 * The photo's own pixels at full size, upright: a RAW developed (as for a 1:1
 * view), anything else decoded and turned by its orientation. 16-bit, kept
 * per photo version.
 */
export function ensureBase(
  engine: EngineClient,
  row: PhotoRow,
  info: SourceInfo,
  /** A RAW's develop as the edit asks (PMRID). */
  ask?: RawDevelopAsk
): Promise<ProxyFile> {
  if (info.input === 'Raw') return ensureMaster(engine, row, info, ask)
  const stamp = versionStamp(row)
  const key = `${row.id}:${stamp}`
  let p = making.get(key)
  if (!p) {
    p = (async (): Promise<ProxyFile> => {
      const dir = paths.photoCache(row.id)
      const path = join(dir, `base-${stamp}.tiff`)
      const meta = `${path}.json`
      if ((await exists(path)) && (await exists(meta)))
        return JSON.parse(await readFile(meta, 'utf8')) as ProxyFile
      await mkdir(dir, { recursive: true })
      const orientation = sourceOrientation(info, null)
      const r = await engine.convert({
        ...blankRequest(row.path, path, info.input, info),
        pixel: { depth: 'Sixteen', channels: 3 },
        encode: { Tiff: { compression: 'None' } },
        metadata: { exif: false, icc: true, xmp: false, iptc: false },
        color: 'Preserve',
        framing:
          orientation === 'Normal'
            ? null
            : { orientation, rotate_degrees: 0, rotate_resampler: 'Lanczos3', crop: null },
        threads: BACKGROUND_THREADS
      })
      const out: ProxyFile = { path, input: 'Tiff', width: r.width, height: r.height }
      await writeFile(meta, JSON.stringify(out))
      return out
    })().finally(() => making.delete(key))
    making.set(key, p)
  }
  return p
}

/** What working.ts needs for a photo. */
export function pixelDeps(engine: EngineClient, index: IndexClient, row: PhotoRow): PixelDeps {
  const key = keyOf(row.id, null)
  return {
    engine,
    cacheDir: paths.photoCache(row.id),
    blobFile: (hash, ext) => index.blobFile(key, hash, ext),
    work: (job, transfer) => pixels.run(job, transfer)
  }
}
