/**
 * The library: a folder of photos, as they are on disk, with no import step.
 * Files stay where they are; each photo's edits, rating, flag, label and
 * virtual copies live in its sidecar, and the index mirrors them for speed.
 * Both are the index host's (indexer/): this side asks it, probes files and
 * keeps the thumbnail queue, which needs the engine.
 *
 * Thumbnails are rendered in the background engine: a RAW's embedded preview
 * until it has been edited, the photo's own pixels otherwise, and the graded
 * picture (from its proxy) once it has a recipe.
 */
import { BrowserWindow } from 'electron'
import log from 'electron-log/main'
import { existsSync } from 'fs'
import { join } from 'path'
import { compile } from '../shared/compile'
import { dhashFromGrey } from '../shared/dupes'
import type { SourceInfo } from '../shared/engine-types'
import { IPC, type LibraryItem, type LibrarySource, type SourceListing } from '../shared/ipc'
import { orientedFrame } from '../shared/compile'
import { hash32, type Recipe } from '../shared/recipe'
import type { EngineClient } from './engine/client'
import type { PhotoRow } from './db'
import type { IndexClient } from './indexer/client'
import { brushPlanes } from './brushes'
import { keyOf } from './keys'
import { paths } from './paths'
import { denoiseKey, denoiseRefusal, findDenoised } from './ai/denoise'
import { ensureProxies } from './proxy'
import { pngToFloats } from './pngio'
import { cacheUrl } from './protocol'
import { BACKGROUND_THREADS, blankRequest, displayPolicy, sourceOrientation } from './source'

export { keyOf, parseKey } from './keys'

export const THUMB_EDGE = 400

/** A file's version: its path, size and modification time. */
const versionOf = (row: PhotoRow): string => `${row.path}:${row.mtime}:${row.size}`

interface ThumbJob {
  photoId: number
  copyId: string | null
}

export class Library {
  private probes = new Map<string, SourceInfo>()
  private queue: ThumbJob[] = []
  private queued = new Set<string>()
  private running = 0

  constructor(
    readonly index: IndexClient,
    private readonly engine: EngineClient
  ) {
    index.on((e) => {
      if (e.name === 'changed') this.broadcast(IPC.library.changed, { folder: e.folder })
      else if (e.name === 'sources') this.broadcast(IPC.library.sourcesChanged, null)
    })
  }

  private broadcast(channel: string, payload: unknown): void {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
  }

  /** A photo's probe, cached per file version. */
  async probe(photo: PhotoRow): Promise<SourceInfo> {
    const k = versionOf(photo)
    const hit = this.probes.get(k)
    if (hit) return hit
    const info = await this.engine.probe(photo.path)
    this.probes.set(k, info)
    return info
  }

  /** A folder's items as the index has them; its thumbnails are queued. */
  async openFolder(folder: string): Promise<LibraryItem[]> {
    const items = await this.index.listFolder(folder)
    for (const it of items) this.queueThumb(it.photoId, it.copyId)
    return items
  }

  /**
   * Any source's items (a collection's come from many folders); thumbnails
   * are queued for those that are there. Thumbnails belong to photos, not
   * folders, so one rendered for a folder serves every collection too.
   */
  async openSource(src: LibrarySource): Promise<SourceListing> {
    const listing =
      src.kind === 'duplicates'
        ? await this.duplicates(src.folder, src.threshold)
        : await this.index.listSource(src)
    for (const it of listing.items) if (!it.offline) this.queueThumb(it.photoId, it.copyId)
    return listing
  }

  /**
   * Exact and near duplicates in a folder or the whole library. Near ones
   * need each photo's picture hash, made here from its thumbnail (rendered
   * first where there is none) since this side has the engine.
   */
  async duplicates(folder: string | null, threshold = 6): Promise<SourceListing> {
    const work = await this.index.dhashWork(folder)
    let next = 0
    const worker = async (): Promise<void> => {
      while (next < work.length) {
        const w = work[next++]
        try {
          await this.hashPicture(w.photoId, w.thumbPath)
        } catch (err) {
          const message = (err as Error)?.message ?? String(err)
          log.warn('picture hash failed', w.photoId, message)
          void this.index.markFailed(w.photoId, message).catch(() => {})
        }
      }
    }
    // Two at a time, as the thumbnail queue runs.
    await Promise.all([worker(), worker()])
    return this.index.duplicates(folder, threshold)
  }

