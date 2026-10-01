/**
 * The index. `node:sqlite` (built into Electron's Node), one file in
 * userData. It mirrors what the sidecars say (ratings, flags, labels, whether
 * a photo is edited) so a folder lists fast, and it keeps what has no better
 * home: edit history, presets, export presets, settings and the thumbnail
 * cache's bookkeeping. Deleting it loses nothing a sidecar holds.
 */
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import type { CameraInfo, ColorLabel, ExportPreset, Flag, HistoryLog, Preset } from '../shared/ipc'
import type { ExportSettings } from '../shared/export'
import { HistoryTable, type HistoryRow } from './historytable'
import type { Recipe, RecipeGroup } from '../shared/recipe'

export interface PhotoRow {
  id: number
  path: string
  folder: string
  name: string
  ext: string
  size: number
  mtime: number
  is_raw: number
  rating: number
  flag: string | null
  label: string | null
  edited: number
  camera_json: string | null
  thumb_path: string | null
  thumb_key: string | null
  sidecar_mtime: number | null
  title: string | null
  caption: string | null
  copyright: string | null
  xmp_mtime: number | null
  content_hash: string | null
  hash_key: string | null
  dhash: string | null
  dhash_key: string | null
  captured_at: string | null
  iso: number | null
  focal: number | null
  fnumber: number | null
  exposure: number | null
  camera: string | null
  lens: string | null
  stack_id: string | null
  stack_pos: number | null
  /** What kind of HDR the file is ('' none), as last probed; `hdr_key` names that file version. */
  hdr: string | null
  hdr_key: string | null
  /** The photo's `.pixl` project (the truth about its edits once it has one), and its mtime as mirrored. */
  project_path: string | null
  project_mtime: number | null
}

export interface CopyRow {
  photo_id: number
  copy_id: string
  name: string
  rating: number
  flag: string | null
  label: string | null
  edited: number
  thumb_path: string | null
  thumb_key: string | null
}

export interface CollectionRow {
  id: string
  name: string
  kind: 'manual' | 'smart' | 'set'
  parent: string | null
  /** A smart collection's SmartGroup, as JSON. */
  rules: string | null
  sort: number
  created_at: string
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS folders (path TEXT PRIMARY KEY, opened_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  folder TEXT NOT NULL,
  name TEXT NOT NULL,
  ext TEXT NOT NULL,
  size INTEGER NOT NULL,
  mtime REAL NOT NULL,
  is_raw INTEGER NOT NULL,
  rating INTEGER NOT NULL DEFAULT 0,
  flag TEXT,
  label TEXT,
  edited INTEGER NOT NULL DEFAULT 0,
  camera_json TEXT,
  thumb_path TEXT,
  thumb_key TEXT,
  sidecar_mtime REAL
);
CREATE INDEX IF NOT EXISTS photos_folder ON photos(folder);
CREATE TABLE IF NOT EXISTS copies (
  photo_id INTEGER NOT NULL,
  copy_id TEXT NOT NULL,
  name TEXT NOT NULL,
  rating INTEGER NOT NULL DEFAULT 0,
  flag TEXT,
  label TEXT,
  edited INTEGER NOT NULL DEFAULT 0,
  thumb_path TEXT,
  thumb_key TEXT,
  PRIMARY KEY (photo_id, copy_id)
);
CREATE TABLE IF NOT EXISTS history (
  item_key TEXT NOT NULL,
  seq INTEGER NOT NULL,
  label TEXT NOT NULL,
  at TEXT NOT NULL,
  recipe TEXT NOT NULL,
  PRIMARY KEY (item_key, seq)
);
CREATE TABLE IF NOT EXISTS presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  grp TEXT NOT NULL,
  groups TEXT NOT NULL,
  recipe TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS export_presets (id TEXT PRIMARY KEY, name TEXT NOT NULL, settings TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS planes (ref TEXT PRIMARY KEY, png TEXT NOT NULL);
`

const columnsOf = (db: DatabaseSync, table: string): string[] =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)

/** Add the columns `table` lacks: a migration re-run after a crash finds some already there. */
function addColumns(db: DatabaseSync, table: string, cols: Record<string, string>): void {
  const have = columnsOf(db, table)
  for (const [name, type] of Object.entries(cols)) {
    if (!have.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`)
  }
}

