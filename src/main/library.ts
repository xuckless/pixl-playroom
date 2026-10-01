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
import { app, BrowserWindow } from 'electron'
import log from 'electron-log/main'
import { existsSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { compile } from '../shared/compile'
import { dhashFromGrey } from '../shared/dupes'
import { PRESERVE_ALL, type SourceInfo } from '../shared/engine-types'
import {
  IPC,
  type HdrKind,
  type LibraryItem,
  type LibrarySource,
  type SourceListing
} from '../shared/ipc'
import { orientedFrame } from '../shared/compile'
import { hash32, type Recipe } from '../shared/recipe'
import type { EngineClient } from './engine/client'
import type { PhotoRow } from './db'
import type { IndexClient } from './indexer/client'
import type { PlaneStore } from './planestore'
import { brushPlanes } from './brushes'
import { keyOf } from './keys'
import { paths } from './paths'
import { pixelDeps } from './pixels/base'
import { ensureWorking } from './pixels/working'
import { editsHdr, ensureHdrSource } from './hdrsource'
import { ensureProxies } from './proxy'
import { pngToFloats } from './pngio'
import { cacheUrl } from './protocol'
import {
  BACKGROUND_THREADS,
  blankRequest,
  displayPolicy,
  seedOf,
  sourceOrientation,
  versionStamp
} from './source'

export { keyOf, parseKey } from './keys'

export const THUMB_EDGE = 400

/** A file's version: its path, size and modification time. */
const versionOf = (row: PhotoRow): string => `${row.path}:${row.mtime}:${row.size}`

/** What kind of HDR a probe says a file is, or '' for none. */
export function hdrKindOf(info: SourceInfo): HdrKind | '' {
  if (info.gain_map) return 'gainmap'
  if (!info.is_hdr) return ''
  return /HLG/i.test(info.color) ? 'hlg' : 'pq'
}

interface ThumbJob {
  photoId: number
  copyId: string | null
}

export class Library {
  private probes = new Map<string, SourceInfo>()
  private probing = new Map<string, Promise<SourceInfo>>()
  /** JPEGs being rebuilt from a project's JPEG XL repack, by where they go. */
  private rebuilding = new Map<string, Promise<void>>()
  private queue: ThumbJob[] = []
  /** Keys waiting in the queue. */
  private queued = new Set<string>()
  /** Keys rendering now, and those changed since theirs began (rendered again after). */
  private rendering = new Set<string>()
  private stale = new Set<string>()
  /** Who waits for a key's thumbnail: told when a render of it ends. */
  private waiting = new Map<string, (() => void)[]>()
  private running = 0
  /** The duplicate search hashing pictures now, if any. */
  private dupes: AbortController | null = null

  constructor(
    readonly index: IndexClient,
    private readonly engine: EngineClient,
    /** Painted planes: the index hands recipes out and takes them in by reference. */
    readonly planes: PlaneStore
  ) {
    index.on((e) => {
      if (e.name === 'changed') this.broadcast(IPC.library.changed, { folder: e.folder })
      else if (e.name === 'sources') this.broadcast(IPC.library.sourcesChanged, null)
    })
  }

  private broadcast(channel: string, payload: unknown): void {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
  }

  /**
   * A photo's probe, cached per file version: in memory, and on disk beside
   * its proxies so a photo opened again (another day) does not ask the
   * engine. `engine`: the one to ask when it must (opening a photo asks the
   * interactive one, not the background one busy with thumbnails).
   */
  async probe(photo: PhotoRow, engine: EngineClient = this.engine): Promise<SourceInfo> {
    const k = versionOf(photo)
    const hit = this.probes.get(k)
    if (hit) return hit
    let p = this.probing.get(k)
    if (!p) {
      p = this.probeOnce(photo, k, engine).finally(() => this.probing.delete(k))
      this.probing.set(k, p)
    }
    return p
  }

  private async probeOnce(photo: PhotoRow, k: string, engine: EngineClient): Promise<SourceInfo> {
    // Per app version too: the engine ships with it, and a newer one may say more.
    const file = join(
      paths.photoCache(photo.id),
      `probe-${hash32(`${k}:${app.getVersion()}`).toString(16)}.json`
    )
    let info: SourceInfo | null = null
    try {
      info = JSON.parse(await readFile(file, 'utf8')) as SourceInfo
    } catch {
      info = await engine.probe(photo.path)
      await mkdir(paths.photoCache(photo.id), { recursive: true })
      await writeFile(file, JSON.stringify(info)).catch(() => undefined)
    }
    this.probes.set(k, info)
    // The grid's HDR badge learns what the file is.
    const kind = hdrKindOf(info)
    if (photo.hdr_key !== versionOf(photo) || (photo.hdr ?? '') !== kind) {
      void this.index.setHdr(photo.id, kind).catch(() => undefined)
      this.broadcast(IPC.library.hdr, { photoId: photo.id, hdr: kind || null })
    }
    return info
  }

  /** Photos whose HDR kind is not known yet, probed one by one in the background. */
  private hdrWork: string[] = []
  private hdrSeen = new Set<string>()
  private hdrRunning = false

  private queueHdr(items: LibraryItem[]): void {
    for (const it of items) {
      if (it.hdr !== undefined || it.offline || it.unreadable || it.copyId) continue
      if (this.hdrSeen.has(it.key)) continue
      this.hdrSeen.add(it.key)
      this.hdrWork.push(it.key)
    }
    if (this.hdrRunning) return
    this.hdrRunning = true
    void (async () => {
      while (this.hdrWork.length) {
        const key = this.hdrWork.shift()!
        try {
          await this.probe(await this.photoRow(key))
        } catch {
          // unreadable: the thumbnail says so
        }
      }
      this.hdrRunning = false
    })()
  }

  /** A folder's items as the index has them; its thumbnails are queued. */
  async openFolder(folder: string): Promise<LibraryItem[]> {
    const items = await this.index.listFolder(folder)
    for (const it of items) this.queueThumb(it.photoId, it.copyId)
    this.queueHdr(items)
    return items
  }

  /**
   * Any source's items (a collection's come from many folders); thumbnails
   * are queued for those that are there. Thumbnails belong to photos, not
   * folders, so one rendered for a folder serves every collection too.
   */
  async openSource(src: LibrarySource): Promise<SourceListing> {
    // Another source opened: a duplicate search still hashing is not wanted now.
    if (src.kind !== 'duplicates') this.dupes?.abort()
    const listing =
      src.kind === 'duplicates'
        ? await this.duplicates(src.folder, src.threshold)
        : await this.index.listSource(src)
    for (const it of listing.items) if (!it.offline) this.queueThumb(it.photoId, it.copyId)
    this.queueHdr(listing.items)
    return listing
  }

  /**
   * Exact and near duplicates in a folder or the whole library. Near ones
   * need each photo's picture hash, made here from its thumbnail (rendered
   * first where there is none) since this side has the engine.
   */
  async duplicates(folder: string | null, threshold = 6): Promise<SourceListing> {
    // One search at a time: a new one (or another source opened) stops the last.
    this.dupes?.abort()
    const abort = new AbortController()
    this.dupes = abort
    const work = await this.index.dhashWork(folder)
    let next = 0
    const worker = async (): Promise<void> => {
      while (next < work.length && !abort.signal.aborted) {
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
    if (this.dupes === abort) this.dupes = null
    // Stopped: what was hashed is kept, and the rest waits for the next search.
    return this.index.duplicates(folder, threshold)
  }

  /** A photo's 64-bit dHash, of its thumbnail shrunk to 9×8 by the engine. */
  private async hashPicture(photoId: number, thumbPath: string | null): Promise<void> {
    if (!thumbPath) await this.thumbFor(photoId, null)
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

  /** The photo's row, its path a file that can be read (see `readable`). */
  async photoRow(key: string): Promise<PhotoRow> {
    return this.readable(await this.index.sourceRow(key))
  }

  /**
   * A row (from `sourceRow`, `openData` or `thumbJob`) whose path is a file
   * the engine can read: the photo itself, or, when it is gone, the copy its
   * project carries. A JPEG the project keeps repacked into JPEG XL is
   * rebuilt into the very JPEG it was, byte for byte, once.
   */
  async readable(row: PhotoRow): Promise<PhotoRow> {
    const e = row.embedded
    if (e === undefined) return row
    if (e === null)
      throw new Error(`${row.name} is missing, and its project does not carry a copy of it yet`)
    if (e.codec !== 'jxl-jpeg') return { ...row, path: e.path }
    const jpg = e.path.replace(/\.jxl$/i, '.jpg')
    if (!existsSync(jpg)) {
      let made = this.rebuilding.get(jpg)
      if (!made) {
        made = this.engine
          .convert({
            ...blankRequest(e.path, jpg, 'Jxl'),
            encode: 'JpegFromJxl',
            metadata: PRESERVE_ALL
          })
          .then(() => undefined)
          .finally(() => this.rebuilding.delete(jpg))
        this.rebuilding.set(jpg, made)
      }
      await made
    }
    return { ...row, path: jpg }
  }

  /** A key's saved recipe, its planes filled in. */
  async recipe(key: string): Promise<Recipe> {
    return this.planes.hydrate(await this.index.recipe(key))
  }

  /** Save a key's recipe; its planes cross by reference. */
  saveRecipe(key: string, recipe: Recipe): Promise<void> {
    return this.index.saveRecipe(key, this.planes.slim(recipe))
  }

  // ── thumbnails ──

  queueThumb(photoId: number, copyId: string | null, urgent = false): void {
    const k = keyOf(photoId, copyId)
    // One rendering now may be of the recipe before this change: it goes again after.
    if (this.rendering.has(k)) {
      this.stale.add(k)
      return
    }
    if (this.queued.has(k)) {
      if (urgent) this.prioritize([k])
      return
    }
    this.queued.add(k)
    if (urgent) this.queue.unshift({ photoId, copyId })
    else this.queue.push({ photoId, copyId })
    this.pump()
  }

  /** A key's thumbnail, rendered through the queue (never beside it); resolves when it is current. */
  private thumbFor(photoId: number, copyId: string | null): Promise<void> {
    const k = keyOf(photoId, copyId)
    return new Promise((resolve) => {
      this.waiting.set(k, [...(this.waiting.get(k) ?? []), resolve])
      this.queueThumb(photoId, copyId, true)
    })
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
      const k = keyOf(job.photoId, job.copyId)
      this.queued.delete(k)
      this.rendering.add(k)
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
          this.rendering.delete(k)
          if (this.stale.delete(k)) this.queueThumb(job.photoId, job.copyId, true)
          else {
            for (const done of this.waiting.get(k) ?? []) done()
            this.waiting.delete(k)
          }
          this.pump()
        })
    }
  }

  private async thumb(job: ThumbJob): Promise<void> {
    const work = await this.index.thumbJob(job.photoId, job.copyId)
    if (!work) return
    const { edited, stamp } = work
    const recipe = await this.planes.hydrate(work.recipe)
    const row = await this.readable(work.row)
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
    file: SourceInfo,
    recipe: Recipe,
    out: string,
    base: Record<string, unknown>
  ): Promise<void> {
    // A gain-map photo edited as HDR: its applied rendition, tone mapped.
    const hdr = editsHdr(recipe, file) ? await ensureHdrSource(this.engine, row, file) : null
    const info = hdr?.info ?? file
    if (hdr) base = { ...base, color: displayPolicy(info, 'Srgb') }
    // Pixel steps (an AI denoise) laid on: made from what the project keeps,
    // never by running a model.
    const plain = hdr?.px ?? (await ensureProxies(this.engine, row, info, BACKGROUND_THREADS))
    const px =
      !hdr && recipe.pixels.length > 0
        ? (
            await ensureWorking(
              pixelDeps(this.engine, this.index, row),
              versionStamp(row),
              plain,
              recipe.pixels,
              null
            )
          ).px
        : plain
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
      seed: seedOf(row),
      brushPaths: await brushPlanes(row.id, recipe, user),
      applyCrop: true,
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
