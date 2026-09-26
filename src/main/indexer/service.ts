/**
 * The index service: everything that reads or writes the index or a
 * sidecar, run in the index host (a utility process, see host.ts) so none of
 * it holds up the main process. Nothing here needs Electron.
 *
 * Requests are handled one at a time, in the order they arrive, each with
 * sync SQLite and sync fs: two sidecar writes never interleave, and the main
 * process can rely on order (a session's save lands before the copy made
 * from it). Folder scans and the exif fill are the only long work; they run
 * in chunks and give other requests a turn between them.
 */
import { existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { extname, join } from 'path'
import type {
  CameraInfo,
  ColorLabel,
  ExportPreset,
  Flag,
  HistoryEntry,
  LibraryItem,
  MetaPatch,
  Preset,
  Snapshot
} from '../../shared/ipc'
import { defaultRecipe, hash32, isEdited, newId, type Recipe } from '../../shared/recipe'
import { cacheUrlIn } from '../cache-url'
import { emptyCamera, readCamera } from '../camera'
import { Store, type CopyRow, type PhotoRow } from '../db'
import { keyOf, parseKey } from '../keys'
import { itemOf, readSidecar, SIDECAR_SUFFIX, writeSidecar, type Sidecar } from '../sidecar'
import { IMAGE_EXTENSIONS, isRawExt } from '../source'
import type { IndexEvent } from './protocol'

/** Files looked at per turn of a scan. */
const CHUNK = 200

/** A file's version: its path, size and modification time. */
const versionOf = (row: PhotoRow): string => `${row.path}:${row.mtime}:${row.size}`

const nextTurn = (): Promise<void> => new Promise((r) => setImmediate(r))

/** A thumbnail to render: what it shows, and the stamp it will carry. */
export interface ThumbWork {
  row: PhotoRow
  recipe: Recipe
  edited: boolean
  stamp: string
}

/** What opening a photo in develop needs from the index, in one trip. */
export interface OpenData {
  row: PhotoRow
  recipe: Recipe
  item: LibraryItem
  snapshots: Snapshot[]
}

export interface IndexOptions {
  userData: string
  emit: (event: IndexEvent) => void
}

interface Scan {
  again: boolean
  announce: boolean
  done: Promise<void>
}

export class IndexService {
  private readonly store: Store
  private readonly cacheRoot: string
  private readonly emit: (event: IndexEvent) => void
  /** Files whose thumbnail failed, per version, with why. */
  private readonly failed = new Map<string, string>()
  private readonly scans = new Map<string, Scan>()
  private readonly filling = new Set<string>()
  private readonly fillAgain = new Set<string>()
  private closed = false

  constructor(opts: IndexOptions) {
    mkdirSync(opts.userData, { recursive: true })
    this.store = Store.open(join(opts.userData, 'playroom.db'))
    this.cacheRoot = join(opts.userData, 'cache')
    this.emit = opts.emit
  }

  close(): void {
    this.closed = true
    this.store.close()
  }

  // ── folders ──

  /**
   * A folder's items as the index has them, at once; the disk is looked at
   * afterwards and a `changed` event follows only if it differs. A folder
   * the index has never seen is scanned first.
   */
  async listFolder(folder: string): Promise<LibraryItem[]> {
    this.store.touchFolder(folder)
    if (this.store.hasPhotosIn(folder)) {
      // After this answer, not before it.
      setImmediate(() => {
        if (this.closed) return
        this.rescan(folder).catch((err) => console.warn('scan failed', folder, err))
      })
    } else {
      await this.rescan(folder, false)
    }
    return this.items(folder)
  }

  /**
   * Bring a folder's rows in line with the disk. One scan per folder at a
   * time: a call while one runs asks for another pass and shares its
   * promise. `announce` sends `changed` when anything differed.
   */
  rescan(folder: string, announce = true): Promise<void> {
    const running = this.scans.get(folder)
    if (running) {
      running.again = true
      running.announce ||= announce
      return running.done
    }
    const scan: Scan = { again: false, announce, done: Promise.resolve() }
    this.scans.set(folder, scan)
    scan.done = (async () => {
      let changed = 0
      try {
        do {
          scan.again = false
          changed += await this.scan(folder)
        } while (scan.again)
      } finally {
        this.scans.delete(folder)
      }
      if (this.closed) return
      if (changed > 0 && scan.announce) this.emit({ name: 'changed', folder })
      this.fillCameras(folder).catch((err) => console.warn('exif fill failed', folder, err))
    })()
    return scan.done
  }

  /** One pass over a folder. Returns how many rows it changed. */
  private async scan(folder: string): Promise<number> {
    let names: string[]
    try {
      names = readdirSync(folder)
    } catch (err) {
      // An unplugged card: keep its rows for when it comes back.
      console.warn('cannot read folder', folder, (err as Error).message)
      return 0
    }
    const known = new Map(this.store.photosIn(folder).map((r) => [r.path, r]))
    const present = new Set<string>()
    let changed = 0
    for (let i = 0; i < names.length; i += CHUNK) {
      if (i > 0) await nextTurn()
      if (this.closed) return changed
      const chunk = names.slice(i, i + CHUNK)
      changed += this.store.tx(() => {
        let n = 0
        for (const name of chunk) {
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
          let row = known.get(path)
          if (!row || row.size !== st.size || row.mtime !== st.mtimeMs) {
            row = this.store.upsertPhoto({
              path,
              folder,
              name,
              ext,
              size: st.size,
              mtime: st.mtimeMs,
              isRaw: isRawExt(ext)
            })
            n++
          }
          if (this.syncSidecar(row)) n++
        }
        return n
      })
    }
    changed += this.store.tx(() => this.store.removeMissing(folder, present))
    return changed
  }

  /** Re-read a sidecar into the index when it changed on disk. Returns whether it had. */
  private syncSidecar(row: PhotoRow): boolean {
    const file = row.path + SIDECAR_SUFFIX
    const mtime = existsSync(file) ? statSync(file).mtimeMs : null
    if (mtime === row.sidecar_mtime) return false
    const { sidecar } = readSidecar(row.path, row.is_raw === 1)
    this.mirror(row, sidecar, mtime)
    return true
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

  /** Read exif for the folder's photos that have none yet; `changed` when any were filled. */
  private async fillCameras(folder: string): Promise<void> {
    if (this.filling.has(folder)) {
      this.fillAgain.add(folder)
      return
    }
    this.filling.add(folder)
    let filled = 0
    try {
      do {
        this.fillAgain.delete(folder)
        for (const row of this.store.photosIn(folder)) {
          if (row.camera_json) continue
          const camera = await readCamera(row.path)
          if (this.closed) return
          // Gone while its exif was read.
          if (!this.store.photo(row.id)) continue
          this.store.setCamera(row.id, camera)
          filled++
        }
      } while (this.fillAgain.has(folder))
    } finally {
      this.filling.delete(folder)
    }
    if (filled > 0) this.emit({ name: 'changed', folder })
  }

  recentFolders(): string[] {
    return this.store.recentFolders().filter((f) => existsSync(f))
  }

  // ── items ──

  /** A folder's items: each photo, then its copies. Two queries, whatever the size. */
  items(folder: string): LibraryItem[] {
    const copies = new Map<number, CopyRow[]>()
    for (const c of this.store.copiesIn(folder)) {
      const list = copies.get(c.photo_id)
      if (list) list.push(c)
      else copies.set(c.photo_id, [c])
    }
    const out: LibraryItem[] = []
    for (const row of this.store.photosIn(folder)) {
      out.push(this.itemFrom(row, undefined))
      for (const c of copies.get(row.id) ?? []) out.push(this.itemFrom(row, c))
    }
    return out
  }

  item(key: string): LibraryItem | undefined {
    const { photoId, copyId } = parseKey(key)
    const row = this.store.photo(photoId)
    if (!row) return undefined
    if (copyId === null) return this.itemFrom(row, undefined)
    const copy = this.store.copiesOf(row.id).find((c) => c.copy_id === copyId)
    return copy ? this.itemFrom(row, copy) : undefined
  }

  itemsFor(keys: string[]): (LibraryItem | undefined)[] {
    return keys.map((k) => this.item(k))
  }

  private itemFrom(row: PhotoRow, copy: CopyRow | undefined): LibraryItem {
    const thumbPath = copy ? copy.thumb_path : row.thumb_path
    const thumbKey = copy ? copy.thumb_key : row.thumb_key
    return {
      key: keyOf(row.id, copy?.copy_id ?? null),
      photoId: row.id,
      copyId: copy?.copy_id ?? null,
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
      thumbUrl:
        thumbPath && existsSync(thumbPath)
          ? cacheUrlIn(this.cacheRoot, thumbPath, thumbKey ?? '')
          : null,
      unreadable: this.failed.has(versionOf(row)),
      camera: row.camera_json ? (JSON.parse(row.camera_json) as CameraInfo) : emptyCamera()
    }
  }

  // ── sidecar-backed state ──

  row(key: string): PhotoRow {
    const row = this.store.photo(parseKey(key).photoId)
    if (!row) throw new Error(`no photo ${key}`)
    return row
  }

  private sidecar(row: PhotoRow): Sidecar {
    return readSidecar(row.path, row.is_raw === 1).sidecar
  }

  recipe(key: string): Recipe {
    const row = this.row(key)
    const it = itemOf(this.sidecar(row), parseKey(key).copyId)
    return it?.recipe ?? defaultRecipe(row.is_raw === 1)
  }

  recipes(keys: string[]): { key: string; row: PhotoRow; recipe: Recipe }[] {
    return keys.map((key) => ({ key, row: this.row(key), recipe: this.recipe(key) }))
  }

  openData(key: string): OpenData {
    const row = this.row(key)
    const item = this.item(key)
    if (!item) throw new Error(`no item ${key}`)
    const it = itemOf(this.sidecar(row), parseKey(key).copyId)
    return {
      row,
      recipe: it?.recipe ?? defaultRecipe(row.is_raw === 1),
      item,
      snapshots: it?.snapshots ?? []
    }
  }

  /** Change a sidecar and keep the index in step. */
  private update(key: string, change: (s: Sidecar) => void): Sidecar {
    const row = this.row(key)
    const sidecar = this.sidecar(row)
    change(sidecar)
    const mtime = writeSidecar(row.path, sidecar)
    this.mirror(row, sidecar, mtime)
    return sidecar
  }

  saveRecipe(key: string, recipe: Recipe): void {
    const { copyId } = parseKey(key)
    const raw = this.row(key).is_raw === 1
    this.update(key, (s) => {
      const it = itemOf(s, copyId)
      if (it) it.recipe = isEdited(recipe, raw) || copyId !== null ? recipe : null
    })
  }

  /** Several recipes saved in one transaction. Returns the items after. */
  saveRecipes(pairs: { key: string; recipe: Recipe }[]): (LibraryItem | undefined)[] {
    this.store.tx(() => {
      for (const { key, recipe } of pairs) this.saveRecipe(key, recipe)
    })
    return this.itemsFor(pairs.map((p) => p.key))
  }

  /** Every key back to its defaults. Returns the items and the fresh recipes. */
  resetRecipes(keys: string[]): {
    items: (LibraryItem | undefined)[]
    recipes: Record<string, Recipe>
  } {
    const recipes: Record<string, Recipe> = {}
    this.store.tx(() => {
      for (const key of keys) {
        const fresh = defaultRecipe(this.row(key).is_raw === 1)
        this.saveRecipe(key, fresh)
        recipes[key] = fresh
      }
    })
    return { items: this.itemsFor(keys), recipes }
  }

  setMeta(keys: string[], patch: MetaPatch): (LibraryItem | undefined)[] {
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
    return this.itemsFor(keys)
  }

  /** A virtual copy of `key` with its saved recipe. Returns the new copy's item. */
  createCopy(key: string): LibraryItem {
    const { photoId } = parseKey(key)
    const id = newId()
    const source = this.recipe(key)
    this.update(key, (s) => {
      s.copies.push({
        id,
        name: `Copy ${s.copies.length + 1}`,
        rating: 0,
        flag: null,
        label: null,
        recipe: structuredClone(source),
        snapshots: []
      })
    })
    const item = this.item(keyOf(photoId, id))
    if (!item) throw new Error(`copy of ${key} was not recorded`)
    return item
  }

  deleteCopy(key: string): void {
    const { copyId } = parseKey(key)
    if (copyId === null) return
    this.update(key, (s) => {
      s.copies = s.copies.filter((c) => c.id !== copyId)
    })
  }

  saveSnapshots(key: string, snapshots: Snapshot[]): void {
    const { copyId } = parseKey(key)
    this.update(key, (s) => {
      const it = itemOf(s, copyId)
      if (it) it.snapshots = snapshots
    })
  }

  /** Give a file the index has not seen yet (Enhance's output) a recipe in its sidecar. */
  seedRecipe(photoPath: string, recipe: Recipe): void {
    const { sidecar } = readSidecar(photoPath, false)
    sidecar.photo.recipe = recipe
    writeSidecar(photoPath, sidecar)
  }

  // ── thumbnails ──

  /** The thumbnail to render for an item, or null when the one it has is current (or it cannot be read). */
  thumbJob(photoId: number, copyId: string | null): ThumbWork | null {
    const row = this.store.photo(photoId)
    if (!row || this.failed.has(versionOf(row))) return null
    const existing =
      copyId === null ? row : this.store.copiesOf(row.id).find((c) => c.copy_id === copyId)
    if (!existing) return null
    const recipe = this.recipe(keyOf(row.id, copyId))
    const edited = isEdited(recipe, row.is_raw === 1)
    const stamp = `${Math.round(row.mtime)}-${row.size}-${edited ? hash32(JSON.stringify(recipe)).toString(16) : 'plain'}`
    if (existing.thumb_key === stamp && existing.thumb_path && existsSync(existing.thumb_path))
      return null
    return { row, recipe, edited, stamp }
  }

  setThumb(photoId: number, copyId: string | null, path: string, stamp: string): void {
    this.store.setThumb(photoId, copyId, path, stamp)
  }

  /** Once per version of the file: one that cannot be read is not tried again until it changes. */
  markFailed(photoId: number, reason: string): void {
    const row = this.store.photo(photoId)
    if (row) this.failed.set(versionOf(row), reason)
  }

  // ── history ──

  history(key: string): HistoryEntry[] {
    return this.store.history(key)
  }

  appendHistory(key: string, label: string, recipe: Recipe): HistoryEntry {
    return this.store.appendHistory(key, label, recipe)
  }

  // ── painted planes, by reference (see planestore.ts) ──

  putPlane(ref: string, png: string): void {
    this.store.putPlane(ref, png)
  }

  plane(ref: string): string | undefined {
    return this.store.plane(ref)
  }

  /**
   * Drop the planes nothing refers to. Only the edit history keeps planes
   * by reference (presets and sidecars hold the PNGs), so this is safe
   * before anything else has asked for one: at the first start.
   */
  prunePlanes(): number {
    const keep = new Set<string>()
    for (const json of this.store.historyRecipes()) {
      for (const m of json.matchAll(/"ref":"([^"]+)"/g)) keep.add(m[1])
    }
    return this.store.prunePlanes(keep)
  }

  // ── presets and settings ──

  presets(): Preset[] {
    return this.store.presets()
  }

  savePreset(p: Preset): void {
    this.store.savePreset(p)
  }

  removePreset(id: string): void {
    this.store.removePreset(id)
  }

  exportPresets(): ExportPreset[] {
    return this.store.exportPresets()
  }

  saveExportPreset(p: ExportPreset): void {
    this.store.saveExportPreset(p)
  }

  removeExportPreset(id: string): void {
    this.store.removeExportPreset(id)
  }

  getSetting(key: string): unknown {
    return this.store.getSetting(key) ?? null
  }

  setSetting(key: string, value: unknown): void {
    this.store.setSetting(key, value)
  }
}
