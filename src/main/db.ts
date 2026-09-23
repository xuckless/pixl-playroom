/**
 * The index. `node:sqlite` (built into Electron's Node), one file in
 * userData. It mirrors what the sidecars say (ratings, flags, labels, whether
 * a photo is edited) so a folder lists fast, and it keeps what has no better
 * home: edit history, presets, export presets, settings and the thumbnail
 * cache's bookkeeping. Deleting it loses nothing a sidecar holds.
 */
import { DatabaseSync } from 'node:sqlite'
import type {
  CameraInfo,
  ColorLabel,
  ExportPreset,
  Flag,
  HistoryEntry,
  Preset
} from '../shared/ipc'
import type { ExportSettings } from '../shared/export'
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
`

/** History entries kept per item; older ones fall off. */
const HISTORY_LIMIT = 200

export class Store {
  private constructor(private readonly db: DatabaseSync) {}

  static open(file: string): Store {
    const db = new DatabaseSync(file)
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;')
    db.exec(SCHEMA)
    return new Store(db)
  }

  close(): void {
    this.db.close()
  }

  // ── folders ──
  touchFolder(path: string): void {
    this.db
      .prepare(
        'INSERT INTO folders(path, opened_at) VALUES (?, ?) ON CONFLICT(path) DO UPDATE SET opened_at = excluded.opened_at'
      )
      .run(path, new Date().toISOString())
  }

  recentFolders(limit = 12): string[] {
    return (
      this.db.prepare('SELECT path FROM folders ORDER BY opened_at DESC LIMIT ?').all(limit) as {
        path: string
      }[]
    ).map((r) => r.path)
  }

  // ── photos ──
  photosIn(folder: string): PhotoRow[] {
    return this.db
      .prepare('SELECT * FROM photos WHERE folder = ? ORDER BY name')
      .all(folder) as unknown as PhotoRow[]
  }

  photo(id: number): PhotoRow | undefined {
    return this.db.prepare('SELECT * FROM photos WHERE id = ?').get(id) as unknown as
      PhotoRow | undefined
  }

  photoByPath(path: string): PhotoRow | undefined {
    return this.db.prepare('SELECT * FROM photos WHERE path = ?').get(path) as unknown as
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
    this.db
      .prepare(
        `INSERT INTO photos(path, folder, name, ext, size, mtime, is_raw) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET size = excluded.size, mtime = excluded.mtime`
      )
      .run(p.path, p.folder, p.name, p.ext, p.size, p.mtime, p.isRaw ? 1 : 0)
    return this.photoByPath(p.path) as PhotoRow
  }

  removeMissing(folder: string, present: Set<string>): void {
    for (const row of this.photosIn(folder)) {
      if (!present.has(row.path)) {
        this.db.prepare('DELETE FROM photos WHERE id = ?').run(row.id)
        this.db.prepare('DELETE FROM copies WHERE photo_id = ?').run(row.id)
      }
    }
  }

  setPhotoMeta(
    id: number,
    meta: { rating: number; flag: Flag; label: ColorLabel; edited: boolean }
  ): void {
    this.db
      .prepare('UPDATE photos SET rating = ?, flag = ?, label = ?, edited = ? WHERE id = ?')
      .run(meta.rating, meta.flag, meta.label, meta.edited ? 1 : 0, id)
  }

  setSidecarMtime(id: number, mtime: number | null): void {
    this.db.prepare('UPDATE photos SET sidecar_mtime = ? WHERE id = ?').run(mtime, id)
  }

  setCamera(id: number, camera: CameraInfo): void {
    this.db
      .prepare('UPDATE photos SET camera_json = ? WHERE id = ?')
      .run(JSON.stringify(camera), id)
  }

  setThumb(photoId: number, copyId: string | null, path: string, key: string): void {
    if (copyId === null) {
      this.db
        .prepare('UPDATE photos SET thumb_path = ?, thumb_key = ? WHERE id = ?')
        .run(path, key, photoId)
    } else {
      this.db
        .prepare(
          'UPDATE copies SET thumb_path = ?, thumb_key = ? WHERE photo_id = ? AND copy_id = ?'
        )
        .run(path, key, photoId, copyId)
    }
  }

  // ── copies ──
  copiesOf(photoId: number): CopyRow[] {
    return this.db
      .prepare('SELECT * FROM copies WHERE photo_id = ? ORDER BY name')
      .all(photoId) as unknown as CopyRow[]
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
    this.db.prepare('DELETE FROM copies WHERE photo_id = ?').run(photoId)
    const ins = this.db.prepare(
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
  history(itemKey: string): HistoryEntry[] {
    return (
      this.db
        .prepare('SELECT seq, label, at, recipe FROM history WHERE item_key = ? ORDER BY seq')
        .all(itemKey) as {
        seq: number
        label: string
        at: string
        recipe: string
      }[]
    ).map((r) => ({ seq: r.seq, label: r.label, at: r.at, recipe: JSON.parse(r.recipe) as Recipe }))
  }

  appendHistory(itemKey: string, label: string, recipe: Recipe): HistoryEntry {
    const last = this.db
      .prepare('SELECT MAX(seq) AS s FROM history WHERE item_key = ?')
      .get(itemKey) as {
      s: number | null
    }
    const seq = (last.s ?? 0) + 1
    const at = new Date().toISOString()
    this.db
      .prepare('INSERT INTO history(item_key, seq, label, at, recipe) VALUES (?, ?, ?, ?, ?)')
      .run(itemKey, seq, label, at, JSON.stringify(recipe))
    this.db
      .prepare('DELETE FROM history WHERE item_key = ? AND seq <= ?')
      .run(itemKey, seq - HISTORY_LIMIT)
    return { seq, label, at, recipe }
  }

  // ── presets ──
  presets(): Preset[] {
    return (
      this.db.prepare('SELECT * FROM presets ORDER BY grp, name').all() as {
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
    this.db
      .prepare(
        'INSERT INTO presets(id, name, grp, groups, recipe) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, grp = excluded.grp, groups = excluded.groups, recipe = excluded.recipe'
      )
      .run(p.id, p.name, p.group, JSON.stringify(p.groups), JSON.stringify(p.recipe))
  }

  removePreset(id: string): void {
    this.db.prepare('DELETE FROM presets WHERE id = ?').run(id)
  }

  exportPresets(): ExportPreset[] {
    return (
      this.db.prepare('SELECT * FROM export_presets ORDER BY name').all() as {
        id: string
        name: string
        settings: string
      }[]
    ).map((r) => ({ id: r.id, name: r.name, settings: JSON.parse(r.settings) as ExportSettings }))
  }

  saveExportPreset(p: ExportPreset): void {
    this.db
      .prepare(
        'INSERT INTO export_presets(id, name, settings) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, settings = excluded.settings'
      )
      .run(p.id, p.name, JSON.stringify(p.settings))
  }

  removeExportPreset(id: string): void {
    this.db.prepare('DELETE FROM export_presets WHERE id = ?').run(id)
  }

  // ── settings ──
  getSetting<T>(key: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      { value: string } | undefined
    return row ? (JSON.parse(row.value) as T) : undefined
  }

  setSetting(key: string, value: unknown): void {
    this.db
      .prepare(
        'INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      )
      .run(key, JSON.stringify(value))
  }
}