/**
 * Schema changes, in order; `PRAGMA user_version` says how many have run.
 * Each runs in its own transaction and must be safe on a database that
 * already has part of it (every index made before versioning is at 0).
 */
export const MIGRATIONS: ((db: DatabaseSync) => void)[] = [
  // 1. History became steps: each row past the base holds the patch it made,
  // and can be hidden. Older rows are converted when their item is read.
  (db) => addColumns(db, 'history', { patch: 'TEXT', hidden: 'INTEGER NOT NULL DEFAULT 0' }),
  // 2. The library: descriptive metadata (mirrored from .xmp sidecars), the
  // camera fields as columns so they can be searched, content and picture
  // hashes for duplicates, stacks (mirrored from the sidecar), keywords and
  // collections; a preset's white balance as the engine's white.
  (db) => {
    addColumns(db, 'photos', {
      title: 'TEXT',
      caption: 'TEXT',
      copyright: 'TEXT',
      xmp_mtime: 'REAL',
      content_hash: 'TEXT',
      hash_key: 'TEXT',
      dhash: 'TEXT',
      dhash_key: 'TEXT',
      captured_at: 'TEXT',
      iso: 'REAL',
      focal: 'REAL',
      fnumber: 'REAL',
      exposure: 'REAL',
      camera: 'TEXT',
      lens: 'TEXT',
      stack_id: 'TEXT',
      stack_pos: 'INTEGER'
    })
    addColumns(db, 'presets', { wb_op: 'TEXT' })
    db.exec(`
CREATE TABLE IF NOT EXISTS photo_keywords (
  photo_id INTEGER NOT NULL,
  path TEXT NOT NULL,
  PRIMARY KEY (photo_id, path)
);
CREATE INDEX IF NOT EXISTS photo_keywords_path ON photo_keywords(path);
CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('manual', 'smart', 'set')),
  parent TEXT,
  rules TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS collection_items (
  collection_id TEXT NOT NULL,
  photo_id INTEGER NOT NULL,
  copy_id TEXT NOT NULL DEFAULT '',
  added_at TEXT NOT NULL,
  PRIMARY KEY (collection_id, photo_id, copy_id)
);
CREATE INDEX IF NOT EXISTS collection_items_photo ON collection_items(photo_id);
CREATE INDEX IF NOT EXISTS photos_captured ON photos(captured_at);
CREATE INDEX IF NOT EXISTS photos_size ON photos(size);
CREATE INDEX IF NOT EXISTS photos_stack ON photos(stack_id);
`)
    // The camera fields, from the JSON already read.
    const rows = db
      .prepare('SELECT id, camera_json FROM photos WHERE camera_json IS NOT NULL')
      .all() as { id: number; camera_json: string }[]
    const set = db.prepare(
      'UPDATE photos SET captured_at = ?, iso = ?, focal = ?, fnumber = ?, exposure = ?, camera = ?, lens = ? WHERE id = ?'
    )
    for (const r of rows) {
      let c: Partial<CameraInfo>
      try {
        c = JSON.parse(r.camera_json) as Partial<CameraInfo>
      } catch {
        continue
      }
      set.run(...cameraColumns(c), r.id)
    }
  },
  // 3. Whether a photo is HDR, and how (a gain map, PQ, HLG), for the grid's
  // badge: known once the file has been probed.
  (db) => addColumns(db, 'photos', { hdr: 'TEXT', hdr_key: 'TEXT' }),
  // 4. A photo's `.pixl` project, once it has one: where it is, and its
  // modification time as last mirrored (like a sidecar's).
  (db) => addColumns(db, 'photos', { project_path: 'TEXT', project_mtime: 'REAL' })
]

