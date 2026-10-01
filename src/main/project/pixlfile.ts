/**
 * A `.pixl` project: one photo's edits in one file — its recipe, virtual
 * copies, snapshots, rating, flag, label and stack (what a sidecar holds), its
 * whole edit history, the painted mask planes all of those name, and a
 * preview. Later versions add the original itself and stored pixel results
 * (tables `original`, `blobs`, `blob_chunks`, already here and empty).
 *
 * The file is a SQLite database, so it is written transactionally (a crash
 * never leaves half an edit), readable by any SQLite tool, and documented in
 * docs/pixl-format.md. It always uses a rollback journal, never WAL: a
 * project sits beside photos in folders that are copied, synced and backed
 * up, and must never leave `-wal`/`-shm` files beside it. Only the index
 * process opens projects; see `ProjectPool` for how it keeps them.
 */
import { existsSync, renameSync, statSync, unlinkSync } from 'fs'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import type { ColorLabel, Flag, Snapshot } from '../../shared/ipc'
import { hydrateRecipe, normaliseRecipe, slimRecipe, type Recipe } from '../../shared/recipe'
import { HISTORY_SCHEMA, HistoryTable, type HistoryRow } from '../historytable'
import type { Sidecar, SidecarItem, SidecarStack } from '../sidecar'

export const PIXL_EXT = '.pixl'
/** `PRAGMA application_id`: "PIXL". */
export const PIXL_APPLICATION_ID = 0x5049584c
/** The format's version (`meta.format_version`, and `PRAGMA user_version`). */
export const PIXL_FORMAT_VERSION = 1

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
CREATE TABLE IF NOT EXISTS planes (ref TEXT PRIMARY KEY, png TEXT NOT NULL);
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
    super(`${path} is not a Pixl project`)
    this.name = 'NotAProject'
  }
}

export class PixlFile {
  readonly path: string
  readonly history: HistoryTable
  private readonly db: DatabaseSync
  private readonly statements = new Map<string, StatementSync>()
  private depth = 0

  private constructor(path: string, db: DatabaseSync) {
    this.path = path
    this.db = db
    // Every open: a rollback journal (never WAL), every commit on disk.
    db.exec('PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;')
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
    if (existsSync(path)) throw new Error(`${path} already exists`)
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
        throw new Error(`${path} was made by a newer Pixl Playroom (format ${v})`)
      // Tables a later minor version adds are made on open; nothing is ever dropped.
      db.exec(SCHEMA)
    } catch (err) {
      db.close()
      throw err
    }
    return new PixlFile(path, db)
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
    if (this.db.isOpen) this.db.close()
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
    if (this.depth > 0) {
      this.depth++
      try {
        return fn()
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
      stack: stack ? (JSON.parse(stack) as SidecarStack) : null
    }
  }

  /** Write what a sidecar holds: every item (copies gone from it are removed), the stack. */
  write(s: Sidecar): void {
    this.tx(() => {
      const now = new Date().toISOString()
      const slim = (r: Recipe): Recipe => slimRecipe(r, (ref, png) => this.putPlane(ref, png))
      const put = this.prepare(
        `INSERT INTO items(item_id, name, sort, rating, flag, label, recipe, snapshots, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(item_id) DO UPDATE SET name = excluded.name, sort = excluded.sort,
           rating = excluded.rating, flag = excluded.flag, label = excluded.label,
           recipe = excluded.recipe, snapshots = excluded.snapshots, updated_at = excluded.updated_at`
      )
      const row = (id: string, name: string, sort: number, it: SidecarItem): void => {
        put.run(
          id,
          name,
          sort,
          it.rating,
          it.flag,
          it.label,
          it.recipe ? JSON.stringify(slim(it.recipe)) : null,
          JSON.stringify(it.snapshots.map((sn) => ({ ...sn, recipe: slim(sn.recipe) }))),
          now
        )
      }
      row(PHOTO, this.origin()?.name ?? '', 0, s.photo)
      s.copies.forEach((c, i) => row(c.id, c.name, i + 1, c))
      const keep = new Set([PHOTO, ...s.copies.map((c) => c.id)])
      for (const { item_id } of this.prepare('SELECT item_id FROM items').all() as {
        item_id: string
      }[]) {
        if (keep.has(item_id)) continue
        this.prepare('DELETE FROM items WHERE item_id = ?').run(item_id)
        this.history.remove(item_id)
      }
      this.setMeta('stack', s.stack ? JSON.stringify(s.stack) : null)
    })
  }

  // ── history, planes, preview ──

  /** History rows moved in from elsewhere (the index, before the photo had a project). */
  importHistory(copyId: string | null, rows: HistoryRow[]): void {
    this.history.remove(itemKeyOf(copyId))
    this.history.insertRows(itemKeyOf(copyId), rows)
  }

  putPlane(ref: string, png: string): void {
    this.prepare('INSERT OR IGNORE INTO planes(ref, png) VALUES (?, ?)').run(ref, png)
  }

  hasPlane(ref: string): boolean {
    return this.prepare('SELECT 1 FROM planes WHERE ref = ?').get(ref) !== undefined
  }

  plane(ref: string): string | undefined {
    const row = this.prepare('SELECT png FROM planes WHERE ref = ?').get(ref) as
      { png: string } | undefined
    return row?.png
  }

  *planes(): Generator<{ ref: string; png: string }> {
    yield* this.prepare('SELECT ref, png FROM planes').iterate() as Iterable<{
      ref: string
      png: string
    }>
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
   * names. Then give the freed pages back to the disk.
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
    let removed = 0
    this.tx(() => {
      for (const { ref } of this.prepare('SELECT ref FROM planes').all() as { ref: string }[]) {
        if (keep.has(ref)) continue
        this.prepare('DELETE FROM planes WHERE ref = ?').run(ref)
        removed++
      }
    })
    if (removed > 0) this.db.exec('PRAGMA incremental_vacuum')
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

/**
 * The index's open projects. Each stays open while it is in use and closes
 * after a moment idle (`IDLE_MS`), so the file sits quiet and whole for
 * Finder, backups and sync. One the disk changed under (synced in, replaced,
 * restored) is reopened, never written through a stale handle.
 */
export class ProjectPool {
  private readonly open = new Map<
    string,
    { file: PixlFile; stamp: string | null; timer: ReturnType<typeof setTimeout> | null }
  >()
  private readonly idleMs: number

  constructor(idleMs = 2000) {
    this.idleMs = idleMs
  }

  /** Run `fn` on the project at `path`. */
  use<T>(path: string, fn: (p: PixlFile) => T): T {
    let e = this.open.get(path)
    if (e && e.stamp !== fileStamp(path)) {
      this.drop(path)
      e = undefined
    }
    if (!e) {
      e = { file: PixlFile.open(path), stamp: null, timer: null }
      this.open.set(path, e)
    }
    if (e.timer) clearTimeout(e.timer)
    try {
      return fn(e.file)
    } finally {
      e.stamp = fileStamp(path)
      e.timer = setTimeout(() => this.drop(path), this.idleMs)
      e.timer.unref?.()
    }
  }

  /** Close one project (before it is moved or replaced), or all. */
  drop(path?: string): void {
    for (const [p, e] of this.open) {
      if (path !== undefined && p !== path) continue
      if (e.timer) clearTimeout(e.timer)
      e.file.close()
      this.open.delete(p)
    }
  }
}
