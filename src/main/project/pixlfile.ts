/**
 * A `.pixl` project: one photo's edits in one file — its recipe, virtual
 * copies, snapshots, rating, flag, label and stack (what a sidecar holds), its
 * whole edit history, the painted mask planes all of those name (binary, as
 * blobs named by their SHA-256), a preview, the original itself and stored
 * pixel results.
 *
 * The file is a SQLite database, so it is written transactionally (a crash
 * never leaves half an edit), readable by any SQLite tool, and documented in
 * docs/pixl-format.md. It always uses a rollback journal, never WAL: a
 * project sits beside photos in folders that are copied, synced and backed
 * up, and must never leave `-wal`/`-shm` files beside it. Only the index
 * process opens projects; see `ProjectPool` for how it keeps them.
 */
import { t } from '../../shared/i18n'
import { createHash } from 'crypto'
import { createReadStream } from 'fs'
import { open as openFile } from 'fs/promises'
import { setImmediate as yieldTurn } from 'timers/promises'
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync
} from 'fs'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { dirname } from 'path'
import type { ColorLabel, Flag, Snapshot } from '../../shared/ipc'
import { parseRawColour } from '../../shared/rawcolour'
import { readNames } from '../../shared/naming'
import { hydrateRecipe, normaliseRecipe, slimRecipe, type Recipe } from '../../shared/recipe'
import { HISTORY_SCHEMA, HistoryTable, type HistoryRow } from '../historytable'
import { planeRef, pngSize, renameRefs } from '../planeref'
import type { Sidecar, SidecarItem, SidecarStack } from '../sidecar'

export const PIXL_EXT = '.pixl'
/** `PRAGMA application_id`: "PIXL". */
export const PIXL_APPLICATION_ID = 0x5049584c
/**
 * The format's version (`meta.format_version`, and `PRAGMA user_version`).
 * 2: painted planes are binary blobs named by their SHA-256 (1 kept them as
 * base64 text in `planes`, by a 32-bit hash); a version-1 file is upgraded
 * when it is opened.
 */
export const PIXL_FORMAT_VERSION = 2

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS origin (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  ext TEXT NOT NULL,
  size INTEGER NOT NULL,
  mtime REAL NOT NULL,
  path TEXT NOT NULL,
  is_raw INTEGER NOT NULL,
  sha1 TEXT
);
CREATE TABLE IF NOT EXISTS items (
  item_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL,
  rating INTEGER NOT NULL DEFAULT 0,
  flag TEXT,
  label TEXT,
  recipe TEXT,
  snapshots TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);
