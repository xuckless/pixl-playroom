/**
 * The library: a folder of photos, as they are on disk, with no import step.
 * Files stay where they are; each photo's edits, rating, flag, label and
 * virtual copies live in its sidecar, and the index mirrors them for speed.
 *
 * Thumbnails are rendered in the background engine: a RAW's embedded preview
 * until it has been edited, the photo's own pixels otherwise, and the graded
 * picture (from its proxy) once it has a recipe.
 */
import { BrowserWindow } from 'electron'
import log from 'electron-log/main'
import exifr from 'exifr'
import { readdirSync, statSync, existsSync } from 'fs'
import { basename, extname, join } from 'path'
import { compile } from '../shared/compile'
import type { SourceInfo } from '../shared/engine-types'
import {
  IPC,
  type CameraInfo,
  type ColorLabel,
  type Flag,
  type LibraryItem,
  type MetaPatch
} from '../shared/ipc'
import { orientedFrame } from '../shared/compile'
import { defaultRecipe, hash32, isEdited, newId, type Recipe } from '../shared/recipe'
import type { EngineClient } from './engine/client'
import type { PhotoRow, Store } from './db'
import { brushPlanes } from './brushes'
import { paths } from './paths'
import { ensureProxies } from './proxy'
import { cacheUrl } from './protocol'
import { itemOf, readSidecar, writeSidecar, type Sidecar } from './sidecar'
import {
  BACKGROUND_THREADS,
  blankRequest,
  displayPolicy,
  IMAGE_EXTENSIONS,
  isRawExt,
  sourceOrientation
} from './source'

export const THUMB_EDGE = 400

export function parseKey(key: string): { photoId: number; copyId: string | null } {
  const [id, copy] = key.split(':')
  return { photoId: Number(id), copyId: copy ?? null }
}

/** A file's version: its path, size and modification time. */
const versionOf = (row: PhotoRow): string => `${row.path}:${row.mtime}:${row.size}`

export function keyOf(photoId: number, copyId: string | null): string {
  return copyId === null ? String(photoId) : `${photoId}:${copyId}`
}

function emptyCamera(): CameraInfo {
  return {
    make: null,
    model: null,
    lens: null,
    iso: null,
    exposureTime: null,
    fNumber: null,
    focalLength: null,
    capturedAt: null,
    gps: null
  }
}

export async function readCamera(path: string): Promise<CameraInfo> {
  try {
    const t = (await exifr.parse(path, {
      tiff: true,
      exif: true,
      gps: true,
      xmp: false,
      icc: false,
      iptc: false,
      interop: false,
      translateValues: true,
      reviveValues: true
    })) as Record<string, unknown> | undefined
    if (!t) return emptyCamera()
    const num = (v: unknown): number | null =>
      typeof v === 'number' && Number.isFinite(v) ? v : null
    const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
    const date = t.DateTimeOriginal ?? t.CreateDate ?? t.ModifyDate
    return {
      make: str(t.Make),
      model: str(t.Model),
      lens: str(t.LensModel) ?? str(t.Lens),
      iso: num(t.ISO) ?? num(t.ISOSpeedRatings),
      exposureTime: num(t.ExposureTime),
      fNumber: num(t.FNumber),
      focalLength: num(t.FocalLength),
      capturedAt: date instanceof Date ? date.toISOString() : str(date),
      gps:
        num(t.latitude) !== null && num(t.longitude) !== null
          ? { lat: t.latitude as number, lon: t.longitude as number }
          : null
    }
  } catch {
    return emptyCamera()
  }
}

interface ThumbJob {
  photoId: number
  copyId: string | null
}

export class Library {
  private probes = new Map<string, SourceInfo>()
  /** Files whose thumbnail failed, per version, with why. */
  private failed = new Map<string, string>()
  private queue: ThumbJob[] = []
  private queued = new Set<string>()
  private running = 0

  constructor(
    private readonly store: Store,
    private readonly engine: EngineClient
  ) {}

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

  // ── folders ──