  /** A photo's 64-bit dHash, of its thumbnail shrunk to 9×8 by the engine. */
  private async hashPicture(photoId: number, thumbPath: string | null): Promise<void> {
    if (!thumbPath) await this.thumb({ photoId, copyId: null })
    const row = await this.index.row(keyOf(photoId, null))
    if (!row.thumb_path || !row.thumb_key || !existsSync(row.thumb_path)) return
    const report = await this.engine.convert({
      ...blankRequest(row.thumb_path, '', 'Jpeg'),
      sink: 'Bytes',
      resize: { Exact: { width: 9, height: 8 } },
      resampler: 'Bilinear',
      pixel: { depth: 'Eight', channels: 3 },
      encode: { Png: { compression: 'Fast', filter: 'NoFilter' } },
      threads: 1
    })
    if (!report.output) throw new Error('the engine returned no pixels')
    const px = pngToFloats(Buffer.from(report.output))
    const grey = new Uint8Array(px.width * px.height)
    for (let i = 0; i < grey.length; i++) {
      const o = i * px.channels
      const y =
        px.channels >= 3
          ? 0.299 * px.data[o] + 0.587 * px.data[o + 1] + 0.114 * px.data[o + 2]
          : px.data[o]
      grey[i] = Math.round(y * 255)
    }
    await this.index.setDhash(row.id, dhashFromGrey(grey, px.width, px.height), row.thumb_key)
  }

  item(key: string): Promise<LibraryItem | undefined> {
    return this.index.item(key)
  }

  photoRow(key: string): Promise<PhotoRow> {
    return this.index.row(key)
  }

  recipe(key: string): Promise<Recipe> {
    return this.index.recipe(key)
  }

  saveRecipe(key: string, recipe: Recipe): Promise<void> {
    return this.index.saveRecipe(key, recipe)
  }

  // ── thumbnails ──

  queueThumb(photoId: number, copyId: string | null, urgent = false): void {
    const k = keyOf(photoId, copyId)
    if (this.queued.has(k)) return
    this.queued.add(k)
    if (urgent) this.queue.unshift({ photoId, copyId })
    else this.queue.push({ photoId, copyId })
    this.pump()
  }

  /** Move these keys' waiting thumbnails to the front of the queue. */
  prioritize(keys: string[]): void {
    const want = new Set(keys)
    const first = this.queue.filter((j) => want.has(keyOf(j.photoId, j.copyId)))
    if (first.length === 0) return
    this.queue = [...first, ...this.queue.filter((j) => !want.has(keyOf(j.photoId, j.copyId)))]
  }

  private pump(): void {
    while (this.running < 2 && this.queue.length > 0) {
      const job = this.queue.shift() as ThumbJob
      this.running++
      this.thumb(job)
        .catch((err) => {
          log.warn('thumbnail failed', job, err?.message ?? err)
          // Once per version of the file: a photo that cannot be read is not
          // tried again until it changes.
          void this.index.markFailed(job.photoId, String(err?.message ?? err)).catch(() => {})
          this.broadcast(IPC.library.thumb, {
            key: keyOf(job.photoId, job.copyId),
            url: null,
            unreadable: true
          })
        })
        .finally(() => {
          this.running--
          this.queued.delete(keyOf(job.photoId, job.copyId))
          this.pump()
        })
    }
  }