${HISTORY_SCHEMA}
CREATE TABLE IF NOT EXISTS preview (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  jpeg BLOB NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS original (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  kind TEXT NOT NULL,
  blob TEXT,
  state TEXT NOT NULL,
  note TEXT
);
CREATE TABLE IF NOT EXISTS blobs (
  hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  codec TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  channels INTEGER,
  depth INTEGER,
  bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS blob_chunks (
  hash TEXT NOT NULL,
  idx INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (hash, idx)
);
`

/** The photo a project was made from, as it was then. */
export interface Origin {
  name: string
  ext: string
  size: number
  mtime: number
  /** Where it was when the project was made (or last linked). */
  path: string
  isRaw: boolean
  sha1: string | null
}

/** Make a directory's entries (a rename into it) durable. Not every platform can (Windows). */
export function syncDir(dir: string): void {
  let fd: number | undefined
  try {
    fd = openSync(dir, 'r')
    fsyncSync(fd)
  } catch {
    // A directory that cannot be opened or synced: the rename stands as it is.
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

/** Blobs are stored in chunks of this many bytes. */
export const BLOB_CHUNK = 4 * 1024 * 1024

export interface BlobInfo {
  /** SHA-256 of the bytes, hex. */
  hash: string
  /** What it is: `original`, and later `pixels`, `mask`… */
  kind: string
  /** How the bytes are encoded: `jpeg`, `jxl`, `jxl-jpeg` (a bit-exact JPEG repack), `dng`, `raw`, `png`, `tiff`… */
  codec: string
  width: number | null
  height: number | null
  channels: number | null
  depth: number | null
  bytes: number
}

/**
 * The original carried inside the project. `kind` is how: `verbatim` (its own
 * bytes), `dng` (a RAW as lossless DNG), `jxl-jpeg` (a JPEG repacked into JPEG
 * XL, bit-exact and reversible), `jxl-lossless` (PNG, TIFF). `state` is
 * `pending` while it is being made and `ready` once `blob` holds it.
 */
export interface EmbeddedOriginal {
  kind: 'verbatim' | 'dng' | 'jxl-jpeg' | 'jxl-lossless'
  blob: string | null
  state: 'pending' | 'ready' | 'failed'
  note: string | null
}

/** The SHA-256 of a file, hex, read in pieces. */
export function sha256File(file: string): string {
  const h = createHash('sha256')
  const fd = openSync(file, 'r')
  try {
    const buf = Buffer.alloc(1024 * 1024)
    for (
      let n = readSync(fd, buf, 0, buf.length, null);
      n > 0;
      n = readSync(fd, buf, 0, buf.length, null)
    )
      h.update(buf.subarray(0, n))
  } finally {
    closeSync(fd)
  }
  return h.digest('hex')
}

/** The SHA-256 of a file, hex, read as a stream (the process keeps answering meanwhile). */
export async function sha256FileAsync(file: string): Promise<string> {
  const h = createHash('sha256')
  for await (const chunk of createReadStream(file, { highWaterMark: 1024 * 1024 }))
    h.update(chunk as Buffer)
  return h.digest('hex')
}

/** Blobs being written in pieces in this process: `gc` leaves their chunks alone. */
const writing = new Set<string>()

/**
 * Store a file as a blob without holding up the process for it: hashed as a
 * stream, its chunks written one at a time (each its own write through `use`,
 * the process free between them), the `blobs` row last, so a reader never
 * sees a blob without all its bytes. `onProject` runs a write on the project
 * (the pool may reopen it between pieces). A blob already there is not stored
 * again. Returns its hash.
 */
export async function putBlobFileInPieces(
  onProject: <T>(fn: (p: PixlFile) => T) => T,
  file: string,
  info: Omit<BlobInfo, 'hash' | 'bytes'>
): Promise<string> {
  const hash = await sha256FileAsync(file)
  if (onProject((p) => p.blob(hash)) || writing.has(hash)) return hash
  writing.add(hash)
  const fd = await openFile(file, 'r')
  try {
    const { size } = await fd.stat()
    // Pieces of an earlier try that never finished.
    onProject((p) => p.prepare('DELETE FROM blob_chunks WHERE hash = ?').run(hash))
    const buf = Buffer.alloc(Math.min(BLOB_CHUNK, Math.max(1, size)))
    for (let idx = 0, at = 0; at < size || idx === 0; idx++) {
      const { bytesRead } = await fd.read(buf, 0, buf.length, at)
      onProject((p) =>
        p
          .prepare('INSERT INTO blob_chunks(hash, idx, data) VALUES (?, ?, ?)')
          .run(hash, idx, buf.subarray(0, bytesRead))
      )
      at += bytesRead
      if (bytesRead === 0) break
      await yieldTurn()
    }
    onProject((p) =>
      p
        .prepare(
          `INSERT OR IGNORE INTO blobs(hash, kind, codec, width, height, channels, depth, bytes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          hash,
          info.kind,
          info.codec,
          info.width,
          info.height,
          info.channels,
          info.depth,
          size,
          new Date().toISOString()
        )
    )
  } finally {
    await fd.close()
    writing.delete(hash)
  }
  return hash
}

/** The blob hashes a JSON text names (`"blob":"<sha256>"`, `"alpha":"<sha256>"`). */
export function blobsIn(json: string): string[] {
  return [...json.matchAll(/"(?:blob|alpha)":"([0-9a-f]{64})"/g)].map((m) => m[1])
}

/** The photo's own item; a virtual copy's id otherwise. */
const PHOTO = ''

/** History item keys inside a project: '' for the photo, a copy's id for a copy. */
export const itemKeyOf = (copyId: string | null): string => copyId ?? PHOTO

/** The plane references a JSON text (a recipe, a patch) names. */
export function refsIn(json: string): string[] {
  return [...json.matchAll(/"ref":"([^"]+)"/g)].map((m) => m[1])
}

class NotAProject extends Error {
  constructor(path: string) {
    super(t('{{path}} is not a Pixl project', { path }))
    this.name = 'NotAProject'
  }
}

export class PixlFile {
  readonly path: string
  readonly history: HistoryTable
  private readonly db: DatabaseSync
  private readonly statements = new Map<string, StatementSync>()
  private depth = 0
  private closed = false
  /** A batch is open: writes wait for `commitBatch` (see ProjectPool.write). */
  private batch = false

  private constructor(path: string, db: DatabaseSync) {
    this.path = path
    this.db = db
    // Every open: a rollback journal (never WAL), every commit on disk. On
    // macOS an fsync only reaches the drive's cache: F_FULLFSYNC (fullfsync)
    // is what makes a commit survive power loss, affordable now that commits
    // are batched (ProjectPool.write). A sync client or a second app reading
    // it is waited for, not failed on.
    db.exec(
      'PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; PRAGMA fullfsync = ON; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;'
    )
    this.history = new HistoryTable({
      prepare: (sql) => this.prepare(sql),
      tx: (fn) => this.tx(fn)
    })
  }

