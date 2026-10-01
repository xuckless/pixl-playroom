/**
 * An edit history kept in a SQLite table: the app's index keeps the
 * histories of photos without a project, a `.pixl` project keeps its own
 * (see project/pixlfile.ts). Both are this same table and these same rules:
 *
 *   history(item_key, seq, label, at, recipe, patch, hidden)
 *
 * The first row is the base (a whole recipe), every later one a step (the
 * patch it made, which can be hidden). Past HISTORY_LIMIT rows the oldest
 * steps fold into the base.
 */
import type { StatementSync } from 'node:sqlite'
import type { HistoryLog } from '../shared/ipc'
import { applyPatch, diffRecipe, replay, type Patch, type Step } from '../shared/history'
import type { Recipe } from '../shared/recipe'

export const HISTORY_LIMIT = 200

export const HISTORY_SCHEMA = `
CREATE TABLE IF NOT EXISTS history (
  item_key TEXT NOT NULL,
  seq INTEGER NOT NULL,
  label TEXT NOT NULL,
  at TEXT NOT NULL,
  recipe TEXT NOT NULL,
  patch TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (item_key, seq)
);
`

/** One row as stored: what moves between a history table and another. */
export interface HistoryRow {
  seq: number
  label: string
  at: string
  recipe: string
  patch: string | null
  hidden: number
}

/** What the table needs from its database: cached statements and nested transactions. */
export interface HistoryDb {
  prepare(sql: string): StatementSync
  tx<T>(fn: () => T): T
}

export class HistoryTable {
  private readonly db: HistoryDb

  constructor(db: HistoryDb) {
    this.db = db
  }

  rows(itemKey: string): HistoryRow[] {
    return this.db
      .prepare(
        'SELECT seq, label, at, recipe, patch, hidden FROM history WHERE item_key = ? ORDER BY seq'
      )
      .all(itemKey) as unknown as HistoryRow[]
  }

  /** Every item that has a history here. */
  keys(): string[] {
    return (
      this.db.prepare('SELECT DISTINCT item_key FROM history').all() as { item_key: string }[]
    ).map((r) => r.item_key)
  }

  /** Put rows taken from another table under `itemKey` (after any already there are gone). */
  insertRows(itemKey: string, rows: HistoryRow[]): void {
    const st = this.db.prepare(
      'INSERT OR REPLACE INTO history(item_key, seq, label, at, recipe, patch, hidden) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    this.db.tx(() => {
      for (const r of rows) st.run(itemKey, r.seq, r.label, r.at, r.recipe, r.patch, r.hidden)
    })
  }

  /** Forget an item's history. */
  remove(itemKey: string): void {
    this.db.prepare('DELETE FROM history WHERE item_key = ?').run(itemKey)
  }

  /**
   * An item's history as its base and steps. Rows written before history
   * became steps hold whole recipes; they are turned into patches here, once.
   */
  history(itemKey: string): HistoryLog {
    return this.db.tx(() => {
      const rows = this.rows(itemKey)
      if (rows.length === 0) return { base: null, steps: [] }
      const [first, ...rest] = rows
      if (rest.some((r) => r.patch === null)) {
        const update = this.db.prepare(
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
  append(itemKey: string, label: string, recipe: Recipe): HistoryLog {
    return this.db.tx(() => {
      const log = this.history(itemKey)
      const at = new Date().toISOString()
      const insert = this.db.prepare(
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
      this.fold(itemKey)
      return this.history(itemKey)
    })
  }

  /** Past the limit, the oldest steps fold into the base (a hidden one is dropped). */
  private fold(itemKey: string): void {
    const log = this.history(itemKey)
    const excess = log.steps.length + 1 - HISTORY_LIMIT
    if (!log.base || excess <= 0) return
    const old = log.steps.slice(0, excess)
    const base = old.reduce((r, s) => (s.hidden ? r : applyPatch(r, s.patch)), log.base.recipe)
    this.db
      .prepare('UPDATE history SET recipe = ? WHERE item_key = ? AND seq = ?')
      .run(JSON.stringify(base), itemKey, log.base.seq)
    this.db
      .prepare('DELETE FROM history WHERE item_key = ? AND seq > ? AND seq <= ?')
      .run(itemKey, log.base.seq, old[old.length - 1].seq)
  }

  /** Hide or show steps (never the base). */
  setHidden(itemKey: string, seqs: number[], hidden: boolean): HistoryLog {
    return this.db.tx(() => {
      const st = this.db.prepare(
        'UPDATE history SET hidden = ? WHERE item_key = ? AND seq = ? AND patch IS NOT NULL'
      )
      for (const seq of seqs) st.run(hidden ? 1 : 0, itemKey, seq)
      return this.history(itemKey)
    })
  }

  /** Delete steps (never the base). */
  delete(itemKey: string, seqs: number[]): HistoryLog {
    return this.db.tx(() => {
      const st = this.db.prepare(
        'DELETE FROM history WHERE item_key = ? AND seq = ? AND patch IS NOT NULL'
      )
      for (const seq of seqs) st.run(itemKey, seq)
      return this.history(itemKey)
    })
  }

  /** Every stored recipe and patch, as JSON: what may name a plane by reference. */
  *json(): Generator<string> {
    const rows = this.db
      .prepare(
        `SELECT recipe || ' ' || COALESCE(patch, '') AS json FROM history
         WHERE recipe LIKE '%"ref":%' OR patch LIKE '%"ref":%'`
      )
      .iterate() as Iterable<{ json: string }>
    for (const r of rows) yield r.json
  }
}