  private async thumb(job: ThumbJob): Promise<void> {
    const work = await this.index.thumbJob(job.photoId, job.copyId)
    if (!work) return
    const { row, recipe, edited, stamp } = work
    const key = keyOf(row.id, job.copyId)
    const raw = row.is_raw === 1

    const info = await this.probe(row)
    const out = join(
      paths.thumbs(),
      `${row.id}${job.copyId ? '-' + job.copyId : ''}-${hash32(stamp).toString(16)}.jpg`
    )
    const base = {
      encode: { Jpeg: { quality: 85, subsampling: 'Quarter' as const, optimize: true } },
      pixel: { depth: 'Eight' as const, channels: 3 },
      metadata: { exif: false, icc: true, xmp: false, iptc: false },
      threads: BACKGROUND_THREADS,
      color: displayPolicy(info, 'Srgb')
    }
    if (!edited) {
      // The quickest honest picture: a RAW's embedded preview, anything else
      // its own pixels, upright and small.
      const rawMode = raw ? ('EmbeddedPreview' as const) : null
      const orientation = sourceOrientation(info, rawMode)
      const long = Math.max(info.width, info.height)
      const factor = Math.min(1, THUMB_EDGE / long)
      try {
        await this.engine.convert({
          ...blankRequest(row.path, out, info.input, info),
          ...base,
          raw: rawMode,
          resize: factor < 1 ? { Scale: { factor } } : 'None',
          framing:
            orientation === 'Normal'
              ? null
              : { orientation, rotate_degrees: 0, rotate_resampler: 'Lanczos3', crop: null }
        })
      } catch (err) {
        if (!raw) throw err
        // Some RAWs have no usable embedded preview: develop instead.
        await this.graded(row, info, recipe, out, base)
      }
    } else {
      await this.graded(row, info, recipe, out, base)
    }
    await this.index.setThumb(row.id, job.copyId, out, stamp)
    this.broadcast(IPC.library.thumb, { key, url: cacheUrl(out, stamp) })
  }

  /**
   * A thumbnail of the graded picture, from the photo's draft proxy — a
   * quarter of the proxy's pixels, and still more than a thumbnail needs —
   * or the proxy when a tight crop leaves the draft too few.
   */
  private async graded(
    row: PhotoRow,
    info: SourceInfo,
    recipe: Recipe,
    out: string,
    base: Record<string, unknown>
  ): Promise<void> {
    // AI denoise: its proxies when it has been made (the develop view or an
    // export makes it; a thumbnail never waits on a model).
    const ai = recipe.detail.ai
    const aiOn = ai.enabled && !denoiseRefusal(info)
    const denoised = aiOn ? await findDenoised(row, denoiseKey(row, ai)) : null
    const px = denoised?.px ?? (await ensureProxies(this.engine, row, info))
    const { user, width, height } = orientedFrame(recipe, px.frameWidth, px.frameHeight)
    const cropOf = compile(recipe, {
      isRaw: row.is_raw === 1,
      asShot: info.as_shot_white,
      sourceOrientation: 'Normal',
      frameWidth: px.frameWidth,
      frameHeight: px.frameHeight,
      scale: 1,
      seed: 0,
      brushPaths: {},
      applyCrop: true
    }).crop
    const cropLong = Math.max((cropOf?.width ?? 1) * width, (cropOf?.height ?? 1) * height)
    const src = cropLong * (px.draft.width / px.frameWidth) >= THUMB_EDGE ? px.draft : px.proxy
    const compiled = compile(recipe, {
      isRaw: row.is_raw === 1,
      asShot: info.as_shot_white,
      sourceOrientation: 'Normal',
      frameWidth: px.frameWidth,
      frameHeight: px.frameHeight,
      scale: src.width / px.frameWidth,
      seed: hash32(row.path),
      brushPaths: await brushPlanes(row.id, recipe, user),
      applyCrop: true,
      aiDenoised: aiOn,
      hdr: info.is_hdr
    })
    const cropW = (compiled.crop?.width ?? 1) * width
    const cropH = (compiled.crop?.height ?? 1) * height
    const factor = Math.min(1, THUMB_EDGE / (Math.max(cropW, cropH) * (src.width / px.frameWidth)))
    await this.engine.convert({
      ...blankRequest(src.path, out, src.input),
      ...base,
      resize: factor < 1 ? { Scale: { factor } } : 'None',
      grade: compiled.grade,
      framing: compiled.framing,
      lens: compiled.lens,
      retouch: compiled.retouch
    })
  }
}