  /**
   * A new project at `path` for `origin`. It is built under a temporary name
   * and renamed into place, so `path` either does not exist or is a whole
   * project. Fails if `path` exists.
   */
  static create(path: string, origin: Origin, fill?: (p: PixlFile) => void): PixlFile {
    if (existsSync(path)) throw new Error(t('{{path}} already exists', { path }))
    const tmp = `${path}.creating-${process.pid}`
    if (existsSync(tmp)) unlinkSync(tmp)
    const db = new DatabaseSync(tmp)
    // Page size and auto-vacuum only take before the first table.
    db.exec(
      `PRAGMA page_size = 16384; PRAGMA auto_vacuum = INCREMENTAL;
       PRAGMA application_id = ${PIXL_APPLICATION_ID}; PRAGMA user_version = ${PIXL_FORMAT_VERSION};`
    )
    db.exec(SCHEMA)
    const file = new PixlFile(tmp, db)
    try {
      file.tx(() => {
        const now = new Date().toISOString()
        file.setMeta('format', 'pixl-project')
        file.setMeta('format_version', String(PIXL_FORMAT_VERSION))
        file.setMeta('created_at', now)
        file.setMeta('created_by', 'Pixl Playroom')
        file.setOrigin(origin)
        file
          .prepare('INSERT INTO items(item_id, name, sort, updated_at) VALUES (?, ?, 0, ?)')
          .run(PHOTO, origin.name, now)
        fill?.(file)
      })
    } catch (err) {
      file.close()
      unlinkSync(tmp)
      throw err
    }
    file.close()
    renameSync(tmp, path)
    // The rename on disk before anything it replaces (the sidecar, the
    // index's history) is deleted: a crash then finds one or the other.
    syncDir(dirname(path))
    return PixlFile.open(path)
  }

  /** Open an existing project; refuses a file that is not one, or is from a newer format. */
  static open(path: string): PixlFile {
    const db = new DatabaseSync(path)
    try {
      const id = (db.prepare('PRAGMA application_id').get() as { application_id: number })
        .application_id
      if (id !== PIXL_APPLICATION_ID) throw new NotAProject(path)
      const v = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
      if (v > PIXL_FORMAT_VERSION)
        throw new Error(
          t('{{path}} was made by a newer Pixl Playroom (format {{format}})', { path, format: v })
        )
      // Tables a later minor version adds are made on open.
      db.exec(SCHEMA)
      const file = new PixlFile(path, db)
      if (v < PIXL_FORMAT_VERSION) file.upgrade(v)
      return file
    } catch (err) {
      db.close()
      throw err
    }
  }

