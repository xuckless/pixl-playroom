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
import { applyPatch, diffRecipe, replay, type Patch, type Step } from '../shared/history'
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

/** History entries kept per item (the base and its steps); older steps fold into the base. */
const HISTORY_LIMIT = 200

interface HistoryRow {
  seq: number
  label: string
  at: string
  recipe: string
  patch: string | null
  hidden: number
}

export class Store {
  private readonly db: DatabaseSync
  private readonly statements = new Map<string, StatementSync>()
  private depth = 0

  private constructor(db: DatabaseSync) {
    this.db = db
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
    // History became steps: each row past the base holds the patch it made,
    // and can be hidden. Older rows are converted when their item is read.
    const cols = (db.prepare('PRAGMA table_info(history)').all() as { name: string }[]).map(
      (c) => c.name
    )
    if (!cols.includes('patch')) db.exec('ALTER TABLE history ADD COLUMN patch TEXT')
    if (!cols.includes('hidden'))
      db.exec('ALTER TABLE history ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0')
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

  /** Forget the folder's photos that are no longer on disk. Returns how many went. */
  removeMissing(folder: string, present: Set<string>): number {
    let removed = 0
    for (const row of this.photosIn(folder)) {
      if (!present.has(row.path)) {
        this.prepare('DELETE FROM photos WHERE id = ?').run(row.id)
        this.prepare('DELETE FROM copies WHERE photo_id = ?').run(row.id)
        removed++
      }
    }
    return removed
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

  setSidecarMtime(id: number, mtime: number | null): void {
    this.prepare('UPDATE photos SET sidecar_mtime = ? WHERE id = ?').run(mtime, id)
  }

  setCamera(id: number, camera: CameraInfo): void {
    this.prepare('UPDATE photos SET camera_json = ? WHERE id = ?').run(JSON.stringify(camera), id)
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

  // ── history ──
  private historyRows(itemKey: string): HistoryRow[] {
    return this.prepare(
      'SELECT seq, label, at, recipe, patch, hidden FROM history WHERE item_key = ? ORDER BY seq'
    ).all(itemKey) as unknown as HistoryRow[]
  }

  /**
   * An item's history as its base and steps. Rows written before history
   * became steps hold whole recipes; they are turned into patches here, once.
   */
  history(itemKey: string): HistoryLog {
    return this.tx(() => {
      const rows = this.historyRows(itemKey)
      if (rows.length === 0) return { base: null, steps: [] }
      const [first, ...rest] = rows
      if (rest.some((r) => r.patch === null)) {
        const update = this.prepare(
          "UPDATE history SET patch = ?, recipe = '' WHERE item_key = ? AND seq = ?"
        )
        let prev = JSON.parse(first.recipe) as Recipe
        for (const r of rest) {
          if (r.patch !== null) continue
          const cur = JSON.parse(r.recipe) as Recipe
          r.patch = JSON.stringify(diffRecipe(prev, cur))
          update.run(r.patch, itemKey, r.seq)
          prev = cur
        }
      }
      return {
        base: {
          seq: first.seq,
          label: first.label,
          at: first.at,
          recipe: JSON.parse(first.recipe) as Recipe
        },
        steps: rest.map((r): Step => ({
          seq: r.seq,
          label: r.label,
          at: r.at,
          patch: JSON.parse(r.patch ?? '[]') as Patch,
          hidden: r.hidden !== 0
        }))
      }
    })
  }

  /**
   * Record a settled edit: the first becomes the base, every later one a
   * step holding what changed against the history's current recipe. An edit
   * that changed nothing records nothing.
   */
  appendHistory(itemKey: string, label: string, recipe: Recipe): HistoryLog {
    return this.tx(() => {
      const log = this.history(itemKey)
      const at = new Date().toISOString()
      const insert = this.prepare(
        'INSERT INTO history(item_key, seq, label, at, recipe, patch, hidden) VALUES (?, ?, ?, ?, ?, ?, 0)'
      )
      if (!log.base) {
        insert.run(itemKey, 1, label, at, JSON.stringify(recipe), null)
        return this.history(itemKey)
      }
      const patch = diffRecipe(replay(log.base.recipe, log.steps), recipe)
      if (patch.length === 0) return log
      const seq = (log.steps.at(-1)?.seq ?? log.base.seq) + 1
      insert.run(itemKey, seq, label, at, '', JSON.stringify(patch))
      this.foldHistory(itemKey)
      return this.history(itemKey)
    })
  }

  /** Past the limit, the oldest steps fold into the base (a hidden one is dropped). */
  private foldHistory(itemKey: string): void {
    const log = this.history(itemKey)
    const excess = log.steps.length + 1 - HISTORY_LIMIT
    if (!log.base || excess <= 0) return
    const old = log.steps.slice(0, excess)
    const base = old.reduce((r, s) => (s.hidden ? r : applyPatch(r, s.patch)), log.base.recipe)
    this.prepare('UPDATE history SET recipe = ? WHERE item_key = ? AND seq = ?').run(
      JSON.stringify(base),
      itemKey,
      log.base.seq
    )
    this.prepare('DELETE FROM history WHERE item_key = ? AND seq > ? AND seq <= ?').run(
      itemKey,
      log.base.seq,
      old[old.length - 1].seq
    )
  }

  /** Hide or show steps (never the base). */
  setHistoryHidden(itemKey: string, seqs: number[], hidden: boolean): HistoryLog {
    return this.tx(() => {
      const st = this.prepare(
        'UPDATE history SET hidden = ? WHERE item_key = ? AND seq = ? AND patch IS NOT NULL'
      )
      for (const seq of seqs) st.run(hidden ? 1 : 0, itemKey, seq)
      return this.history(itemKey)
    })
  }

  /** Delete steps (never the base). */
  deleteHistory(itemKey: string, seqs: number[]): HistoryLog {
    return this.tx(() => {
      const st = this.prepare(
        'DELETE FROM history WHERE item_key = ? AND seq = ? AND patch IS NOT NULL'
      )
      for (const seq of seqs) st.run(itemKey, seq)
      return this.history(itemKey)
    })
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
    const rows = this.prepare(
      `SELECT recipe || ' ' || COALESCE(patch, '') AS json FROM history
       WHERE recipe LIKE '%"ref":%' OR patch LIKE '%"ref":%'`
    ).iterate() as Iterable<{ json: string }>
    for (const r of rows) yield r.json
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
      }[]
    ).map((r) => ({
      id: r.id,
      name: r.name,
      group: r.grp,
      builtin: false,
      groups: JSON.parse(r.groups) as RecipeGroup[],
      recipe: JSON.parse(r.recipe) as Recipe
    }))
  }

  savePreset(p: Preset): void {
    this.prepare(
      'INSERT INTO presets(id, name, grp, groups, recipe) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, grp = excluded.grp, groups = excluded.groups, recipe = excluded.recipe'
    ).run(p.id, p.name, p.group, JSON.stringify(p.groups), JSON.stringify(p.recipe))
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