/** The searchable columns of a photo's camera info, in `UPDATE … SET` order. */
export function cameraColumns(
  c: Partial<CameraInfo> | null
): [
  string | null,
  number | null,
  number | null,
  number | null,
  number | null,
  string | null,
  string | null
] {
  const camera = [c?.make, c?.model].filter((x): x is string => !!x).join(' ') || null
  return [
    c?.capturedAt ?? null,
    c?.iso ?? null,
    c?.focalLength ?? null,
    c?.fNumber ?? null,
    c?.exposureTime ?? null,
    camera,
    c?.lens ?? null
  ]
}

export function migrate(db: DatabaseSync): void {
  let version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
  while (version < MIGRATIONS.length) {
    db.exec('BEGIN')
    try {
      MIGRATIONS[version](db)
      db.exec(`PRAGMA user_version = ${version + 1}`)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
    version++
  }
}

/** History entries kept per item (the base and its steps); older steps fold into the base. */

export class Store {
  private readonly db: DatabaseSync
  private readonly statements = new Map<string, StatementSync>()
  private depth = 0
  private readonly hist: HistoryTable

  private constructor(db: DatabaseSync) {
    this.db = db
    this.hist = new HistoryTable({ prepare: (sql) => this.prepare(sql), tx: (fn) => this.tx(fn) })
  }

  /** A statement, prepared once and reused: preparing costs more than most runs. */
  private prepare(sql: string): StatementSync {
    let st = this.statements.get(sql)
    if (!st) {
      st = this.db.prepare(sql)
      this.statements.set(sql, st)
    }
    return st
  }

  /**
   * Run `fn` as one transaction: a folder scan or a batch edit commits once
   * instead of once per row. Nested calls join the outer transaction.
   */
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
    this.db.exec('BEGIN')
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

  static open(file: string): Store {
    const db = new DatabaseSync(file)
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;')
    db.exec(SCHEMA)
    migrate(db)
    return new Store(db)
  }

  close(): void {
    this.db.close()
  }

  // ── folders ──
  touchFolder(path: string): void {
    this.prepare(
      'INSERT INTO folders(path, opened_at) VALUES (?, ?) ON CONFLICT(path) DO UPDATE SET opened_at = excluded.opened_at'
    ).run(path, new Date().toISOString())
  }

  recentFolders(limit = 12): string[] {
    return (
      this.prepare('SELECT path FROM folders ORDER BY opened_at DESC LIMIT ?').all(limit) as {
        path: string
      }[]
    ).map((r) => r.path)
  }

  // ── photos ──
  photosIn(folder: string): PhotoRow[] {
    return this.prepare('SELECT * FROM photos WHERE folder = ? ORDER BY name').all(
      folder
    ) as unknown as PhotoRow[]
  }

  photo(id: number): PhotoRow | undefined {
    return this.prepare('SELECT * FROM photos WHERE id = ?').get(id) as unknown as
      PhotoRow | undefined
  }

  photoByPath(path: string): PhotoRow | undefined {
    return this.prepare('SELECT * FROM photos WHERE path = ?').get(path) as unknown as
      PhotoRow | undefined
  }

  upsertPhoto(p: {
    path: string
    folder: string
    name: string
    ext: string
    size: number
    mtime: number
    isRaw: boolean
  }): PhotoRow {
    this.prepare(
      `INSERT INTO photos(path, folder, name, ext, size, mtime, is_raw) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET size = excluded.size, mtime = excluded.mtime`
    ).run(p.path, p.folder, p.name, p.ext, p.size, p.mtime, p.isRaw ? 1 : 0)
    return this.photoByPath(p.path) as PhotoRow
  }

  /**
   * Forget the folder's photos that are no longer on disk, with their
   * copies, keywords and places in collections. Returns how many went.
   */
  removeMissing(folder: string, present: Set<string>): number {
    let removed = 0
    for (const row of this.photosIn(folder)) {
      if (!present.has(row.path)) {
        this.prepare('DELETE FROM photos WHERE id = ?').run(row.id)
        this.prepare('DELETE FROM copies WHERE photo_id = ?').run(row.id)
        this.prepare('DELETE FROM photo_keywords WHERE photo_id = ?').run(row.id)
        this.prepare('DELETE FROM collection_items WHERE photo_id = ?').run(row.id)
        removed++
      }
    }
    return removed
  }

  /** Every photo the index knows, in folder and name order. */
  allPhotos(): PhotoRow[] {
    return this.prepare('SELECT * FROM photos ORDER BY folder, name').all() as unknown as PhotoRow[]
  }

  /** These photos, in folder and name order (unknown ids are left out). */
  photosByIds(ids: number[]): PhotoRow[] {
    const rows = this.inChunks(ids, (qs) => `SELECT * FROM photos WHERE id IN (${qs})`)
    return (rows as unknown as PhotoRow[]).sort(
      (a, b) => a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name)
    )
  }

  /** Every copy of these photos. */
  copiesOfPhotos(ids: number[]): CopyRow[] {
    return this.inChunks(
      ids,
      (qs) => `SELECT * FROM copies WHERE photo_id IN (${qs}) ORDER BY name`
    ) as unknown as CopyRow[]
  }

  /** A query over a list of ids, a few hundred at a time (SQLite limits the parameters). */
  private inChunks(ids: number[], sql: (placeholders: string) => string): unknown[] {
    const out: unknown[] = []
    for (let i = 0; i < ids.length; i += 500) {
      const part = ids.slice(i, i + 500)
      out.push(...this.prepare(sql(part.map(() => '?').join(','))).all(...part))
    }
    return out
  }

  /** Photos of this size or any other that more than one photo has, in scope. */
  photosSharingSize(folder: string | null): PhotoRow[] {
    const where = folder === null ? '' : 'WHERE folder = ?'
    const args = folder === null ? [] : [folder]
    return this.prepare(
      `SELECT * FROM photos WHERE size IN (
         SELECT size FROM photos ${where} GROUP BY size HAVING COUNT(*) > 1
       ) ${folder === null ? '' : 'AND folder = ?'} ORDER BY folder, name`
    ).all(...args, ...args) as unknown as PhotoRow[]
  }

  photosInScope(folder: string | null): PhotoRow[] {
    return folder === null ? this.allPhotos() : this.photosIn(folder)
  }

  setContentHash(id: number, hash: string, key: string): void {
    this.prepare('UPDATE photos SET content_hash = ?, hash_key = ? WHERE id = ?').run(hash, key, id)
  }

  setDhash(id: number, hash: string, key: string): void {
    this.prepare('UPDATE photos SET dhash = ?, dhash_key = ? WHERE id = ?').run(hash, key, id)
  }

  // ── descriptive metadata (mirrored from the .xmp) ──

  setXmp(
    id: number,
    meta: { title: string | null; caption: string | null; copyright: string | null },
    keywords: string[],
    mtime: number | null
  ): void {
    this.prepare(
      'UPDATE photos SET title = ?, caption = ?, copyright = ?, xmp_mtime = ? WHERE id = ?'
    ).run(meta.title, meta.caption, meta.copyright, mtime, id)
    this.prepare('DELETE FROM photo_keywords WHERE photo_id = ?').run(id)
    const ins = this.prepare('INSERT OR IGNORE INTO photo_keywords(photo_id, path) VALUES (?, ?)')
    for (const k of keywords) ins.run(id, k)
  }

  keywordsOf(id: number): string[] {
    return (
      this.prepare('SELECT path FROM photo_keywords WHERE photo_id = ? ORDER BY path').all(id) as {
        path: string
      }[]
    ).map((r) => r.path)
  }

  /** Each photo's keywords, for a listing: one query per few hundred photos. */
  keywordsFor(ids: number[]): Map<number, string[]> {
    const out = new Map<number, string[]>()
    const rows = this.inChunks(
      ids,
      (qs) => `SELECT photo_id, path FROM photo_keywords WHERE photo_id IN (${qs}) ORDER BY path`
    ) as { photo_id: number; path: string }[]
    for (const r of rows) {
      const list = out.get(r.photo_id)
      if (list) list.push(r.path)
      else out.set(r.photo_id, [r.path])
    }
    return out
  }

  allKeywords(): { photo_id: number; path: string }[] {
    return this.prepare('SELECT photo_id, path FROM photo_keywords').all() as {
      photo_id: number
      path: string
    }[]
  }

  /** The photos with this keyword or one under it. */
  photoIdsWithKeyword(path: string): number[] {
    return (
      this.prepare(
        "SELECT DISTINCT photo_id FROM photo_keywords WHERE path = ? OR path LIKE ? ESCAPE '\\'"
      ).all(path, path.replace(/[\\%_]/g, (c) => '\\' + c) + '|%') as { photo_id: number }[]
    ).map((r) => r.photo_id)
  }

  // ── stacks (mirrored from the sidecar) ──

  setStack(id: number, stackId: string | null, position: number | null): void {
    this.prepare('UPDATE photos SET stack_id = ?, stack_pos = ? WHERE id = ?').run(
      stackId,
      position,
      id
    )
  }

  stackMembers(stackId: string): PhotoRow[] {
    return this.prepare('SELECT * FROM photos WHERE stack_id = ? ORDER BY stack_pos, name').all(
      stackId
    ) as unknown as PhotoRow[]
  }

  /** How many photos each of these stacks holds. */
  stackSizes(stackIds: string[]): Map<string, number> {
    const out = new Map<string, number>()
    for (let i = 0; i < stackIds.length; i += 500) {
      const part = stackIds.slice(i, i + 500)
      const rows = this.prepare(
        `SELECT stack_id, COUNT(*) AS n FROM photos WHERE stack_id IN (${part.map(() => '?').join(',')}) GROUP BY stack_id`
      ).all(...part) as { stack_id: string; n: number }[]
      for (const r of rows) out.set(r.stack_id, r.n)
    }
    return out
  }

  // ── collections ──

  collections(): CollectionRow[] {
    return this.prepare(
      'SELECT * FROM collections ORDER BY sort, name COLLATE NOCASE'
    ).all() as unknown as CollectionRow[]
  }

  collection(id: string): CollectionRow | undefined {
    return this.prepare('SELECT * FROM collections WHERE id = ?').get(id) as unknown as
      CollectionRow | undefined
  }

  saveCollection(c: Omit<CollectionRow, 'created_at'>): void {
    this.prepare(
      `INSERT INTO collections(id, name, kind, parent, rules, sort, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind,
           parent = excluded.parent, rules = excluded.rules, sort = excluded.sort`
    ).run(c.id, c.name, c.kind, c.parent, c.rules, c.sort, new Date().toISOString())
  }

  /** Remove a collection and its items; what sat in it (a set's children) moves to the top. */
  removeCollection(id: string): void {
    this.prepare('DELETE FROM collection_items WHERE collection_id = ?').run(id)
    this.prepare('UPDATE collections SET parent = NULL WHERE parent = ?').run(id)
    this.prepare('DELETE FROM collections WHERE id = ?').run(id)
  }

  collectionItems(id: string): { photo_id: number; copy_id: string }[] {
    return this.prepare(
      'SELECT photo_id, copy_id FROM collection_items WHERE collection_id = ?'
    ).all(id) as { photo_id: number; copy_id: string }[]
  }

  /** Every manual collection's items, for smart rules that name them. */
  allCollectionItems(): { collection_id: string; photo_id: number; copy_id: string }[] {
    return this.prepare('SELECT collection_id, photo_id, copy_id FROM collection_items').all() as {
      collection_id: string
      photo_id: number
      copy_id: string
    }[]
  }

  addCollectionItem(id: string, photoId: number, copyId: string): void {
    this.prepare(
      'INSERT OR IGNORE INTO collection_items(collection_id, photo_id, copy_id, added_at) VALUES (?, ?, ?, ?)'
    ).run(id, photoId, copyId, new Date().toISOString())
  }

  removeCollectionItem(id: string, photoId: number, copyId: string): void {
    this.prepare(
      'DELETE FROM collection_items WHERE collection_id = ? AND photo_id = ? AND copy_id = ?'
    ).run(id, photoId, copyId)
  }

  /** A deleted copy leaves the collections it was in. */
  removeCopyFromCollections(photoId: number, copyId: string): void {
    this.prepare('DELETE FROM collection_items WHERE photo_id = ? AND copy_id = ?').run(
      photoId,
      copyId
    )
  }

  hasPhotosIn(folder: string): boolean {
    return this.prepare('SELECT 1 FROM photos WHERE folder = ? LIMIT 1').get(folder) !== undefined
  }

  setPhotoMeta(
    id: number,
    meta: { rating: number; flag: Flag; label: ColorLabel; edited: boolean }
  ): void {
    this.prepare('UPDATE photos SET rating = ?, flag = ?, label = ?, edited = ? WHERE id = ?').run(
      meta.rating,
      meta.flag,
      meta.label,
      meta.edited ? 1 : 0,
      id
    )
  }

  setProject(id: number, path: string | null, mtime: number | null): void {
    this.prepare('UPDATE photos SET project_path = ?, project_mtime = ? WHERE id = ?').run(
      path,
      mtime,
      id
    )
  }

  setSidecarMtime(id: number, mtime: number | null): void {
    this.prepare('UPDATE photos SET sidecar_mtime = ? WHERE id = ?').run(mtime, id)
  }

  setCamera(id: number, camera: CameraInfo): void {
    this.prepare(
      'UPDATE photos SET camera_json = ?, captured_at = ?, iso = ?, focal = ?, fnumber = ?, exposure = ?, camera = ?, lens = ? WHERE id = ?'
    ).run(JSON.stringify(camera), ...cameraColumns(camera), id)
  }

  setHdr(photoId: number, kind: string, key: string): void {
    this.prepare('UPDATE photos SET hdr = ?, hdr_key = ? WHERE id = ?').run(kind, key, photoId)
  }

  setThumb(photoId: number, copyId: string | null, path: string, key: string): void {
    if (copyId === null) {
      this.prepare('UPDATE photos SET thumb_path = ?, thumb_key = ? WHERE id = ?').run(
        path,
        key,
        photoId
      )
    } else {
      this.prepare(
        'UPDATE copies SET thumb_path = ?, thumb_key = ? WHERE photo_id = ? AND copy_id = ?'
      ).run(path, key, photoId, copyId)
    }
  }

  // ── copies ──
  copiesOf(photoId: number): CopyRow[] {
    return this.prepare('SELECT * FROM copies WHERE photo_id = ? ORDER BY name').all(
      photoId
    ) as unknown as CopyRow[]
  }

  /** Every copy of every photo in a folder, in one query. */
  copiesIn(folder: string): CopyRow[] {
    return this.prepare(
      'SELECT c.* FROM copies c JOIN photos p ON p.id = c.photo_id WHERE p.folder = ? ORDER BY c.name'
    ).all(folder) as unknown as CopyRow[]
  }

  replaceCopies(
    photoId: number,
    copies: {
      id: string
      name: string
      rating: number
      flag: Flag
      label: ColorLabel
      edited: boolean
    }[]
  ): void {
    const existing = new Map(this.copiesOf(photoId).map((c) => [c.copy_id, c]))
    this.prepare('DELETE FROM copies WHERE photo_id = ?').run(photoId)
    const ins = this.prepare(
      'INSERT INTO copies(photo_id, copy_id, name, rating, flag, label, edited, thumb_path, thumb_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    for (const c of copies) {
      const old = existing.get(c.id)
      ins.run(
        photoId,
        c.id,
        c.name,
        c.rating,
        c.flag,
        c.label,
        c.edited ? 1 : 0,
        old?.thumb_path ?? null,
        old?.thumb_key ?? null
      )
    }
  }

  // ── history (photos without a project; see historytable.ts) ──
  history(itemKey: string): HistoryLog {
    return this.hist.history(itemKey)
  }

  appendHistory(itemKey: string, label: string, recipe: Recipe): HistoryLog {
    return this.hist.append(itemKey, label, recipe)
  }

  setHistoryHidden(itemKey: string, seqs: number[], hidden: boolean): HistoryLog {
    return this.hist.setHidden(itemKey, seqs, hidden)
  }

  deleteHistory(itemKey: string, seqs: number[]): HistoryLog {
    return this.hist.delete(itemKey, seqs)
  }

  /** An item's history rows as stored, to move them into its project. */
  historyRows(itemKey: string): HistoryRow[] {
    return this.hist.rows(itemKey)
  }

  removeHistory(itemKey: string): void {
    this.hist.remove(itemKey)
  }

  // ── painted planes, by reference (see planestore.ts) ──
  putPlane(ref: string, png: string): void {
    this.prepare('INSERT OR IGNORE INTO planes(ref, png) VALUES (?, ?)').run(ref, png)
  }

  plane(ref: string): string | undefined {
    const row = this.prepare('SELECT png FROM planes WHERE ref = ?').get(ref) as
      { png: string } | undefined
    return row?.png
  }

  /** Every stored recipe or patch that may name a plane by reference: the edit history's. */
  *historyRecipes(): Generator<string> {
    yield* this.hist.json()
  }

  /** Drop the planes not in `keep`. Returns how many went. */
  prunePlanes(keep: Set<string>): number {
    const refs = (this.prepare('SELECT ref FROM planes').all() as { ref: string }[]).map(
      (r) => r.ref
    )
    let removed = 0
    this.tx(() => {
      for (const ref of refs) {
        if (keep.has(ref)) continue
        this.prepare('DELETE FROM planes WHERE ref = ?').run(ref)
        removed++
      }
    })
    return removed
  }

  // ── presets ──
  presets(): Preset[] {
    return (
      this.prepare('SELECT * FROM presets ORDER BY grp, name').all() as {
        id: string
        name: string
        grp: string
        groups: string
        recipe: string
        wb_op: string | null
      }[]
    ).map((r) => ({
      id: r.id,
      name: r.name,
      group: r.grp,
      builtin: false,
      groups: JSON.parse(r.groups) as RecipeGroup[],
      recipe: JSON.parse(r.recipe) as Recipe,
      ...(r.wb_op ? { wbOp: JSON.parse(r.wb_op) as NonNullable<Preset['wbOp']> } : {})
    }))
  }

  savePreset(p: Preset): void {
    this.prepare(
      'INSERT INTO presets(id, name, grp, groups, recipe, wb_op) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, grp = excluded.grp, groups = excluded.groups, recipe = excluded.recipe, wb_op = excluded.wb_op'
    ).run(
      p.id,
      p.name,
      p.group,
      JSON.stringify(p.groups),
      JSON.stringify(p.recipe),
      p.wbOp ? JSON.stringify(p.wbOp) : null
    )
  }

  removePreset(id: string): void {
    this.prepare('DELETE FROM presets WHERE id = ?').run(id)
  }

  exportPresets(): ExportPreset[] {
    return (
      this.prepare('SELECT * FROM export_presets ORDER BY name').all() as {
        id: string
        name: string
        settings: string
      }[]
    ).map((r) => ({ id: r.id, name: r.name, settings: JSON.parse(r.settings) as ExportSettings }))
  }

  saveExportPreset(p: ExportPreset): void {
    this.prepare(
      'INSERT INTO export_presets(id, name, settings) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, settings = excluded.settings'
    ).run(p.id, p.name, JSON.stringify(p.settings))
  }

  removeExportPreset(id: string): void {
    this.prepare('DELETE FROM export_presets WHERE id = ?').run(id)
  }

  // ── settings ──
  getSetting<T>(key: string): T | undefined {
    const row = this.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      { value: string } | undefined
    return row ? (JSON.parse(row.value) as T) : undefined
  }

  setSetting(key: string, value: unknown): void {
    this.prepare(
      'INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run(key, JSON.stringify(value))
  }
}