  /**
   * A file from an older version brought up to this one, in one transaction.
   * 1 → 2: each plane in `planes` becomes a blob named by its SHA-256, and
   * every recipe, snapshot and history row naming it by its old name names
   * it by the new one.
   */
  private upgrade(from: number): void {
    this.tx(() => {
      const hasPlanes =
        this.prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'planes'"
        ).get() !== undefined
      if (from < 2 && hasPlanes) {
        const names = new Map<string, string>()
        for (const { ref, png } of this.prepare('SELECT ref, png FROM planes').all() as {
          ref: string
          png: string
        }[]) {
          const hash = planeRef(png)
          names.set(ref, hash)
          this.putPlane(hash, png)
        }
        if (names.size > 0) {
          const items = this.prepare('SELECT item_id, recipe, snapshots FROM items').all() as {
            item_id: string
            recipe: string | null
            snapshots: string
          }[]
          const setItem = this.prepare(
            'UPDATE items SET recipe = ?, snapshots = ? WHERE item_id = ?'
          )
          for (const it of items) {
            const recipe = it.recipe && renameRefs(it.recipe, names)
            const snapshots = renameRefs(it.snapshots, names)
            if (recipe !== it.recipe || snapshots !== it.snapshots)
              setItem.run(recipe, snapshots, it.item_id)
          }
          const rows = this.prepare('SELECT item_key, seq, recipe, patch FROM history').all() as {
            item_key: string
            seq: number
            recipe: string
            patch: string | null
          }[]
          const setRow = this.prepare(
            'UPDATE history SET recipe = ?, patch = ? WHERE item_key = ? AND seq = ?'
          )
          for (const r of rows) {
            const recipe = renameRefs(r.recipe, names)
            const patch = r.patch && renameRefs(r.patch, names)
            if (recipe !== r.recipe || patch !== r.patch)
              setRow.run(recipe, patch, r.item_key, r.seq)
          }
        }
        this.db.exec('DROP TABLE planes')
      }
      this.setMeta('format_version', String(PIXL_FORMAT_VERSION))
      this.db.exec(`PRAGMA user_version = ${PIXL_FORMAT_VERSION}`)
    })
  }

  /** The photo a project names, read without keeping it open; null for a file that is not one. */
  static peekOrigin(path: string): Origin | null {
    try {
      const f = PixlFile.open(path)
      try {
        return f.origin()
      } finally {
        f.close()
      }
    } catch {
      return null
    }
  }

  close(): void {
    this.statements.clear()
    // Our own flag: `DatabaseSync.isOpen` is newer than some Node 22 builds.
    if (this.closed) return
    // Whatever a batch holds is committed, not lost with the connection.
    this.commitBatch()
    this.closed = true
    this.db.close()
  }

  /**
   * Give up to `pages` free pages back to the disk (16 KiB each). Returns
   * whether more are left: a large blob's pages go back over several steps,
   * not in one long write.
   */
  vacuumStep(pages = 256): boolean {
    this.db.exec(`PRAGMA incremental_vacuum(${pages})`)
    const { freelist_count } = this.prepare('PRAGMA freelist_count').get() as {
      freelist_count: number
    }
    return freelist_count > 0
  }

  /** Whether writes are being gathered into one transaction. */
  get batching(): boolean {
    return this.batch
  }

  /**
   * Gather the writes that follow into one transaction, until `commitBatch`:
   * a commit (and its fsyncs) for many edits. Each `tx` inside it is a
   * savepoint, so one that fails still undoes only itself.
   */
  beginBatch(): void {
    if (this.batch || this.depth > 0 || this.closed) return
    this.db.exec('BEGIN IMMEDIATE')
    this.batch = true
  }

  /** Commit the batch (nothing when none is open). A failed commit rolls it back and throws. */
  commitBatch(): void {
    if (!this.batch) return
    this.batch = false
    try {
      this.db.exec('COMMIT')
    } catch (err) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        // Already rolled back by SQLite.
      }
      throw err
    }
  }

  prepare(sql: string): StatementSync {
    let st = this.statements.get(sql)
    if (!st) {
      st = this.db.prepare(sql)
      this.statements.set(sql, st)
    }
    return st
  }

  tx<T>(fn: () => T): T {
    // Inside another transaction (or a batch): a savepoint, so this one
    // still commits or fails as a whole.
    if (this.depth > 0 || this.batch) {
      const sp = `tx${this.depth}`
      this.depth++
      this.db.exec(`SAVEPOINT ${sp}`)
      try {
        const out = fn()
        this.db.exec(`RELEASE ${sp}`)
        return out
      } catch (err) {
        this.db.exec(`ROLLBACK TO ${sp}`)
        this.db.exec(`RELEASE ${sp}`)
        throw err
      } finally {
        this.depth--
      }
    }
    this.depth = 1
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const out = fn()
      this.db.exec('COMMIT')
      return out
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    } finally {
      this.depth = 0
    }
  }

  // ── meta and origin ──

  meta(key: string): string | undefined {
    const row = this.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      { value: string } | undefined
    return row?.value
  }

  setMeta(key: string, value: string | null): void {
    if (value === null) this.prepare('DELETE FROM meta WHERE key = ?').run(key)
    else
      this.prepare(
        'INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      ).run(key, value)
  }

  origin(): Origin | null {
    const r = this.prepare('SELECT * FROM origin WHERE id = 1').get() as
      | {
          name: string
          ext: string
          size: number
          mtime: number
          path: string
          is_raw: number
          sha1: string | null
        }
      | undefined
    if (!r) return null
    return {
      name: r.name,
      ext: r.ext,
      size: r.size,
      mtime: r.mtime,
      path: r.path,
      isRaw: r.is_raw === 1,
      sha1: r.sha1
    }
  }

  setOrigin(o: Origin): void {
    this.prepare(
      `INSERT INTO origin(id, name, ext, size, mtime, path, is_raw, sha1) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, ext = excluded.ext, size = excluded.size,
         mtime = excluded.mtime, path = excluded.path, is_raw = excluded.is_raw, sha1 = excluded.sha1`
    ).run(o.name, o.ext, o.size, o.mtime, o.path, o.isRaw ? 1 : 0, o.sha1)
  }

  // ── what a sidecar holds ──

  /**
   * The project's items as a sidecar holds them: recipes with their planes
   * filled in, or (`hydrate` false, to change and write back) by reference.
   */
  /** One item's recipe (null when it has none), planes by reference unless `hydrate`. */
  itemRecipe(itemId: string, isRaw: boolean, hydrate = false): Recipe | null {
    const row = this.prepare('SELECT recipe FROM items WHERE item_id = ?').get(itemId) as
      { recipe: string | null } | undefined
    if (!row?.recipe) return null
    const r = JSON.parse(row.recipe) as Recipe
    return normaliseRecipe(hydrate ? hydrateRecipe(r, (ref) => this.plane(ref)) : r, isRaw)
  }

  read(isRaw: boolean, hydrate = true): Sidecar {
    const rows = this.prepare('SELECT * FROM items ORDER BY sort, item_id').all() as {
      item_id: string
      name: string
      rating: number
      flag: string | null
      label: string | null
      recipe: string | null
      snapshots: string
    }[]
    const plane = (ref: string): string | undefined => this.plane(ref)
    const recipeOf = (json: string): Recipe => {
      const r = JSON.parse(json) as Recipe
      return normaliseRecipe(hydrate ? hydrateRecipe(r, plane) : r, isRaw)
    }
    const itemOf = (r: (typeof rows)[number]): SidecarItem => ({
      rating: r.rating,
      flag: (r.flag as Flag) ?? null,
      label: (r.label as ColorLabel) ?? null,
      recipe: r.recipe ? recipeOf(r.recipe) : null,
      snapshots: (JSON.parse(r.snapshots) as Snapshot[]).map((s) => ({
        ...s,
        recipe: recipeOf(JSON.stringify(s.recipe))
      }))
    })
    const photo = rows.find((r) => r.item_id === PHOTO)
    const stack = this.meta('stack')
    return {
      app: 'pixl-playroom',
      version: 1,
      photo: photo
        ? itemOf(photo)
        : { rating: 0, flag: null, label: null, recipe: null, snapshots: [] },
      copies: rows
        .filter((r) => r.item_id !== PHOTO)
        .map((r) => ({ ...itemOf(r), id: r.item_id, name: r.name })),
      stack: stack ? (JSON.parse(stack) as SidecarStack) : null,
      rawColour: parseRawColour(this.meta('rawColour')),
      names: readNames(this.meta('names')),
      cullKeep: this.meta('cullKeep') === '1'
    }
  }

  /**
   * Write what a sidecar holds: every item (copies gone from it are removed),
   * the stack. Recipes may carry their planes or name them; a named plane the
   * project lacks is taken from `planeOf` (the index's store).
   */
  write(s: Sidecar, planeOf?: (ref: string) => string | undefined): void {
    this.tx(() => {
      const now = new Date().toISOString()
      // A plane already stored is not handed to SQLite again (megabytes of PNG each).
      const slim = (r: Recipe): Recipe =>
        slimRecipe(r, planeRef, (ref, png) => {
          if (!this.hasPlane(ref)) this.putPlane(ref, png)
        })
      // Only the items that changed are written: a rating or one copy's edit
      // does not rewrite every item and snapshot.
      const existing = new Map(
        (
          this.prepare(
            'SELECT item_id, name, sort, rating, flag, label, recipe, snapshots FROM items'
          ).all() as {
            item_id: string
            name: string
            sort: number
            rating: number
            flag: string | null
            label: string | null
            recipe: string | null
            snapshots: string
          }[]
        ).map((r) => [r.item_id, r])
      )
      const put = this.prepare(
        `INSERT INTO items(item_id, name, sort, rating, flag, label, recipe, snapshots, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(item_id) DO UPDATE SET name = excluded.name, sort = excluded.sort,
           rating = excluded.rating, flag = excluded.flag, label = excluded.label,
           recipe = excluded.recipe, snapshots = excluded.snapshots, updated_at = excluded.updated_at`
      )
      const row = (id: string, name: string, sort: number, it: SidecarItem): void => {
        const recipe = it.recipe ? JSON.stringify(slim(it.recipe)) : null
        const snapshots = JSON.stringify(
          it.snapshots.map((sn) => ({ ...sn, recipe: slim(sn.recipe) }))
        )
        const was = existing.get(id)
        if (
          was &&
          was.name === name &&
          was.sort === sort &&
          was.rating === it.rating &&
          was.flag === (it.flag ?? null) &&
          was.label === (it.label ?? null) &&
          was.recipe === recipe &&
          was.snapshots === snapshots
        )
          return
        put.run(id, name, sort, it.rating, it.flag, it.label, recipe, snapshots, now)
        for (const ref of refsIn(`${recipe ?? ''} ${snapshots}`)) {
          if (this.hasPlane(ref)) continue
          const png = planeOf?.(ref)
          if (png !== undefined) this.putPlane(ref, png)
        }
      }
      row(PHOTO, this.origin()?.name ?? '', 0, s.photo)
      s.copies.forEach((c, i) => row(c.id, c.name, i + 1, c))
      const keep = new Set([PHOTO, ...s.copies.map((c) => c.id)])
      for (const item_id of existing.keys()) {
        if (keep.has(item_id)) continue
        this.prepare('DELETE FROM items WHERE item_id = ?').run(item_id)
        this.history.remove(item_id)
      }
      this.setMeta('stack', s.stack ? JSON.stringify(s.stack) : null)
      this.setMeta('rawColour', s.rawColour ?? null)
      this.setMeta('names', s.names ? JSON.stringify(s.names) : null)
      this.setMeta('cullKeep', s.cullKeep ? '1' : null)
    })
  }

  // ── history, planes, preview ──

  /** History rows moved in from elsewhere (the index, before the photo had a project). */
  importHistory(copyId: string | null, rows: HistoryRow[]): void {
    this.history.remove(itemKeyOf(copyId))
    this.history.insertRows(itemKeyOf(copyId), rows)
  }

  /** Keep a painted plane (a base64 PNG) as a blob named `ref`, its SHA-256 (`planeRef`). */
  putPlane(ref: string, png: string): void {
    if (this.hasPlane(ref)) return
    const bytes = Buffer.from(png, 'base64')
    const size = pngSize(bytes)
    this.putBlobBytes(ref, bytes, {
      kind: 'plane',
      codec: 'png',
      width: size?.width ?? null,
      height: size?.height ?? null,
      channels: 1,
      depth: 8
    })
  }

  hasPlane(ref: string): boolean {
    return this.prepare('SELECT 1 FROM blobs WHERE hash = ?').get(ref) !== undefined
  }

  /** A plane as a base64 PNG, or undefined when the project has none by that name. */
  plane(ref: string): string | undefined {
    const info = this.blob(ref)
    if (info?.kind !== 'plane') return undefined
    return this.blobBytes(ref).toString('base64')
  }

  *planes(): Generator<{ ref: string; png: string }> {
    for (const { hash } of this.prepare("SELECT hash FROM blobs WHERE kind = 'plane'").all() as {
      hash: string
    }[])
      yield { ref: hash, png: this.blobBytes(hash).toString('base64') }
  }

  /** A blob's bytes, whole (for small ones: planes). */
  private blobBytes(hash: string): Buffer {
    const parts = (
      this.prepare('SELECT data FROM blob_chunks WHERE hash = ? ORDER BY idx').all(hash) as {
        data: Uint8Array
      }[]
    ).map((r) => r.data)
    return Buffer.concat(parts)
  }

  /** Store bytes already in memory as the blob `hash`, in chunks. */
  private putBlobBytes(
    hash: string,
    bytes: Uint8Array,
    info: Omit<BlobInfo, 'hash' | 'bytes'>
  ): void {
    this.tx(() => {
      const put = this.prepare('INSERT INTO blob_chunks(hash, idx, data) VALUES (?, ?, ?)')
      for (let idx = 0, at = 0; at < bytes.length || idx === 0; idx++, at += BLOB_CHUNK)
        put.run(hash, idx, bytes.subarray(at, Math.min(bytes.length, at + BLOB_CHUNK)))
      this.prepare(
        `INSERT INTO blobs(hash, kind, codec, width, height, channels, depth, bytes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        hash,
        info.kind,
        info.codec,
        info.width,
        info.height,
        info.channels,
        info.depth,
        bytes.length,
        new Date().toISOString()
      )
    })
  }

  // ── blobs: large binaries, by content (the original; later, pixel results) ──

  blob(hash: string): BlobInfo | null {
    const r = this.prepare('SELECT * FROM blobs WHERE hash = ?').get(hash) as
      | {
          hash: string
          kind: string
          codec: string
          width: number | null
          height: number | null
          channels: number | null
          depth: number | null
          bytes: number
        }
      | undefined
    return r
      ? {
          hash: r.hash,
          kind: r.kind,
          codec: r.codec,
          width: r.width,
          height: r.height,
          channels: r.channels,
          depth: r.depth,
          bytes: r.bytes
        }
      : null
  }

  /**
   * Store a file as a blob, by its SHA-256, in chunks of `BLOB_CHUNK` (one is
   * never read whole into memory, and a sync service diffs pages, not the
   * project). A blob already there is not stored again. Returns its hash.
   */
  putBlobFile(file: string, info: Omit<BlobInfo, 'hash' | 'bytes'>): string {
    const hash = sha256File(file)
    if (this.blob(hash)) return hash
    const size = statSync(file).size
    const fd = openSync(file, 'r')
    try {
      this.tx(() => {
        const put = this.prepare('INSERT INTO blob_chunks(hash, idx, data) VALUES (?, ?, ?)')
        const buf = Buffer.alloc(Math.min(BLOB_CHUNK, Math.max(1, size)))
        for (let idx = 0, at = 0; at < size; idx++) {
          const n = readSync(fd, buf, 0, buf.length, at)
          put.run(hash, idx, buf.subarray(0, n))
          at += n
        }
        this.prepare(
          `INSERT INTO blobs(hash, kind, codec, width, height, channels, depth, bytes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          hash,
          info.kind,
          info.codec,
          info.width,
          info.height,
          info.channels,
          info.depth,
          size,
          new Date().toISOString()
        )
      })
    } finally {
      closeSync(fd)
    }
    return hash
  }

  /** Write a blob out to `file` (whole, or not at all). False when there is no such blob. */
  writeBlobTo(hash: string, file: string): boolean {
    if (!this.blob(hash)) return false
    const tmp = `${file}.part-${process.pid}`
    const fd = openSync(tmp, 'w')
    try {
      for (const { data } of this.prepare(
        'SELECT data FROM blob_chunks WHERE hash = ? ORDER BY idx'
      ).iterate(hash) as Iterable<{ data: Uint8Array }>)
        writeSync(fd, data)
    } finally {
      closeSync(fd)
    }
    renameSync(tmp, file)
    return true
  }

  removeBlob(hash: string): void {
    this.tx(() => {
      this.prepare('DELETE FROM blob_chunks WHERE hash = ?').run(hash)
      this.prepare('DELETE FROM blobs WHERE hash = ?').run(hash)
    })
  }

  // ── the original, embedded ──

  /** The embedded original, if the project carries one (or is making it). */
  original(): EmbeddedOriginal | null {
    const r = this.prepare('SELECT kind, blob, state, note FROM original WHERE id = 1').get() as
      { kind: string; blob: string | null; state: string; note: string | null } | undefined
    return r
      ? {
          kind: r.kind as EmbeddedOriginal['kind'],
          blob: r.blob,
          state: r.state as EmbeddedOriginal['state'],
          note: r.note
        }
      : null
  }

  setOriginal(o: EmbeddedOriginal): void {
    this.prepare(
      `INSERT INTO original(id, kind, blob, state, note) VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, blob = excluded.blob,
         state = excluded.state, note = excluded.note`
    ).run(o.kind, o.blob, o.state, o.note)
  }

  setPreview(jpeg: Uint8Array, width: number, height: number): void {
    this.prepare(
      `INSERT INTO preview(id, width, height, jpeg, updated_at) VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET width = excluded.width, height = excluded.height,
         jpeg = excluded.jpeg, updated_at = excluded.updated_at`
    ).run(width, height, jpeg, new Date().toISOString())
  }

  /**
   * Drop what nothing refers to: planes no recipe, snapshot or history step
   * names, and other blobs nothing names. The freed pages go back to the disk
   * with `vacuumStep`, a little at a time. Returns how many planes went.
   */
  gc(): number {
    const keep = new Set<string>()
    for (const r of this.prepare('SELECT recipe, snapshots FROM items').all() as {
      recipe: string | null
      snapshots: string
    }[]) {
      for (const ref of refsIn(`${r.recipe ?? ''} ${r.snapshots}`)) keep.add(ref)
    }
    for (const json of this.history.json()) for (const ref of refsIn(json)) keep.add(ref)
    // Blobs nothing names: neither the original nor (later) a pixel step.
    const named = new Set<string>()
    const o = this.original()
    if (o?.blob) named.add(o.blob)
    for (const json of this.history.json()) for (const h of blobsIn(json)) named.add(h)
    // Snapshots keep their steps' pixels as recipes do.
    for (const r of this.prepare('SELECT recipe, snapshots FROM items').all() as {
      recipe: string | null
      snapshots: string
    }[])
      for (const h of blobsIn(`${r.recipe ?? ''} ${r.snapshots}`)) named.add(h)
    // One stored a moment ago may be on its way into a recipe (a step being
    // committed): only those older than an hour are fair game.
    const fresh = new Date(Date.now() - 3600_000).toISOString()
    let removed = 0
    this.tx(() => {
      for (const b of this.prepare('SELECT hash, kind, created_at FROM blobs').all() as {
        hash: string
        kind: string
        created_at: string
      }[]) {
        // A plane goes as soon as nothing names it; it is written with what names it.
        if (b.kind === 'plane') {
          if (keep.has(b.hash)) continue
          removed++
        } else if (named.has(b.hash) || b.created_at >= fresh) continue
        this.removeBlob(b.hash)
      }
    })
    // Chunks no blob row owns: a write cut short (not one under way now).
    for (const { hash } of this.prepare(
      'SELECT DISTINCT hash FROM blob_chunks WHERE hash NOT IN (SELECT hash FROM blobs)'
    ).all() as { hash: string }[]) {
      if (writing.has(hash)) continue
      this.prepare('DELETE FROM blob_chunks WHERE hash = ?').run(hash)
    }
    return removed
  }
}