  openFolder(folder: string): LibraryItem[] {
    this.store.touchFolder(folder)
    const present = new Set<string>()
    let names: string[] = []
    try {
      names = readdirSync(folder)
    } catch (err) {
      log.warn('cannot read folder', folder, err)
    }
    this.store.tx(() => {
      for (const name of names) {
        // Hidden files, and the `._` AppleDouble files macOS leaves beside
        // every photo on a FAT or exFAT card, are not photos.
        if (name.startsWith('.')) continue
        const ext = extname(name).slice(1).toLowerCase()
        if (!IMAGE_EXTENSIONS.includes(ext)) continue
        const path = join(folder, name)
        let st
        try {
          st = statSync(path)
        } catch {
          continue
        }
        if (!st.isFile()) continue
        present.add(path)
        const row = this.store.upsertPhoto({
          path,
          folder,
          name,
          ext,
          size: st.size,
          mtime: st.mtimeMs,
          isRaw: isRawExt(ext)
        })
        this.syncSidecar(row)
      }
      this.store.removeMissing(folder, present)
    })
    const items = this.items(folder)
    for (const it of items) {
      this.queueThumb(it.photoId, it.copyId)
    }
    void this.fillCameras(folder)
    return items
  }

  /** Re-read a sidecar into the index when it changed on disk. */
  private syncSidecar(row: PhotoRow): void {
    const file = row.path + '.playroom.json'
    const mtime = existsSync(file) ? statSync(file).mtimeMs : null
    if (mtime === row.sidecar_mtime) return
    const { sidecar } = readSidecar(row.path, row.is_raw === 1)
    this.mirror(row, sidecar, mtime)
  }

  private mirror(row: PhotoRow, sidecar: Sidecar, mtime: number | null): void {
    const raw = row.is_raw === 1
    const p = sidecar.photo
    this.store.setPhotoMeta(row.id, {
      rating: p.rating,
      flag: p.flag,
      label: p.label,
      edited: p.recipe !== null && isEdited(p.recipe, raw)
    })
    this.store.replaceCopies(
      row.id,
      sidecar.copies.map((c) => ({
        id: c.id,
        name: c.name,
        rating: c.rating,
        flag: c.flag,
        label: c.label,
        edited: c.recipe !== null && isEdited(c.recipe, raw)
      }))
    )
    this.store.setSidecarMtime(row.id, mtime)
  }

  private async fillCameras(folder: string): Promise<void> {
    let filled = 0
    for (const row of this.store.photosIn(folder)) {
      if (row.camera_json) continue
      const camera = await readCamera(row.path)
      this.store.setCamera(row.id, camera)
      filled++
    }
    // Only news is broadcast: the renderer answers `changed` by reopening
    // the folder, which calls this again.
    if (filled > 0) this.broadcast(IPC.library.changed, { folder })
  }

  items(folder: string): LibraryItem[] {
    const out: LibraryItem[] = []
    for (const row of this.store.photosIn(folder)) {
      out.push(this.itemFromRow(row, null))
      for (const c of this.store.copiesOf(row.id)) out.push(this.itemFromRow(row, c.copy_id))
    }
    return out
  }

  item(key: string): LibraryItem | undefined {
    const { photoId, copyId } = parseKey(key)
    const row = this.store.photo(photoId)
    if (!row) return undefined
    return this.itemFromRow(row, copyId)
  }

  itemFromRow(row: PhotoRow, copyId: string | null): LibraryItem {
    const copy =
      copyId === null ? undefined : this.store.copiesOf(row.id).find((c) => c.copy_id === copyId)
    const thumbPath = copy ? copy.thumb_path : row.thumb_path
    const thumbKey = copy ? copy.thumb_key : row.thumb_key
    return {
      key: keyOf(row.id, copyId),
      photoId: row.id,
      copyId,
      copyName: copy?.name ?? null,
      path: row.path,
      name: row.name,
      ext: row.ext,
      size: row.size,
      mtime: row.mtime,
      isRaw: row.is_raw === 1,
      rating: copy ? copy.rating : row.rating,
      flag: ((copy ? copy.flag : row.flag) as Flag) ?? null,
      label: ((copy ? copy.label : row.label) as ColorLabel) ?? null,
      edited: (copy ? copy.edited : row.edited) === 1,
      thumbUrl: thumbPath && existsSync(thumbPath) ? cacheUrl(thumbPath, thumbKey ?? '') : null,
      unreadable: this.failed.has(versionOf(row)),
      camera: row.camera_json ? (JSON.parse(row.camera_json) as CameraInfo) : emptyCamera()
    }
  }

  // ── sidecar-backed state ──

  photoRow(key: string): PhotoRow {
    const row = this.store.photo(parseKey(key).photoId)
    if (!row) throw new Error(`no photo ${key}`)
    return row
  }

  sidecar(key: string): Sidecar {
    const row = this.photoRow(key)
    return readSidecar(row.path, row.is_raw === 1).sidecar
  }

