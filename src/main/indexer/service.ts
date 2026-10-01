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
import { createHash } from 'crypto'
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync
} from 'fs'
import { dirname, extname, join, resolve } from 'path'
import type {
  CameraInfo,
  Collection,
  ColorLabel,
  DuplicateGroup,
  ExportPreset,
  Flag,
  HistoryLog,
  KeywordNode,
  HdrKind,
  LibraryItem,
  LibrarySource,
  MetaPatch,
  MetaTextPatch,
  PhotoMeta,
  Preset,
  Snapshot,
  SourceListing
} from '../../shared/ipc'
import { groupNear } from '../../shared/dupes'
import { keywordPrefixes, normaliseKeyword } from '../../shared/keywords'
import {
  defaultRecipe,
  hash32,
  isEdited,
  newId,
  slimRecipe,
  type Recipe
} from '../../shared/recipe'
import { memberResolver, remapCollections, type SmartGroup } from '../../shared/smart'
import { cacheUrlIn } from '../cache-url'
import { emptyCamera, readCamera } from '../camera'
import { Store, type CollectionRow, type CopyRow, type PhotoRow } from '../db'
import { keyOf, parseKey } from '../keys'
import {
  itemOf,
  readSidecar,
  SIDECAR_SUFFIX,
  sidecarPath,
  writeSidecar,
  type Sidecar,
  type SidecarStack
} from '../sidecar'
import {
  DEFAULT_PROJECTS_DIR,
  locationOf,
  newProjectPath,
  projectDirsFor,
  projectFilesIn,
  projectsRoot,
  type ProjectLocation
} from '../project/locate'
import {
  fileStamp,
  itemKeyOf,
  jpegSize,
  PIXL_EXT,
  PixlFile,
  ProjectPool,
  refsIn,
  type EmbeddedOriginal,
  type Origin
} from '../project/pixlfile'
import { IMAGE_EXTENSIONS, isRawExt, versionStamp } from '../source'
import type { IndexEvent } from './protocol'
import {
  applyMetaPatch,
  emptyMeta,
  exiftoolXmp,
  metaIsEmpty,
  sameMeta,
  xmpPathFor,
  type XmpIo
} from './xmp'

/** Files looked at per turn of a scan. */
const CHUNK = 200
/** A folder scanned this recently is not walked again when listed (its own reload after a fill). */
const RESCAN_FRESH_MS = 10_000

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
  /** How `.xmp` sidecars are read and written (ExifTool unless a test says otherwise). */
  xmp?: XmpIo
}

/** A saved collections file: definitions, and a manual collection's items by path. */
export interface CollectionsFile {
  app: 'pixl-playroom'
  kind: 'collections'
  version: 1
  collections: {
    id: string
    name: string
    kind: Collection['kind']
    parent: string | null
    rules: SmartGroup | null
    sort: number
    items?: { path: string; copyId: string | null }[]
  }[]
}

/** What a listing needs beside the rows, fetched once for all of them. */
interface ListingContext {
  keywords: Map<number, string[]>
  stackSizes: Map<string, number>
  /** Per folder: gone from disk (an unplugged drive). */
  folderGone: Map<string, boolean>
  /** Only for evaluating rules: skip looking for each thumbnail on disk. */
  bare: boolean
}

/** A file's content version, for its cached SHA-1. */
const hashKeyOf = (row: PhotoRow): string => `${row.mtime}-${row.size}`

/** A folder's own modification time (null when it cannot be read). */
function folderMtime(folder: string): number | null {
  try {
    return statSync(folder).mtimeMs
  } catch {
    return null
  }
}

/** A recipe as its thumbnail knows it: 'plain' when unedited, else its slim form's hash. */
function thumbRecipeKey(recipe: Recipe | null, raw: boolean): string {
  if (!recipe || !isEdited(recipe, raw)) return 'plain'
  return hash32(JSON.stringify(slimRecipe(recipe))).toString(16)
}

/** The row's content hash, when the one recorded is of the file as it is now. */
const knownHash = (row: PhotoRow): string | null =>
  row.hash_key === hashKeyOf(row) ? row.content_hash : null

/**
 * Whether a project's recorded original is this file: the same bytes where
 * both hashes are known, else the same size. A new photo that took an old
 * one's name (a camera's counter reset) is not; neither is an original
 * rewritten by another app.
 */
function isOriginOf(origin: Origin, row: PhotoRow): boolean {
  const hash = knownHash(row)
  if (origin.sha1 && hash) return origin.sha1 === hash
  return origin.size === row.size
}

/** Whether `row` is a project's original under another name: a rename keeps the bytes, the size and the time. */
function isRenamed(origin: Origin, row: PhotoRow): boolean {
  if (row.ext.toLowerCase() !== origin.ext.toLowerCase()) return false
  const hash = knownHash(row)
  if (origin.sha1 && hash) return origin.sha1 === hash
  return origin.size === row.size && origin.mtime === row.mtime
}

function sha1(path: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const h = createHash('sha1')
    createReadStream(path)
      .on('data', (d) => h.update(d))
      .on('error', reject)
      .on('end', () => resolveHash(h.digest('hex')))
  })
}

const unique = <T>(xs: T[]): T[] => [...new Set(xs)]

interface Scan {
  again: boolean
  announce: boolean
  done: Promise<void>
}

export class IndexService {
  private readonly store: Store
  private readonly cacheRoot: string
  private readonly emit: (event: IndexEvent) => void
  /** When each folder was last scanned (a listing a moment after needs no walk). */
  private readonly scannedAt = new Map<string, { at: number; dirMtime: number | null }>()

  /** Files whose thumbnail failed, per version, with why (and in the row, for the next launch). */
  private readonly failed = new Map<string, string>()

  private isFailed(row: PhotoRow): boolean {
    const v = versionOf(row)
    return this.failed.has(v) || row.failed_key === v
  }
  private readonly scans = new Map<string, Scan>()
  private readonly filling = new Set<string>()
  private readonly fillAgain = new Set<string>()
  private readonly xmp: XmpIo
  /** `.xmp` reads and writes, one at a time: two edits of one file never interleave. */
  private xmpChain: Promise<unknown> = Promise.resolve()
  private closed = false
  /** The `.pixl` projects open now (see pixlfile.ts). */
  private readonly projects = new ProjectPool()
  /** What each project file names, by its path, while the file is unchanged. */
  private readonly origins = new Map<string, { stamp: string | null; origin: Origin | null }>()

  constructor(opts: IndexOptions) {
    mkdirSync(opts.userData, { recursive: true })
    this.store = Store.open(join(opts.userData, 'playroom.db'))
    this.cacheRoot = join(opts.userData, 'cache')
    this.emit = opts.emit
    this.xmp = opts.xmp ?? exiftoolXmp()
  }

  /** Photos open in Develop: their projects stay open between edits (see `holdOpen`). */
  private readonly held = new Set<number>()

  /**
   * Keep a photo's project open while it is in Develop (`on`), so every edit
   * finds its connection and prepared statements; let it close when it leaves.
   */
  holdOpen(key: string, on: boolean): void {
    const { photoId } = parseKey(key)
    if (on) this.held.add(photoId)
    else this.held.delete(photoId)
    const path = this.projectOf(this.row(key))
    if (path) this.projects.pin(path, on)
  }

  close(): void {
    this.closed = true
    this.projects.drop()
    this.store.close()
    void this.xmp.end().catch(() => {})
  }