/** What a project file is on disk right now: changed under us when this differs from last time. */
export function fileStamp(path: string): string | null {
  try {
    const st = statSync(path)
    return `${st.ino}:${st.size}:${st.mtimeMs}`
  } catch {
    return null
  }
}

/** How long a project's writes are gathered before they are committed together. */
export const BATCH_MS = 250

/**
 * The index's open projects. Each stays open while it is in use and closes
 * after a moment idle (`IDLE_MS`), so the file sits quiet and whole for
 * Finder, backups and sync. One the disk changed under (synced in, replaced,
 * restored) is reopened, never written through a stale handle.
 *
 * Writes (`write`) are gathered per project: the first opens a transaction,
 * and everything written in the next BATCH_MS (a slider's steps, the recipe
 * saved with each, the preview) commits with it, once. A crash loses at most
 * that window. Closing, dropping, `flush` and quitting commit at once.
 */
export class ProjectPool {
  private readonly open = new Map<
    string,
    {
      file: PixlFile
      stamp: string | null
      timer: ReturnType<typeof setTimeout> | null
      commit: ReturnType<typeof setTimeout> | null
    }
  >()
  private readonly idleMs: number
  private readonly batchMs: number
  /** Told after a batch is committed (the file's mtime has moved on). */
  private readonly onCommit: (path: string) => void
  /** The stamp each project was left at by this pool's own last use (kept after it closes). */
  private readonly own = new Map<string, string | null>()
  /** Projects kept open while idle (the photo open in Develop): its statements stay prepared. */
  private readonly pinned = new Set<string>()