  /** Change a sidecar and keep the index in step. */
  update(key: string, change: (s: Sidecar) => void): Sidecar {
    const row = this.photoRow(key)
    const { sidecar } = readSidecar(row.path, row.is_raw === 1)
    change(sidecar)
    const mtime = writeSidecar(row.path, sidecar)
    this.mirror(row, sidecar, mtime)
    return sidecar
  }

  recipe(key: string): Recipe {
    const row = this.photoRow(key)
    const it = itemOf(this.sidecar(key), parseKey(key).copyId)
    return it?.recipe ?? defaultRecipe(row.is_raw === 1)
  }

  saveRecipe(key: string, recipe: Recipe): void {
    const { copyId } = parseKey(key)
    const raw = this.photoRow(key).is_raw === 1
    this.update(key, (s) => {
      const it = itemOf(s, copyId)
      if (it) it.recipe = isEdited(recipe, raw) || copyId !== null ? recipe : null
    })
  }

  setMeta(keys: string[], patch: MetaPatch): void {
    this.store.tx(() => {
      for (const key of keys) {
        const { copyId } = parseKey(key)
        this.update(key, (s) => {
          const it = itemOf(s, copyId)
          if (!it) return
          if (patch.rating !== undefined) it.rating = Math.max(0, Math.min(5, patch.rating))
          if (patch.flag !== undefined) it.flag = patch.flag
          if (patch.label !== undefined) it.label = patch.label
        })
      }
    })
  }

  createCopy(key: string): string {
    const { photoId, copyId } = parseKey(key)
    const id = newId()
    const source = this.recipe(key)
    this.update(key, (s) => {
      const n = s.copies.length + 1
      s.copies.push({
        id,
        name: `Copy ${n}`,
        rating: 0,
        flag: null,
        label: null,
        recipe: structuredClone(source),
        snapshots: []
      })
      void copyId
    })
    const newKey = keyOf(photoId, id)
    this.queueThumb(photoId, id)
    return newKey
  }

  deleteCopy(key: string): void {
    const { copyId } = parseKey(key)
    if (copyId === null) return
    this.update(key, (s) => {
      s.copies = s.copies.filter((c) => c.id !== copyId)
    })
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
          const row = this.store.photo(job.photoId)
          if (!row) return
          this.failed.set(versionOf(row), String(err?.message ?? err))
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
    const row = this.store.photo(job.photoId)
    if (!row || this.failed.has(versionOf(row))) return
    const key = keyOf(row.id, job.copyId)
    const recipe = this.recipe(key)
    const raw = row.is_raw === 1
    const edited = isEdited(recipe, raw)
    const stamp = `${Math.round(row.mtime)}-${row.size}-${edited ? hash32(JSON.stringify(recipe)).toString(16) : 'plain'}`
    const existing =
      job.copyId === null ? row : this.store.copiesOf(row.id).find((c) => c.copy_id === job.copyId)
    if (existing?.thumb_key === stamp && existing.thumb_path && existsSync(existing.thumb_path))
      return

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
          ...blankRequest(row.path, out, info.input),
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
    this.store.setThumb(row.id, job.copyId, out, stamp)
    this.broadcast(IPC.library.thumb, { key, url: cacheUrl(out, stamp) })
  }

  /** A thumbnail of the graded picture, from the photo's proxy. */
  private async graded(
    row: PhotoRow,
    info: SourceInfo,
    recipe: Recipe,
    out: string,
    base: Record<string, unknown>
  ): Promise<void> {
    const px = await ensureProxies(this.engine, row, info)
    const { user, width, height } = orientedFrame(recipe, px.frameWidth, px.frameHeight)
    const compiled = compile(recipe, {
      isRaw: row.is_raw === 1,
      asShot: info.as_shot_white,
      sourceOrientation: 'Normal',
      frameWidth: px.frameWidth,
      frameHeight: px.frameHeight,
      scale: px.proxy.width / px.frameWidth,
      seed: hash32(row.path),
      brushPaths: brushPlanes(row.id, recipe, user),
      applyCrop: true
    })
    const cropW = (compiled.crop?.width ?? 1) * width
    const cropH = (compiled.crop?.height ?? 1) * height
    const factor = Math.min(
      1,
      THUMB_EDGE / (Math.max(cropW, cropH) * (px.proxy.width / px.frameWidth))
    )
    await this.engine.convert({
      ...blankRequest(px.proxy.path, out, px.proxy.input),
      ...base,
      resize: factor < 1 ? { Scale: { factor } } : 'None',
      grade: compiled.grade,
      framing: compiled.framing
    })
  }
}

export function folderOf(path: string): string {
  return path.slice(0, path.length - basename(path).length - 1)
}