  private xmpSerial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.xmpChain.then(fn, fn)
    this.xmpChain = run.catch(() => undefined)
    return run
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
      // A folder scanned a moment ago (its own `changed` reloading it, a
      // quick back and forth) is as it was: not walked again.
      // (A file added, removed or renamed changes the folder's own time.)
      const last = this.scannedAt.get(folder)
      if (last && Date.now() - last.at < RESCAN_FRESH_MS && last.dirMtime === folderMtime(folder))
        return this.items(folder)
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
          const dirMtime = folderMtime(folder)
          changed += await this.scan(folder)
          this.scannedAt.set(folder, { at: Date.now(), dirMtime })
        } while (scan.again)
      } finally {
        this.scans.delete(folder)
      }
      if (this.closed) return
      if (changed > 0 && scan.announce) this.emit({ name: 'changed', folder })
      this.fillXmp(folder).catch((err) => console.warn('xmp fill failed', folder, err))
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
          if (this.syncTruth(row)) n++
        }
        return n
      })
    }
    // Projects first: one whose photo is gone keeps its place as the photo.
    changed += this.store.tx(() => this.linkProjects(folder, present))
    changed += this.store.tx(() => this.store.removeMissing(folder, present))
    return changed
  }

  // ── projects ──

  /** Where new projects go (Settings → Projects). */
  private location(): ProjectLocation {
    return locationOf(this.store.getSetting('projects.location'))
  }

  /** The projects folders a folder's projects may be in besides the folder itself. */
  private projectRoots(): string[] {
    const loc = this.location()
    const roots = [DEFAULT_PROJECTS_DIR]
    if (typeof loc === 'object' && !roots.includes(projectsRoot(loc))) roots.push(projectsRoot(loc))
    return roots
  }

  /** The photo a project file names, read once per version of the file. */
  private originOf(path: string): Origin | null {
    const stamp = fileStamp(path)
    const hit = this.origins.get(path)
    // Changed by the index's own writes (an edit), the origin is as it was:
    // only `setOrigin` changes it, and that forgets it here.
    if (hit && (hit.stamp === stamp || this.projects.leftAs(path, stamp))) {
      hit.stamp = stamp
      return hit.origin
    }
    const origin = PixlFile.peekOrigin(path)
    this.origins.set(path, { stamp, origin })
    return origin
  }

  /** The row's project, when it has one that is still there. */
  private projectOf(row: PhotoRow): string | null {
    return row.project_path && existsSync(row.project_path) ? row.project_path : null
  }

  /**
   * Find the folder's projects (beside its photos and in the projects
   * folders) and tie each to its photo by name.
   *
   * - A project whose photo is not in the folder (moved, deleted) stands in
   *   for it: it is listed as the photo, developed from the original it
   *   carries. Its path joins `present`.
   * - A photo with no project here looks for one made from a photo of its
   *   name and size whose original is gone (it moved away from its project).
   * - A photo whose project went has only what a sidecar says again.
   *
   * A photo's project is read into the index when it changed. Returns how
   * many photos changed.
   */
  private linkProjects(folder: string, present: Set<string>): number {
    const rows = this.store.photosIn(folder)
    const photos = rows.filter((r) => present.has(r.path))
    const byName = new Map(photos.map((r) => [r.name, r]))
    let n = 0
    const claimed = new Set<number>()
    const taken = new Set<string>()
    const link = (row: PhotoRow, path: string): void => {
      claimed.add(row.id)
      taken.add(path)
      if (row.project_path !== path) {
        this.store.setProject(row.id, path, null)
        row.project_path = path
        row.project_mtime = null
      }
      if (this.syncProject(row)) n++
    }
    /** A photo that loses a project not its own: only what a sidecar says again. */
    const unlink = (row: PhotoRow): void => {
      this.store.setProject(row.id, null, null)
      row.project_path = null
      row.sidecar_mtime = -1
      if (this.syncSidecar(row)) n++
    }
    const orphans: { path: string; origin: Origin }[] = []
    for (const dir of projectDirsFor(folder, this.projectRoots())) {
      for (const path of projectFilesIn(dir)) {
        const origin = this.originOf(path)
        if (!origin) continue
        this.store.registerProject(path, origin.name, origin.size, origin.path)
        const row = byName.get(origin.name)
        if (!row || !isOriginOf(origin, row)) {
          // Not its photo, though of its name: the project stands for its own.
          if (row?.project_path === path) unlink(row)
          orphans.push({ path, origin })
          continue
        }
        if (claimed.has(row.id)) continue
        // A photo keeps the project it has while that is still there.
        if (row.project_path && row.project_path !== path && existsSync(row.project_path)) continue
        link(row, path)
      }
    }
    // Photos that moved away from their projects (in a projects folder).
    for (const row of photos) {
      if (claimed.has(row.id) || this.projectOf(row)) continue
      const found = this.store
        .projectsNamed(row.name, row.size)
        .find((c) => !taken.has(c.path) && existsSync(c.path) && !existsSync(c.origin_path))
      if (!found) continue
      this.projects.use(found.path, (p) => {
        const o = p.origin()
        if (o) p.setOrigin({ ...o, path: row.path })
      })
      this.store.registerProject(found.path, row.name, row.size, row.path)
      this.origins.delete(found.path)
      link(row, found.path)
    }
    // Projects whose photo is nowhere: one renamed in the folder is followed
    // (its project takes the new name); else each is its photo now.
    for (const { path, origin } of orphans) {
      if (taken.has(path)) continue
      const renamed = photos.find(
        (r) => !claimed.has(r.id) && !this.projectOf(r) && isRenamed(origin, r)
      )
      if (renamed) {
        this.projects.use(path, (p) =>
          p.setOrigin({ ...origin, name: renamed.name, path: renamed.path })
        )
        this.store.registerProject(path, renamed.name, renamed.size, renamed.path)
        this.origins.delete(path)
        link(renamed, path)
        continue
      }
      const elsewhere = this.store
        .photosWithProject(path)
        .some((r) => r.path !== path && existsSync(r.path))
      if (elsewhere) continue
      present.add(path)
      const row = this.store.upsertPhoto({
        path,
        folder,
        name: origin.name,
        ext: origin.ext,
        size: origin.size,
        mtime: origin.mtime,
        isRaw: origin.isRaw
      })
      link(row, path)
    }
    for (const row of photos) {
      if (!row.project_path || claimed.has(row.id) || existsSync(row.project_path)) continue
      // Its project went: the photo has only what a sidecar says again.
      this.store.setProject(row.id, null, null)
      row.project_path = null
      // Read again from the sidecar (or its absence): mark it unread.
      row.sidecar_mtime = -1
      if (this.syncSidecar(row)) n++
    }
    return n
  }

  /** The photo's project read into the index when it changed on disk. Returns whether it had. */
  private syncProject(row: PhotoRow): boolean {
    const path = this.projectOf(row)
    if (!path) return false
    const mtime = statSync(path).mtimeMs
    if (mtime === row.project_mtime) return false
    const truth = this.projects.use(path, (p) => p.read(row.is_raw === 1))
    this.mirror(row, truth, mtime, 'project')
    return true
  }

  /** Mirror whichever holds the photo's truth: its project, else its sidecar. */
  private syncTruth(row: PhotoRow): boolean {
    return this.projectOf(row) ? this.syncProject(row) : this.syncSidecar(row)
  }

  /** The image files in a folder, by name (for a RAW+JPEG pair's project names). */
  private imageNames(folder: string): string[] {
    try {
      return readdirSync(folder).filter((n) =>
        IMAGE_EXTENSIONS.includes(extname(n).slice(1).toLowerCase())
      )
    } catch {
      return []
    }
  }

  /**
   * Give a photo its project, holding `truth` (what its sidecar said, with the
   * change that called for a project): its recipes, copies, snapshots, rating
   * and stack, the edit history the index kept for it and its copies, and the
   * painted planes all of those name. Once the project is whole on disk the
   * sidecar and the index's history go: the project is the truth from here.
   */
  private createProject(row: PhotoRow, truth: Sidecar): string {
    const origin: Origin = {
      name: row.name,
      ext: row.ext,
      size: row.size,
      mtime: row.mtime,
      path: row.path,
      isRaw: row.is_raw === 1,
      sha1: knownHash(row)
    }
    const keys = [null, ...truth.copies.map((c) => c.id)].map((copyId) => ({
      copyId,
      key: keyOf(row.id, copyId)
    }))
    const fill = (p: PixlFile): void => {
      p.write(truth)
      for (const { copyId, key } of keys) {
        const rows = this.store.historyRows(key)
        if (rows.length === 0) continue
        p.importHistory(copyId, rows)
        for (const r of rows)
          for (const ref of refsIn(`${r.recipe} ${r.patch ?? ''}`)) {
            const png = this.store.plane(ref)
            if (png !== undefined) p.putPlane(ref, png)
          }
      }
    }
    const names = this.imageNames(row.folder)
    let path: string
    try {
      path = newProjectPath(row.path, this.location(), names)
      PixlFile.create(path, origin, fill).close()
    } catch (err) {
      // A folder that will not take it (a locked card): the projects folder will.
      if (this.location() !== 'beside') throw err
      path = newProjectPath(row.path, 'home', names)
      PixlFile.create(path, origin, fill).close()
    }
    for (const { key } of keys) this.store.removeHistory(key)
    const side = sidecarPath(row.path)
    if (existsSync(side)) unlinkSync(side)
    const mtime = statSync(path).mtimeMs
    this.store.setProject(row.id, path, mtime)
    this.store.setSidecarMtime(row.id, null)
    row.project_path = path
    row.project_mtime = mtime
    this.origins.delete(path)
    this.store.registerProject(path, row.name, row.size, row.path)
    this.mirror(row, truth, mtime, 'project')
    // Main makes the project's copy of the original (it has the engine).
    this.emit({ name: 'project', key: keyOf(row.id, null) })
    if (this.held.has(row.id)) this.projects.pin(path, true)
    return path
  }

  // ── the original, as the project carries it ──

  /**
   * The photo's row for reading its original. With a project, `seed_path` is
   * where the photo was when the project was made (a grain seed that
   * survives a move), and when the file itself is gone (moved, deleted, or a
   * project standing in for it) `embedded` is the project's own copy, written
   * out to the cache once.
   */
  sourceRow(key: string): PhotoRow {
    return this.withOriginal(this.row(key))
  }

  private withOriginal(row: PhotoRow): PhotoRow {
    const project = this.projectOf(row)
    if (!project) return row
    const out: PhotoRow = { ...row }
    const origin = this.originOf(project)
    if (origin) out.seed_path = origin.path
    if (row.path === project || !existsSync(row.path))
      out.embedded = this.writeOriginal(row, project)
    return out
  }

  /** The project's original written out to the photo's cache (once), or null when it has none yet. */
  private writeOriginal(row: PhotoRow, project: string): { path: string; codec: string } | null {
    return this.projects.use(project, (p) => {
      const o = p.original()
      if (o?.state !== 'ready' || !o.blob) return null
      const info = p.blob(o.blob)
      if (!info) return null
      const ext = o.kind === 'verbatim' ? row.ext : o.kind === 'dng' ? 'dng' : 'jxl'
      const dir = join(this.cacheRoot, 'photos', String(row.id))
      mkdirSync(dir, { recursive: true })
      const path = join(dir, `original-${o.blob.slice(0, 16)}.${ext}`)
      if (!existsSync(path) && !p.writeBlobTo(o.blob, path)) return null
      return { path, codec: info.codec }
    })
  }

  /**
   * What a photo's project carries of its original: nothing yet, being made,
   * or ready (and how). `project` null: the photo has no project.
   */
  originalState(key: string): {
    project: string | null
    state: 'none' | 'pending' | 'ready' | 'failed'
    kind: string | null
    bytes: number | null
  } {
    const row = this.row(key)
    const project = this.projectOf(row)
    if (!project) return { project: null, state: 'none', kind: null, bytes: null }
    return this.projects.use(project, (p) => {
      const o = p.original()
      if (!o) return { project, state: 'none' as const, kind: null, bytes: null }
      return {
        project,
        state: o.state,
        kind: o.kind,
        bytes: o.blob ? (p.blob(o.blob)?.bytes ?? null) : null
      }
    })
  }

  /**
   * Store the original in the photo's project: `file` (made by main, in the
   * cache) holds it as `kind` says. The project keeps it from here; `file` is
   * main's to remove.
   */
  putOriginal(
    key: string,
    file: string,
    kind: EmbeddedOriginal['kind'],
    info: { codec: string; width: number | null; height: number | null; note: string | null }
  ): void {
    const row = this.row(key)
    const project = this.projectOf(row)
    if (!project) return
    this.projects.use(project, (p) => {
      const hash = p.putBlobFile(file, {
        kind: 'original',
        codec: info.codec,
        width: info.width,
        height: info.height,
        channels: null,
        depth: null
      })
      const before = p.original()
      p.setOriginal({ kind, blob: hash, state: 'ready', note: info.note })
      if (before?.blob && before.blob !== hash) p.gc()
    })
    this.noteProjectWrite(key)
  }

  // ── blobs: pixel steps' images and masks ──

  /**
   * Keep a file (made by main, in the cache) in the photo's project, by its
   * content: a pixel step's image or mask. The photo gets its project if it
   * has none yet (a pixel step is an edit). Returns the blob's hash.
   */
  putBlob(
    key: string,
    file: string,
    info: { kind: string; codec: string; width: number | null; height: number | null }
  ): string {
    const project = this.ensureProject(this.row(key))
    const hash = this.projects.use(project, (p) =>
      p.putBlobFile(file, { ...info, channels: null, depth: null })
    )
    this.noteProjectWrite(key)
    return hash
  }

  /**
   * Write a blob of the photo's project out to the photo's cache (once):
   * `<cache>/photos/<id>/blobs/<hash>.<ext>`. Null when the project has no
   * such blob.
   */
  blobFile(key: string, hash: string, ext: string): string | null {
    const row = this.row(key)
    const project = this.projectOf(row)
    if (!project) return null
    const dir = join(this.cacheRoot, 'photos', String(row.id), 'blobs')
    const path = join(dir, `${hash}.${ext}`)
    if (existsSync(path)) return path
    mkdirSync(dir, { recursive: true })
    return this.projects.use(project, (p) => (p.writeBlobTo(hash, path) ? path : null))
  }

  /** The original could not be embedded: say why, so it is not tried on every open. */
  originalFailed(key: string, note: string): void {
    const project = this.projectOf(this.row(key))
    if (!project) return
    this.projects.use(project, (p) =>
      p.setOriginal({ kind: 'verbatim', blob: null, state: 'failed', note })
    )
    this.noteProjectWrite(key)
  }

  /** Make sure the photo has a project (made from its sidecar if not). Returns its path. */
  private ensureProject(row: PhotoRow): string {
    return (
      this.projectOf(row) ??
      this.createProject(row, readSidecar(row.path, row.is_raw === 1).sidecar)
    )
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

  /** Copy what the sidecar (or project) says into the index, and note the file's mtime. */
  private mirror(
    row: PhotoRow,
    sidecar: Sidecar,
    mtime: number | null,
    from: 'sidecar' | 'project' = 'sidecar'
  ): void {
    // One transaction: the photo's row, its copies and its stack change together.
    this.store.tx(() => this.mirrorRows(row, sidecar, mtime, from))
  }

  private mirrorRows(
    row: PhotoRow,
    sidecar: Sidecar,
    mtime: number | null,
    from: 'sidecar' | 'project'
  ): void {
    const raw = row.is_raw === 1
    const p = sidecar.photo
    this.store.setPhotoMeta(row.id, {
      rating: p.rating,
      flag: p.flag,
      label: p.label,
      edited: p.recipe !== null && isEdited(p.recipe, raw),
      recipeKey: thumbRecipeKey(p.recipe, raw)
    })
    this.store.replaceCopies(
      row.id,
      sidecar.copies.map((c) => ({
        id: c.id,
        name: c.name,
        rating: c.rating,
        flag: c.flag,
        label: c.label,
        edited: c.recipe !== null && isEdited(c.recipe, raw),
        recipeKey: thumbRecipeKey(c.recipe, raw)
      }))
    )
    this.store.setStack(row.id, sidecar.stack?.id ?? null, sidecar.stack?.position ?? null)
    if (from === 'project') {
      this.store.setProject(row.id, row.project_path, mtime)
      row.project_mtime = mtime
    } else this.store.setSidecarMtime(row.id, mtime)
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

  /**
   * Mirror the folder's `.xmp` sidecars that changed on disk (or went) into
   * the index; `changed` and `sources` when any did.
   */
  private async fillXmp(folder: string): Promise<void> {
    const changed = await this.xmpSerial(async () => {
      let n = 0
      let i = 0
      for (const row of this.store.photosIn(folder)) {
        // A stat each: a big folder yields between chunks, as the scan does.
        if (++i % CHUNK === 0) await nextTurn()
        if (this.closed) return n
        const file = xmpPathFor(row.path, row.is_raw === 1)
        let mtime: number | null = null
        try {
          mtime = statSync(file).mtimeMs
        } catch {
          // no sidecar
        }
        if (mtime === row.xmp_mtime) continue
        // Unreadable counts as empty until the file changes again.
        const meta = mtime === null ? emptyMeta() : ((await this.xmp.read(file)) ?? emptyMeta())
        if (this.closed) return n
        // Gone while its sidecar was read.
        if (!this.store.photo(row.id)) continue
        this.store.tx(() => this.store.setXmp(row.id, meta, meta.keywords, mtime))
        n++
      }
      return n
    })
    if (changed > 0 && !this.closed) {
      this.emit({ name: 'changed', folder })
      this.emit({ name: 'sources' })
    }
  }

  recentFolders(): string[] {
    return this.store.recentFolders().filter((f) => existsSync(f))
  }

  /**
   * Files (dropped, or handed over by the OS) as the folder of the first and
   * their items' keys, indexing any folder the index has not seen. A folder
   * given as the first path is that folder, with no keys.
   */
  async resolvePaths(paths: string[]): Promise<{ folder: string | null; keys: string[] }> {
    if (paths.length === 0) return { folder: null, keys: [] }
    // A project stands for its photo: the folder is the photo's (or, when
    // that is gone, the project's own), and the key the photo's.
    if (paths.some((p) => p.toLowerCase().endsWith(PIXL_EXT))) return this.resolveProjects(paths)
    const first = resolve(paths[0])
    let isDir = false
    try {
      isDir = statSync(first).isDirectory()
    } catch {
      // a file that is not there: its folder may still be
    }
    const folder = isDir ? first : dirname(first)
    await this.listFolder(folder)
    if (isDir) return { folder, keys: [] }
    const keys: string[] = []
    const scanned = new Set<string>()
    for (const p of paths.map((x) => resolve(x))) {
      let row = this.store.photoByPath(p)
      if (!row && !scanned.has(dirname(p))) {
        // New since the last scan, or in a folder never opened.
        scanned.add(dirname(p))
        await this.rescan(dirname(p), false)
        row = this.store.photoByPath(p)
      }
      if (row) keys.push(keyOf(row.id, null))
    }
    return { folder, keys }
  }

  private async resolveProjects(
    paths: string[]
  ): Promise<{ folder: string | null; keys: string[] }> {
    const projects = paths.map((p) => resolve(p)).filter((p) => p.toLowerCase().endsWith(PIXL_EXT))
    const origin = this.originOf(projects[0])
    if (!origin) return { folder: null, keys: [] }
    const home = dirname(origin.path)
    const folder = existsSync(home) ? home : dirname(projects[0])
    await this.rescan(folder, false)
    // A project beside a photo in another folder: that folder is looked at too.
    const keys: string[] = []
    for (const p of projects) {
      let rows = this.store.photosWithProject(p)
      if (rows.length === 0) {
        const o = this.originOf(p)
        if (o) await this.rescan(existsSync(dirname(o.path)) ? dirname(o.path) : dirname(p), false)
        rows = this.store.photosWithProject(p)
      }
      const row = rows.find((r) => existsSync(r.path)) ?? rows[0]
      if (row) keys.push(keyOf(row.id, null))
    }
    return { folder, keys }
  }

  // ── items ──

  /** Keywords and stack sizes for these rows, in a query or two whatever their number. */
  private contextFor(rows: PhotoRow[], bare = false): ListingContext {
    const stackIds = unique(rows.map((r) => r.stack_id).filter((s): s is string => !!s))
    return {
      keywords: this.store.keywordsFor(rows.map((r) => r.id)),
      stackSizes: stackIds.length > 0 ? this.store.stackSizes(stackIds) : new Map(),
      folderGone: new Map(),
      bare
    }
  }

  /**
   * Rows as items: each photo, then its copies. `keep` picks items by key
   * (a collection holds some copies and not their photo).
   */
  private itemsOf(rows: PhotoRow[], keep?: (key: string) => boolean, bare = false): LibraryItem[] {
    const ctx = this.contextFor(rows, bare)
    const copies = new Map<number, CopyRow[]>()
    for (const c of this.store.copiesOfPhotos(rows.map((r) => r.id))) {
      const list = copies.get(c.photo_id)
      if (list) list.push(c)
      else copies.set(c.photo_id, [c])
    }
    const out: LibraryItem[] = []
    for (const row of rows) {
      if (!keep || keep(keyOf(row.id, null))) out.push(this.itemFrom(row, undefined, ctx))
      for (const c of copies.get(row.id) ?? []) {
        if (!keep || keep(keyOf(row.id, c.copy_id))) out.push(this.itemFrom(row, c, ctx))
      }
    }
    return out
  }

  /**
   * A listing that spans folders checks each file, not only its folder: a
   * collection's photo may have been moved or deleted while its folder was
   * not being looked at.
   */
  private markMissing(items: LibraryItem[]): LibraryItem[] {
    const gone = new Map<string, boolean>()
    for (const it of items) {
      if (it.offline) continue
      let g = gone.get(it.path)
      if (g === undefined) {
        g = !existsSync(it.path)
        gone.set(it.path, g)
      }
      if (g) it.offline = true
    }
    return items
  }

  /** A folder's items: each photo, then its copies. A few queries, whatever the size. */
  items(folder: string): LibraryItem[] {
    return this.itemsOf(this.store.photosIn(folder))
  }

  /** Every item in the index, without thumbnails: what smart rules are evaluated over. */
  private allItems(): LibraryItem[] {
    return this.itemsOf(this.store.allPhotos(), undefined, true)
  }

  item(key: string): LibraryItem | undefined {
    const { photoId, copyId } = parseKey(key)
    const row = this.store.photo(photoId)
    if (!row) return undefined
    const ctx = this.contextFor([row])
    let it: LibraryItem | undefined
    if (copyId === null) it = this.itemFrom(row, undefined, ctx)
    else {
      const copy = this.store.copiesOf(row.id).find((c) => c.copy_id === copyId)
      it = copy ? this.itemFrom(row, copy, ctx) : undefined
    }
    return it && this.markMissing([it])[0]
  }

  itemsFor(keys: string[]): (LibraryItem | undefined)[] {
    return keys.map((k) => this.item(k))
  }

  /** These photos' items and their copies' (what a stack change touched). */
  private itemsOfPhotos(ids: Iterable<number>): LibraryItem[] {
    return this.itemsOf(this.store.photosByIds([...ids]))
  }

  private itemFrom(row: PhotoRow, copy: CopyRow | undefined, ctx: ListingContext): LibraryItem {
    const thumbPath = copy ? copy.thumb_path : row.thumb_path
    const thumbKey = copy ? copy.thumb_key : row.thumb_key
    let folderGone = ctx.folderGone.get(row.folder)
    if (folderGone === undefined) {
      folderGone = !existsSync(row.folder)
      ctx.folderGone.set(row.folder, folderGone)
    }
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
        thumbPath && !ctx.bare && existsSync(thumbPath)
          ? cacheUrlIn(this.cacheRoot, thumbPath, thumbKey ?? '')
          : null,
      unreadable: this.isFailed(row),
      ...(row.hdr_key === versionOf(row) ? { hdr: (row.hdr || null) as HdrKind | null } : {}),
      camera: row.camera_json ? (JSON.parse(row.camera_json) as CameraInfo) : emptyCamera(),
      folder: row.folder,
      title: row.title ?? null,
      caption: row.caption ?? null,
      copyright: row.copyright ?? null,
      keywords: ctx.keywords.get(row.id) ?? [],
      stack: row.stack_id
        ? {
            id: row.stack_id,
            position: row.stack_pos ?? 0,
            size: ctx.stackSizes.get(row.stack_id) ?? 1
          }
        : null,
      offline: folderGone,
      project: row.project_path ?? null
    }
  }

  // ── sources ──

  /** The items of a folder, a collection, a keyword (and every keyword under it) or the duplicates. */
  async listSource(src: LibrarySource): Promise<SourceListing> {
    switch (src.kind) {
      case 'folder':
        return { source: src, items: await this.listFolder(src.path) }
      case 'keyword': {
        const ids = this.store.photoIdsWithKeyword(normaliseKeyword(src.path))
        // Copies share their photo's keywords.
        return { source: src, items: this.markMissing(this.itemsOf(this.store.photosByIds(ids))) }
      }
      case 'collection':
        return { source: src, items: this.markMissing(this.collectionListing(src.id)) }
      case 'duplicates':
        return this.duplicates(src.folder, src.threshold)
      default:
        throw new Error(`unknown source ${(src as { kind: string }).kind}`)
    }
  }

  private collectionListing(id: string): LibraryItem[] {
    const c = this.store.collection(id)
    if (!c) throw new Error(`no collection ${id}`)
    if (c.kind === 'manual') {
      const entries = this.store.collectionItems(id)
      const want = new Set(entries.map((e) => keyOf(e.photo_id, e.copy_id || null)))
      const rows = this.store.photosByIds(unique(entries.map((e) => e.photo_id)))
      return this.itemsOf(rows, (k) => want.has(k))
    }
    const members = this.resolver(this.store.collections(), this.allItems())(id) ?? new Set()
    const ids = unique([...members].map((k) => parseKey(k).photoId))
    return this.itemsOf(this.store.photosByIds(ids), (k) => members.has(k))
  }

  /** Collection members over `items`: manual from the index, smart by rules, sets as unions. */
  private resolver(
    rows: CollectionRow[],
    items: LibraryItem[]
  ): (id: string) => Set<string> | undefined {
    const manual = new Map<string, Set<string>>()
    for (const e of this.store.allCollectionItems()) {
      const set = manual.get(e.collection_id) ?? new Set<string>()
      set.add(keyOf(e.photo_id, e.copy_id || null))
      manual.set(e.collection_id, set)
    }
    return memberResolver({
      collections: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        parent: r.parent,
        rules: this.rulesOf(r)
      })),
      items,
      manual: (id) => manual.get(id) ?? new Set(),
      now: new Date()
    })
  }

  private rulesOf(r: CollectionRow): SmartGroup | null {
    if (!r.rules) return null
    try {
      return JSON.parse(r.rules) as SmartGroup
    } catch {
      return null
    }
  }

  // ── keywords and descriptive metadata ──

  /** Every keyword as a tree, each node counting the photos with it or one under it. */
  keywordTree(): KeywordNode[] {
    const perPhoto = new Map<number, Set<string>>()
    for (const r of this.store.allKeywords()) {
      const set = perPhoto.get(r.photo_id) ?? new Set<string>()
      for (const p of keywordPrefixes(r.path)) set.add(p)
      perPhoto.set(r.photo_id, set)
    }
    const counts = new Map<string, number>()
    for (const set of perPhoto.values())
      for (const p of set) counts.set(p, (counts.get(p) ?? 0) + 1)
    const nodes = new Map<string, KeywordNode>()
    const roots: KeywordNode[] = []
    for (const path of [...counts.keys()].sort()) {
      const cut = path.lastIndexOf('|')
      const node: KeywordNode = {
        name: path.slice(cut + 1),
        path,
        count: counts.get(path) ?? 0,
        children: []
      }
      nodes.set(path, node)
      const parent = cut >= 0 ? nodes.get(path.slice(0, cut)) : undefined
      ;(parent ? parent.children : roots).push(node)
    }
    const order = (list: KeywordNode[]): void => {
      list.sort(
        (a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) ||
          (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
      )
      for (const n of list) order(n.children)
    }
    order(roots)
    return roots
  }

  /**
   * Edit title, caption, copyright or keywords. Metadata is the photo's (a
   * copy shows its photo's): each photo's `.xmp` is read, changed, written,
   * and mirrored into the index. Returns the items after.
   */
  async setMetadata(keys: string[], patch: MetaTextPatch): Promise<(LibraryItem | undefined)[]> {
    const ids = unique(keys.map((k) => parseKey(k).photoId))
    await this.xmpSerial(async () => {
      for (const id of ids) {
        const row = this.store.photo(id)
        if (!row) continue
        const file = xmpPathFor(row.path, row.is_raw === 1)
        const exists = existsSync(file)
        const current = exists
          ? ((await this.xmp.read(file)) ?? this.indexedMeta(row))
          : emptyMeta()
        const next = applyMetaPatch(current, patch)
        if (this.closed) return
        let mtime: number | null = null
        if (exists && sameMeta(current, next)) mtime = statSync(file).mtimeMs
        else if (exists || !metaIsEmpty(next)) {
          await this.xmp.write(file, next)
          mtime = statSync(file).mtimeMs
        }
        if (this.closed) return
        this.store.tx(() => this.store.setXmp(id, next, next.keywords, mtime))
      }
    })
    this.emit({ name: 'sources' })
    return this.itemsFor(keys)
  }

  /** What the index last read from a photo's `.xmp`. */
  private indexedMeta(row: PhotoRow): PhotoMeta {
    return {
      title: row.title,
      caption: row.caption,
      copyright: row.copyright,
      keywords: this.store.keywordsOf(row.id)
    }
  }

  // ── collections ──

  /** Every collection, with how many items each holds now. */
  collections(): Collection[] {
    const rows = this.store.collections()
    const needItems = rows.some((r) => r.kind !== 'manual')
    const members = this.resolver(rows, needItems ? this.allItems() : [])
    return rows.map((r) => ({ ...this.collectionOf(r), count: members(r.id)?.size ?? 0 }))
  }

  private collectionOf(r: CollectionRow): Collection {
    return {
      id: r.id,
      name: r.name,
      kind: r.kind,
      parent: r.parent,
      rules: r.kind === 'smart' ? (this.rulesOf(r) ?? { match: 'all', rules: [] }) : null,
      sort: r.sort
    }
  }

  /**
   * Create (no id) or change a collection. A collection sits at the top or
   * in a set, never inside itself; its kind is fixed once made.
   */
  saveCollection(c: Omit<Collection, 'id' | 'count'> & { id?: string }): Collection {
    if (!['manual', 'smart', 'set'].includes(c.kind))
      throw new Error(`bad collection kind ${c.kind}`)
    const name = String(c.name ?? '').trim()
    if (!name) throw new Error('a collection needs a name')
    const existing = c.id ? this.store.collection(c.id) : undefined
    if (existing && existing.kind !== c.kind) throw new Error('a collection cannot change kind')
    const id = existing?.id ?? c.id ?? newId()
    const parent = c.parent ?? null
    if (parent !== null) {
      const p = this.store.collection(parent)
      if (!p || p.kind !== 'set') throw new Error('a collection can only sit in a set')
      // Walk up from the new parent: meeting this collection would make a loop.
      for (let at: CollectionRow | undefined = p; at;) {
        if (at.id === id) throw new Error('a set cannot sit inside itself')
        at = at.parent ? this.store.collection(at.parent) : undefined
      }
    }
    const rules = c.kind === 'smart' ? (c.rules ?? { match: 'all', rules: [] }) : null
    const row = {
      id,
      name,
      kind: c.kind,
      parent,
      rules: rules ? JSON.stringify(rules) : null,
      sort: Number.isFinite(c.sort) ? c.sort : 0
    }
    this.store.saveCollection(row)
    this.emit({ name: 'sources' })
    return this.collectionOf({ ...row, created_at: '' })
  }

  /** Remove a collection (a set's children move to the top; photos are untouched). */
  removeCollection(id: string): void {
    this.store.tx(() => this.store.removeCollection(id))
    this.emit({ name: 'sources' })
  }

  /** Add items to, or take them out of, a manual collection. */
  collectionItems(id: string, keys: string[], action: 'add' | 'remove'): void {
    const c = this.store.collection(id)
    if (!c) throw new Error(`no collection ${id}`)
    if (c.kind !== 'manual') throw new Error('only a manual collection holds items')
    this.store.tx(() => {
      for (const key of keys) {
        const { photoId, copyId } = parseKey(key)
        if (action === 'remove') this.store.removeCollectionItem(id, photoId, copyId ?? '')
        else if (this.store.photo(photoId)) this.store.addCollectionItem(id, photoId, copyId ?? '')
      }
    })
    this.emit({ name: 'sources' })
  }

  /**
   * Collections as a file: their definitions (a set with everything in it)
   * and a manual collection's items by path, so they survive another index.
   */
  exportCollections(ids: string[]): CollectionsFile {
    const rows = this.store.collections()
    const want = new Set<string>()
    const add = (id: string): void => {
      if (want.has(id)) return
      want.add(id)
      for (const r of rows) if (r.parent === id) add(r.id)
    }
    for (const id of ids) if (rows.some((r) => r.id === id)) add(id)
    return {
      app: 'pixl-playroom',
      kind: 'collections',
      version: 1,
      collections: rows
        .filter((r) => want.has(r.id))
        .map((r) => {
          const c = this.collectionOf(r)
          const out: CollectionsFile['collections'][number] = {
            id: c.id,
            name: c.name,
            kind: c.kind,
            // A parent left out of the file puts this one at the top.
            parent: c.parent !== null && want.has(c.parent) ? c.parent : null,
            rules: c.rules,
            sort: c.sort
          }
          if (r.kind === 'manual') {
            const entries = this.store.collectionItems(r.id)
            const paths = new Map(
              this.store
                .photosByIds(unique(entries.map((e) => e.photo_id)))
                .map((p) => [p.id, p.path])
            )
            out.items = entries
              .filter((e) => paths.has(e.photo_id))
              .map((e) => ({ path: paths.get(e.photo_id) as string, copyId: e.copy_id || null }))
          }
          return out
        })
    }
  }

  /**
   * Collections from a file: an id already taken gets a new one (and what
   * refers to it follows), items are found by path (their folders indexed
   * if new), and what cannot be found is left out. Returns what was added.
   */
  async importCollections(file: unknown): Promise<Collection[]> {
    const f = file as Partial<CollectionsFile> | null
    if (
      !f ||
      f.app !== 'pixl-playroom' ||
      f.kind !== 'collections' ||
      !Array.isArray(f.collections)
    )
      throw new Error('not a Pixl Playroom collections file')
    type Def = CollectionsFile['collections'][number]
    const defs = f.collections.filter(
      (c): c is Def =>
        !!c && typeof c.id === 'string' && ['manual', 'smart', 'set'].includes(c.kind)
    )
    const ids = new Map<string, string>()
    for (const c of defs) {
      ids.set(c.id, this.store.collection(c.id) || ids.has(c.id) ? newId() : c.id)
    }
    // Index the folders of paths the index does not know yet.
    const folders = new Set<string>()
    for (const c of defs) {
      for (const it of c.items ?? []) {
        if (typeof it?.path === 'string' && !this.store.photoByPath(it.path))
          folders.add(dirname(it.path))
      }
    }
    for (const folder of folders) if (existsSync(folder)) await this.rescan(folder, false)

    // Parents first, so every parent exists when its child is saved.
    const byOld = new Map(defs.map((c) => [c.id, c]))
    const depth = (c: Def): number => {
      let d = 0
      for (let at = c; at.parent && byOld.has(at.parent) && d < defs.length; d++) {
        at = byOld.get(at.parent) as Def
      }
      return d
    }
    const added: Collection[] = []
    this.store.tx(() => {
      for (const c of [...defs].sort((a, b) => depth(a) - depth(b))) {
        const id = ids.get(c.id) as string
        const parentId = c.parent ? (ids.get(c.parent) ?? c.parent) : null
        const parent = parentId ? this.store.collection(parentId) : undefined
        const rules =
          c.kind === 'smart' && c.rules
            ? remapCollections(c.rules, (old) => ids.get(old) ?? old)
            : null
        const row = {
          id,
          name: String(c.name ?? 'Collection'),
          kind: c.kind,
          parent: parent?.kind === 'set' ? parent.id : null,
          rules: rules ? JSON.stringify(rules) : null,
          sort: typeof c.sort === 'number' ? c.sort : 0
        }
        this.store.saveCollection(row)
        if (c.kind === 'manual') {
          for (const it of c.items ?? []) {
            const photo = typeof it?.path === 'string' ? this.store.photoByPath(it.path) : undefined
            if (!photo) continue
            const copyId = typeof it.copyId === 'string' && it.copyId ? it.copyId : ''
            if (copyId && !this.store.copiesOf(photo.id).some((x) => x.copy_id === copyId)) continue
            this.store.addCollectionItem(id, photo.id, copyId)
          }
        }
        added.push(this.collectionOf({ ...row, created_at: '' }))
      }
    })
    this.emit({ name: 'sources' })
    return added
  }

  // ── stacks ──

  /** Set or clear a photo's stack in its sidecar (and so the index). */
  private setStackOf(row: PhotoRow, stack: SidecarStack | null): void {
    this.updateRow(row, (s) => {
      s.stack = stack
    })
  }

  /** A stack's members numbered 0… again in their order; one left alone is no stack. */
  private renumber(stackId: string, touched: Set<number>): void {
    const members = this.store.stackMembers(stackId)
    for (const [i, m] of members.entries()) {
      this.setStackOf(m, members.length < 2 ? null : { id: stackId, position: i })
      touched.add(m.id)
    }
  }

  /**
   * Stack photos of one folder (the cover's), the cover on top and the rest
   * in the order given. A photo already in another stack leaves it. Returns
   * the items whose stack changed (copies included).
   */
  stack(keys: string[], coverKey: string): LibraryItem[] {
    const cover = this.row(coverKey)
    const ids = unique([cover.id, ...keys.map((k) => parseKey(k).photoId)])
    const rows = ids
      .map((id) => this.store.photo(id))
      .filter((r): r is PhotoRow => !!r && r.folder === cover.folder)
    if (rows.length < 2) return []
    const id = newId()
    const touched = new Set<number>()
    this.store.tx(() => {
      const left = unique(rows.map((r) => r.stack_id).filter((s): s is string => !!s))
      rows.forEach((r, i) => {
        this.setStackOf(r, { id, position: i })
        touched.add(r.id)
      })
      for (const old of left) this.renumber(old, touched)
    })
    return this.itemsOfPhotos(touched)
  }

  /** Undo the stacks these items are in, whole. Returns the items that changed. */
  unstack(keys: string[]): LibraryItem[] {
    const touched = new Set<number>()
    this.store.tx(() => {
      const ids = unique(keys.map((k) => this.store.photo(parseKey(k).photoId)?.stack_id))
      for (const stackId of ids) {
        if (!stackId) continue
        for (const m of this.store.stackMembers(stackId)) {
          this.setStackOf(m, null)
          touched.add(m.id)
        }
      }
    })
    return this.itemsOfPhotos(touched)
  }

  /** Make this photo its stack's cover; the others keep their order. */
  stackTop(key: string): LibraryItem[] {
    const row = this.row(key)
    const stackId = row.stack_id
    if (!stackId) return []
    const touched = new Set<number>()
    this.store.tx(() => {
      const members = this.store.stackMembers(stackId)
      const order = [row, ...members.filter((m) => m.id !== row.id)]
      order.forEach((m, i) => {
        this.setStackOf(m, { id: stackId, position: i })
        touched.add(m.id)
      })
    })
    return this.itemsOfPhotos(touched)
  }

  /**
   * Stack the folder's unstacked photos taken in bursts: runs with no more
   * than `seconds` between one capture and the next, two or more long, the
   * first as cover. Returns how many stacks were made.
   */
  autoStack(folder: string, seconds = 3): number {
    const timed = this.store
      .photosIn(folder)
      .filter((r) => !r.stack_id && r.captured_at)
      .map((r) => ({ r, t: new Date(r.captured_at as string).getTime() }))
      .filter((x) => Number.isFinite(x.t))
      .sort((a, b) => a.t - b.t || a.r.name.localeCompare(b.r.name))
    const runs: PhotoRow[][] = []
    let run: PhotoRow[] = []
    let last = -Infinity
    for (const { r, t } of timed) {
      if (t - last > seconds * 1000 && run.length > 0) {
        runs.push(run)
        run = []
      }
      run.push(r)
      last = t
    }
    if (run.length > 0) runs.push(run)
    const made = runs.filter((g) => g.length >= 2)
    if (made.length === 0) return 0
    this.store.tx(() => {
      for (const g of made) {
        const id = newId()
        g.forEach((r, i) => this.setStackOf(r, { id, position: i }))
      }
    })
    this.emit({ name: 'changed', folder })
    return made.length
  }

  // ── duplicates ──

  /**
   * Photos whose picture hash is missing or older than their thumbnail, for
   * the main process to hash (it has the engine). No thumbnail: a null path.
   */
  dhashWork(folder: string | null): { photoId: number; thumbPath: string | null }[] {
    return this.store
      .photosInScope(folder)
      .filter((r) => !(r.dhash && r.thumb_key && r.dhash_key === r.thumb_key))
      .filter((r) => !this.isFailed(r) && existsSync(r.path))
      .map((r) => ({
        photoId: r.id,
        thumbPath: r.thumb_path && existsSync(r.thumb_path) ? r.thumb_path : null
      }))
  }

  /** A photo's picture hash, of its thumbnail with this stamp. */
  setDhash(photoId: number, hash: string, thumbKey: string): void {
    this.store.setDhash(photoId, hash, thumbKey)
  }

  /**
   * Exact duplicates (same size, same SHA-1; hashed only when the size is
   * shared, and kept until the file changes) and then near ones (thumbnail
   * dHashes within `threshold` bits), in `folder` or the whole library. An
   * exact group counts once among the near ones, so identical files never
   * make a near group on their own.
   */
  async duplicates(folder: string | null, threshold = 6): Promise<SourceListing> {
    const source: LibrarySource = { kind: 'duplicates', folder, threshold }
    const exact = new Map<string, PhotoRow[]>()
    for (const row of this.store.photosSharingSize(folder)) {
      let hash = row.hash_key === hashKeyOf(row) ? row.content_hash : null
      if (!hash) {
        if (!existsSync(row.path)) continue
        try {
          hash = await sha1(row.path)
        } catch {
          continue
        }
        if (this.closed) return { source, items: [], groups: [] }
        // Gone while it was read.
        if (!this.store.photo(row.id)) continue
        this.store.setContentHash(row.id, hash, hashKeyOf(row))
      }
      const k = `${row.size}:${hash}`
      const list = exact.get(k)
      if (list) list.push(row)
      else exact.set(k, [row])
    }
    const groups: DuplicateGroup[] = []
    /** An exact group's members: true for the one standing in for it among the near. */
    const standIn = new Map<number, boolean>()
    for (const rows of exact.values()) {
      if (rows.length < 2) continue
      groups.push({ kind: 'exact', keys: rows.map((r) => keyOf(r.id, null)) })
      rows.forEach((r, i) => standIn.set(r.id, i === 0))
    }
    const entries = this.store
      .photosInScope(folder)
      .filter((r) => r.dhash && r.dhash_key === r.thumb_key && standIn.get(r.id) !== false)
      .map((r) => ({ key: keyOf(r.id, null), hash: r.dhash as string }))
    for (const g of groupNear(entries, threshold)) {
      groups.push({ kind: 'near', keys: g.keys, distance: g.distance })
    }
    const order = unique(groups.flatMap((g) => g.keys))
    const rows = this.store.photosByIds(order.map((k) => parseKey(k).photoId))
    const byKey = new Map(this.itemsOf(rows, (k) => !k.includes(':')).map((it) => [it.key, it]))
    const items = order.map((k) => byKey.get(k)).filter((x): x is LibraryItem => !!x)
    return { source, items: this.markMissing(items), groups }
  }

  // ── sidecar-backed state ──

  row(key: string): PhotoRow {
    const row = this.store.photo(parseKey(key).photoId)
    if (!row) throw new Error(`no photo ${key}`)
    return row
  }

  /** What the photo's truth says: its project's, else its sidecar's. */
  private sidecar(row: PhotoRow): Sidecar {
    const project = this.projectOf(row)
    if (project) return this.projects.use(project, (p) => p.read(row.is_raw === 1))
    return readSidecar(row.path, row.is_raw === 1).sidecar
  }

  recipe(key: string): Recipe {
    const row = this.row(key)
    const it = itemOf(this.sidecar(row), parseKey(key).copyId)
    return it?.recipe ?? defaultRecipe(row.is_raw === 1)
  }

  /** A key's recipe with its planes by reference: its project's one item, or its sidecar's, slimmed. */
  private slimRecipeOf(key: string): Recipe {
    const row = this.row(key)
    const raw = row.is_raw === 1
    const project = this.projectOf(row)
    const r = project
      ? this.projects.use(project, (p) => p.itemRecipe(itemKeyOf(parseKey(key).copyId), raw))
      : (itemOf(readSidecar(row.path, raw).sidecar, parseKey(key).copyId)?.recipe ?? null)
    return r ? slimRecipe(r) : defaultRecipe(raw)
  }

  recipes(keys: string[]): { key: string; row: PhotoRow; recipe: Recipe }[] {
    return keys.map((key) => ({ key, row: this.row(key), recipe: this.recipe(key) }))
  }

  openData(key: string): OpenData {
    const row = this.row(key)
    const item = this.item(key)
    if (!item) throw new Error(`no item ${key}`)
    // The project's painted planes, where the rest of the app looks for them
    // (its history names them by reference).
    const project = this.projectOf(row)
    if (project)
      this.projects.use(project, (p) =>
        this.store.tx(() => {
          for (const { ref, png } of p.planes()) this.store.putPlane(ref, png)
        })
      )
    const it = itemOf(this.sidecar(row), parseKey(key).copyId)
    return {
      row: this.withOriginal(row),
      recipe: it?.recipe ?? defaultRecipe(row.is_raw === 1),
      item,
      snapshots: it?.snapshots ?? []
    }
  }

  /**
   * Change a photo's truth and keep the index in step: in its project, or in
   * its sidecar. A change that `needsProject` says calls for one (the first
   * real edit) makes the photo's project, so a rating alone never does.
   */
  private update(
    key: string,
    change: (s: Sidecar) => void,
    needsProject?: (s: Sidecar) => boolean
  ): Sidecar {
    return this.updateRow(this.row(key), change, needsProject)
  }

  private updateRow(
    row: PhotoRow,
    change: (s: Sidecar) => void,
    needsProject?: (s: Sidecar) => boolean
  ): Sidecar {
    const raw = row.is_raw === 1
    const project = this.projectOf(row)
    if (project) {
      const truth = this.projects.use(project, (p) => {
        // By reference: what the change leaves alone goes back as it was.
        const s = p.read(raw, false)
        change(s)
        p.write(s)
        return s
      })
      this.mirror(row, truth, statSync(project).mtimeMs, 'project')
      return truth
    }
    const { sidecar } = readSidecar(row.path, raw)
    change(sidecar)
    if (needsProject?.(sidecar)) {
      this.createProject(row, sidecar)
      return sidecar
    }
    const mtime = writeSidecar(row.path, sidecar)
    this.mirror(row, sidecar, mtime)
    return sidecar
  }

  saveRecipe(key: string, recipe: Recipe): void {
    const { copyId } = parseKey(key)
    const raw = this.row(key).is_raw === 1
    this.update(
      key,
      (s) => {
        const it = itemOf(s, copyId)
        if (it) it.recipe = isEdited(recipe, raw) || copyId !== null ? recipe : null
      },
      (s) => itemOf(s, copyId)?.recipe != null
    )
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
    this.update(
      key,
      (s) => {
        s.copies.push({
          id,
          name: `Copy ${s.copies.length + 1}`,
          rating: 0,
          flag: null,
          label: null,
          recipe: structuredClone(source),
          snapshots: []
        })
      },
      () => true
    )
    const item = this.item(keyOf(photoId, id))
    if (!item) throw new Error(`copy of ${key} was not recorded`)
    return item
  }

  deleteCopy(key: string): void {
    const { photoId, copyId } = parseKey(key)
    if (copyId === null) return
    this.update(key, (s) => {
      s.copies = s.copies.filter((c) => c.id !== copyId)
    })
    this.store.removeCopyFromCollections(photoId, copyId)
  }

  saveSnapshots(key: string, snapshots: Snapshot[]): void {
    const { copyId } = parseKey(key)
    this.update(
      key,
      (s) => {
        const it = itemOf(s, copyId)
        if (it) it.snapshots = snapshots
      },
      () => snapshots.length > 0
    )
  }

  // ── thumbnails ──

  /** The thumbnail to render for an item, or null when the one it has is current (or it cannot be read). */
  thumbJob(photoId: number, copyId: string | null): ThumbWork | null {
    const row = this.store.photo(photoId)
    if (!row || this.isFailed(row)) return null
    const existing =
      copyId === null ? row : this.store.copiesOf(row.id).find((c) => c.copy_id === copyId)
    if (!existing) return null
    // The recipe's key as last mirrored (every change to it mirrors): whether
    // the thumbnail is current needs no file read. A row from before it was
    // kept asks the slim recipe, from the one item.
    const key = keyOf(row.id, copyId)
    const raw = row.is_raw === 1
    const recipeKey = existing.recipe_key ?? thumbRecipeKey(this.slimRecipeOf(key), raw)
    const stamp = `${versionStamp(row)}-${recipeKey}`
    if (existing.thumb_key === stamp && existing.thumb_path && existsSync(existing.thumb_path))
      return null
    const edited = recipeKey !== 'plain'
    return { row: this.withOriginal(row), recipe: this.recipe(key), edited, stamp }
  }

  setThumb(photoId: number, copyId: string | null, path: string, stamp: string): void {
    // The one it replaces goes from the disk (each version has its own name).
    const was =
      copyId === null
        ? this.store.photo(photoId)?.thumb_path
        : this.store.copiesOf(photoId).find((c) => c.copy_id === copyId)?.thumb_path
    this.store.setThumb(photoId, copyId, path, stamp)
    if (was && was !== path) rmSync(was, { force: true })
    // The photo's thumbnail is its project's preview too (what a file browser could show).
    const row = this.store.photo(photoId)
    const project = row && copyId === null ? this.projectOf(row) : null
    if (!project || !row) return
    try {
      const jpeg = readFileSync(path)
      const size = jpegSize(jpeg)
      this.projects.use(project, (p) => p.setPreview(jpeg, size?.width ?? 0, size?.height ?? 0))
      this.store.setProject(row.id, project, statSync(project).mtimeMs)
    } catch (err) {
      console.warn('project preview not saved', project, (err as Error).message)
    }
  }

  /** What kind of HDR a file version is ('' none), from its probe. */
  setHdr(photoId: number, kind: string): void {
    const row = this.store.photo(photoId)
    if (row) this.store.setHdr(photoId, kind, versionOf(row))
  }

  /** Once per version of the file: one that cannot be read is not tried again until it changes. */
  markFailed(photoId: number, reason: string): void {
    const row = this.store.photo(photoId)
    if (!row) return
    this.failed.set(versionOf(row), reason)
    // Kept: the next launch does not try this version again.
    this.store.setFailed(photoId, versionOf(row), reason)
  }

  // ── history ──

  /**
   * Run `fn` on the history that holds `key`'s: its project's (under the
   * item's key there), else the index's.
   */
  private inHistory<T>(
    key: string,
    project: (p: PixlFile, itemKey: string) => T,
    index: () => T
  ): T {
    const path = this.projectOf(this.row(key))
    if (!path) return index()
    const out = this.projects.use(path, (p) => project(p, itemKeyOf(parseKey(key).copyId)))
    this.noteProjectWrite(key)
    return out
  }

  /** A project written: its new mtime noted, so the next scan does not read it back. */
  private noteProjectWrite(key: string): void {
    const row = this.row(key)
    if (row.project_path && existsSync(row.project_path))
      this.store.setProject(row.id, row.project_path, statSync(row.project_path).mtimeMs)
  }

  history(key: string): HistoryLog {
    // A read: no write to note (its mtime stays the one the index knows).
    const path = this.projectOf(this.row(key))
    if (!path) return this.store.history(key)
    return this.projects.use(path, (p) => p.history.history(itemKeyOf(parseKey(key).copyId)))
  }

  /**
   * Record a settled edit. A photo's first real step (past the "Opened"
   * base) makes its project, and the history moves into it.
   */
  appendHistory(key: string, label: string, recipe: Recipe): HistoryLog {
    const row = this.row(key)
    if (!this.projectOf(row)) {
      const log = this.store.appendHistory(key, label, recipe)
      if (log.steps.length === 0) return log
      this.ensureProject(row)
      return this.history(key)
    }
    return this.inHistory(
      key,
      (p, k) => this.appendIn(p, k, label, recipe),
      () => this.store.appendHistory(key, label, recipe)
    )
  }

  private appendIn(p: PixlFile, itemKey: string, label: string, recipe: Recipe): HistoryLog {
    const log = p.history.append(itemKey, label, recipe)
    // The planes it names go into the project with it.
    for (const ref of refsIn(JSON.stringify(recipe))) {
      if (p.hasPlane(ref)) continue
      const png = this.store.plane(ref)
      if (png !== undefined) p.putPlane(ref, png)
    }
    return log
  }

  /**
   * A settled edit: its history step (`step`, planes by reference) and the
   * recipe the photo now has (`recipe`, whole) written together, so a crash
   * never leaves the history ahead of the saved recipe, which the next open
   * would record as where the photo stands.
   */
  commitEdit(key: string, label: string, step: Recipe, recipe: Recipe): HistoryLog {
    const row = this.row(key)
    const path = this.projectOf(row)
    if (!path) {
      const log = this.store.appendHistory(key, label, step)
      // The "Opened" base only records what is saved already.
      if (log.steps.length === 0) return log
      // A real edit makes the project, which takes the index's history with it.
      this.saveRecipe(key, recipe)
      this.ensureProject(this.row(key))
      return this.history(key)
    }
    const log = this.projects.use(path, (p) =>
      p.tx(() => {
        this.saveRecipe(key, recipe)
        return this.appendIn(p, itemKeyOf(parseKey(key).copyId), label, step)
      })
    )
    this.noteProjectWrite(key)
    return log
  }

  setHistoryHidden(key: string, seqs: number[], hidden: boolean): HistoryLog {
    return this.inHistory(
      key,
      (p, k) => p.history.setHidden(k, seqs, hidden),
      () => this.store.setHistoryHidden(key, seqs, hidden)
    )
  }

  deleteHistory(key: string, seqs: number[]): HistoryLog {
    return this.inHistory(
      key,
      (p, k) => {
        const log = p.history.delete(k, seqs)
        p.gc()
        return log
      },
      () => this.store.deleteHistory(key, seqs)
    )
  }

  /** Where the photo's project is, if it has one (for Reveal). */
  projectPath(key: string): string | null {
    return this.projectOf(this.row(key))
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
  /**
   * Drop the thumbnails in `dir` no photo or copy names any more (made for a
   * recipe since changed, before a replaced one was deleted with it), an hour
   * old at least so one being written now is not taken. Returns how many went.
   */
  pruneThumbs(dir: string): number {
    const named = this.store.thumbPaths()
    const now = Date.now()
    let n = 0
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      return 0
    }
    for (const name of names) {
      const file = join(dir, name)
      if (named.has(file)) continue
      try {
        if (now - statSync(file).mtimeMs < 60 * 60 * 1000) continue
        unlinkSync(file)
        n++
      } catch {
        // Gone already, or not ours to take.
      }
    }
    return n
  }

  prunePlanes(): number {
    // Those stored since the index opened are in use (a stroke not yet in a
    // step, an open project's planes): kept, so this can run after start.
    const keep = new Set<string>(this.store.planesPut)
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