  constructor(idleMs = 2000, onCommit: (path: string) => void = () => {}, batchMs = BATCH_MS) {
    this.idleMs = idleMs
    this.onCommit = onCommit
    this.batchMs = batchMs
  }

  /** Run `fn` on the project at `path`, to read it (or to write at once). */
  use<T>(path: string, fn: (p: PixlFile) => T): T {
    let e = this.open.get(path)
    // A project mid-batch holds the write lock: no other writer can have
    // changed it, and pages it spilled may have moved its stamp.
    if (e && !e.file.batching && e.stamp !== fileStamp(path)) {
      this.drop(path)
      e = undefined
    }
    if (!e) {
      e = { file: PixlFile.open(path), stamp: null, timer: null, commit: null }
      this.open.set(path, e)
    }
    if (e.timer) clearTimeout(e.timer)
    try {
      return fn(e.file)
    } finally {
      e.stamp = fileStamp(path)
      this.own.set(path, e.stamp)
      e.timer = this.pinned.has(path) ? null : this.idleTimer(path)
    }
  }

  /** Run `fn`, which writes, on the project: its writes join the batch committed within BATCH_MS. */
  write<T>(path: string, fn: (p: PixlFile) => T): T {
    return this.use(path, (p) => {
      if (!p.batching) {
        p.beginBatch()
        const e = this.open.get(path)!
        e.commit = setTimeout(() => this.commit(path), this.batchMs)
        e.commit.unref?.()
      }
      return fn(p)
    })
  }

