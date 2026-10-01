/**
 * The original, carried inside its project, so the project needs nothing
 * outside itself: the photo can move, or go, and the project still develops,
 * exports and keeps its history.
 *
 * Each format is kept as compactly as it can be without losing a bit of it:
 * - A camera RAW becomes a DNG with lossless JPEG-92 pixels (what Adobe's
 *   converter makes). A DNG stays as it is.
 * - A JPEG is repacked into JPEG XL, about a fifth smaller, from which the
 *   very same JPEG comes back byte for byte (checked before it is kept). One
 *   carrying a gain map stays as it is.
 * - A PNG or TIFF of 5 MB or more becomes lossless JPEG XL (less is not worth
 *   it).
 * - HEIC, AVIF, WebP and JPEG XL are already compact and stay as they are.
 *
 * Whatever comes out larger than the original, or fails its check, is kept
 * verbatim instead. Main does the work (it has the engine), on the
 * background engine, one photo at a time; the index stores the result in
 * the project. The setting `projects.embedOriginal` (on unless set to false)
 * turns it off.
 */
import log from 'electron-log/main'
import { existsSync, statSync } from 'fs'
import { rm } from 'fs/promises'
import { join } from 'path'
import { PRESERVE_ALL, type ConvertRequest } from '../../shared/engine-types'
import type { EngineClient } from '../engine/client'
import type { IndexClient } from '../indexer/client'
import type { Library } from '../library'
import { paths } from '../paths'
import { BACKGROUND_THREADS, blankRequest } from '../source'
import { MB, planFor, sameShape, verbatim, type Plan } from './embedplan'
import { PIXL_EXT, sha256File } from './pixlfile'

export class OriginalEmbedder {
  private readonly queue: string[] = []
  private running = false
  private readonly index: IndexClient
  private readonly library: Library
  private readonly engine: EngineClient

  constructor(index: IndexClient, library: Library, engine: EngineClient) {
    this.index = index
    this.library = library
    this.engine = engine
  }

  /** Embed the original of a photo's project, if it has one and not its original yet. */
  request(key: string): void {
    if (this.queue.includes(key)) return
    this.queue.push(key)
    if (!this.running) void this.drain()
  }

  private async drain(): Promise<void> {
    this.running = true
    try {
      for (let key = this.queue.shift(); key; key = this.queue.shift()) {
        try {
          await this.embed(key)
        } catch (err) {
          log.warn('embedding the original failed', key, err)
        }
      }
    } finally {
      this.running = false
    }
  }

  private async embed(key: string): Promise<void> {
    if ((await this.index.getSetting('projects.embedOriginal')) === false) return
    const state = await this.index.originalState(key)
    if (!state.project || state.state === 'ready' || state.state === 'failed') return
    const row = await this.index.row(key)
    // Only from the file itself: a project standing in for a lost photo has nothing to add.
    if (row.path.toLowerCase().endsWith(PIXL_EXT) || !existsSync(row.path)) return
    const size = statSync(row.path).size
    const info = await this.library.probe(row)
    const plan = planFor(row.ext, size, info)
    const dir = paths.photoCache(row.id)
    const out = join(dir, `embed-${Date.now()}.${plan.ext}`)
    const check = join(dir, `embed-check-${Date.now()}.jpg`)
    let made: { file: string; plan: Plan; note: string | null } = {
      file: row.path,
      plan: verbatim(row.ext.toLowerCase()),
      note: plan.why ?? null
    }
    try {
      if (plan.encode) {
        const req: ConvertRequest = {
          ...blankRequest(row.path, out, info.input, info),
          encode: plan.encode,
          metadata: plan.metadata,
          threads: BACKGROUND_THREADS
        }
        await this.engine.convert(req)
        const smaller = statSync(out).size < size
        let problem = smaller ? null : 'it came out no smaller'
        if (!problem && plan.kind === 'jxl-jpeg') {
          // The JPEG must come back byte for byte.
          await this.engine.convert({
            ...blankRequest(out, check, 'Jxl'),
            encode: 'JpegFromJxl',
            metadata: PRESERVE_ALL,
            threads: BACKGROUND_THREADS
          })
          if (sha256File(check) !== sha256File(row.path))
            problem = 'the JPEG did not come back bit for bit'
        } else if (!problem) {
          problem = sameShape(plan.kind, info, await this.engine.probe(out))
        }
        if (problem) made.note = `kept as it is: ${problem}`
        else made = { file: out, plan, note: null }
      }
      const shape = made.plan.kind === 'verbatim' ? info : await this.engine.probe(made.file)
      await this.index.putOriginal(key, made.file, made.plan.kind, {
        codec: made.plan.codec,
        width: shape.width,
        height: shape.height,
        note: made.note
      })
      log.info(
        `embedded ${row.name} in its project: ${made.plan.kind}`,
        `${(statSync(made.file).size / MB).toFixed(1)} MB of ${(size / MB).toFixed(1)} MB`,
        made.note ?? ''
      )
    } catch (err) {
      // Whatever the conversion made of it, the original's own bytes always do.
      const why = err instanceof Error ? err.message : String(err)
      try {
        await this.index.putOriginal(key, row.path, 'verbatim', {
          codec: row.ext.toLowerCase(),
          width: info.width,
          height: info.height,
          note: `kept as it is: ${why}`
        })
      } catch (again) {
        await this.index.originalFailed(key, why).catch(() => undefined)
        throw again
      }
    } finally {
      await rm(out, { force: true })
      await rm(check, { force: true })
    }
  }
}