  /** Whether the pool has the project open. */
  isOpen(path: string): boolean {
    return this.open.has(path)
  }

  /** Commit a project's batch now (one project, or all). */
  flush(path?: string): void {
    for (const p of [...this.open.keys()]) if (path === undefined || p === path) this.commit(p)
  }

  private commit(path: string): void {
    const e = this.open.get(path)
    if (!e) return
    if (e.commit) clearTimeout(e.commit)
    e.commit = null
    if (!e.file.batching) return
    try {
      e.file.commitBatch()
    } catch (err) {
      console.warn('project batch not committed', path, (err as Error).message)
    }
    e.stamp = fileStamp(path)
    this.own.set(path, e.stamp)
    this.onCommit(path)
  }

  private idleTimer(path: string): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => this.drop(path), this.idleMs)
    timer.unref?.()
    return timer
  }

  /** Keep a project open while idle (`on`), or let it close after its idle time again. */
  pin(path: string, on: boolean): void {
    const e = this.open.get(path)
    if (on) {
      this.pinned.add(path)
      if (e?.timer) clearTimeout(e.timer)
      if (e) e.timer = null
    } else if (this.pinned.delete(path) && e && !e.timer) {
      e.timer = this.idleTimer(path)
    }
  }

  /** Whether a project's file is as this pool last left it (its own writes, not another's). */
  leftAs(path: string, stamp: string | null): boolean {
    return this.own.has(path) && this.own.get(path) === stamp
  }

  /** Close one project (before it is moved or replaced), or all. */
  drop(path?: string): void {
    for (const [p, e] of [...this.open]) {
      if (path !== undefined && p !== path) continue
      this.commit(p)
      if (e.timer) clearTimeout(e.timer)
      e.file.close()
      this.open.delete(p)
    }
  }
}

/** A JPEG's pixel size, from its first frame header; null when it is not one. */
export function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null
    const marker = b[i + 1]
    const len = (b[i + 2] << 8) | b[i + 3]
    // SOF0…SOF15, but not DHT (C4), JPG (C8) or DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
      return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] }
    i += 2 + len
  }
  return null
}
