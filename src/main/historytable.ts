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
 *
 * Every KEYFRAME_EVERY steps, a step row also keeps the whole recipe the
 * history describes as of that step (in `recipe`, '' otherwise): the head is
 * the latest keyframe with the few steps after it replayed, so recording an
 * edit costs the same at step 5 as at step 195. Hiding, showing or deleting
 * a step clears the keyframes from it on; the next head rebuilds them.
 */
import type { StatementSync } from 'node:sqlite'
import type { HistoryAppend, HistoryBase, HistoryLog } from '../shared/ipc'
import { diffRecipe, replay, type Patch, type Step } from '../shared/history'
import type { Recipe } from '../shared/recipe'

export const HISTORY_LIMIT = 200
/** A step row keeps the whole recipe every this many steps. */
export const KEYFRAME_EVERY = 25

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
    // A read takes no write lock; only old rows to convert do.
    const rows = this.rows(itemKey)
    if (rows.length === 0) return { base: null, steps: [] }
    if (rows.slice(1).some((r) => r.patch === null)) return this.db.tx(() => this.convert(itemKey))
    return this.logOf(rows)
  }

  /** Rows from before history became steps, turned into patches (once), and the log. */
  private convert(itemKey: string): HistoryLog {
    const rows = this.rows(itemKey)
    const [first, ...rest] = rows
    if (!first) return { base: null, steps: [] }
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
    return this.logOf(rows)
  }

  /** The log, and its head: the latest keyframe with the steps after it replayed. */
  private logOf(rows: HistoryRow[]): HistoryLog {
    const [first, ...rest] = rows
    const base = {
      seq: first.seq,
      label: first.label,
      at: first.at,
      recipe: JSON.parse(first.recipe) as Recipe
    }
    const steps = rest.map((r): Step => ({
      seq: r.seq,
      label: r.label,
      at: r.at,
      patch: JSON.parse(r.patch ?? '[]') as Patch,
      hidden: r.hidden !== 0
    }))
    const k = rest.findLastIndex((r) => r.patch !== null && r.recipe !== '')
    const head =
      k < 0
        ? replay(base.recipe, steps)
        : replay(JSON.parse(rest[k].recipe) as Recipe, steps.slice(k + 1))
    return { base, steps, head }
  }

  /** The base row, as stored. */
  private baseRow(itemKey: string): HistoryRow | undefined {
    return this.db
      .prepare(
        'SELECT seq, label, at, recipe, patch, hidden FROM history WHERE item_key = ? ORDER BY seq LIMIT 1'
      )
      .get(itemKey) as unknown as HistoryRow | undefined
  }

  /** Steps from before history became steps (whole recipes), turned into patches. */
  private ensureSteps(itemKey: string): void {
    const old = this.db
      .prepare('SELECT COUNT(*) AS n FROM history WHERE item_key = ? AND patch IS NULL')
      .get(itemKey) as { n: number }
    if (old.n > 1) this.convert(itemKey)
  }

  /**
   * The recipe the history describes (null without a base): the latest
   * keyframe and the steps after it, else the base and every step. With
   * `rebuild` (inside a write), keyframes missing along the way are written.
   */
  head(itemKey: string, rebuild = false): Recipe | null {
    const base = this.baseRow(itemKey)
    if (!base) return null
    const key = this.db
      .prepare(
        `SELECT seq, recipe FROM history WHERE item_key = ? AND patch IS NOT NULL AND recipe <> ''
         ORDER BY seq DESC LIMIT 1`
      )
      .get(itemKey) as { seq: number; recipe: string } | undefined
    const from = key ?? { seq: base.seq, recipe: base.recipe }
    const rows = this.db
      .prepare('SELECT seq, patch, hidden FROM history WHERE item_key = ? AND seq > ? ORDER BY seq')
      .all(itemKey, from.seq) as { seq: number; patch: string | null; hidden: number }[]
    let recipe = JSON.parse(from.recipe) as Recipe
    if (rows.length === 0) return recipe
    const mark = rebuild
      ? this.db.prepare('UPDATE history SET recipe = ? WHERE item_key = ? AND seq = ?')
      : null
    // Steps since the last keyframe: one is due every KEYFRAME_EVERY.
    let since = key ? 0 : this.stepsBefore(itemKey, from.seq)
    const pending: Step[] = []
    for (const r of rows) {
      pending.push({
        seq: r.seq,
        label: '',
        at: '',
        patch: JSON.parse(r.patch ?? '[]') as Patch,
        hidden: r.hidden !== 0
      })
      if (mark && ++since >= KEYFRAME_EVERY) {
        recipe = replay(recipe, pending)
        pending.length = 0
        since = 0
        mark.run(JSON.stringify(recipe), itemKey, r.seq)
      }
    }
    return pending.length > 0 ? replay(recipe, pending) : recipe
  }

  /** How many steps there are up to `seq` (0 from the base). */
  private stepsBefore(itemKey: string, seq: number): number {
    return (
      this.db
        .prepare(
          'SELECT COUNT(*) AS n FROM history WHERE item_key = ? AND seq <= ? AND patch IS NOT NULL'
        )
        .get(itemKey, seq) as { n: number }
    ).n
  }

  /**
   * Record a settled edit: the first becomes the base, every later one a
   * step holding what changed against the history's current recipe. An edit
   * that changed nothing records nothing. Returns what changed, not the
   * whole history (`appendToLog` lays it on one): the step, and when the
   * oldest steps folded into the base, the new base and the folded steps.
   */
  append(itemKey: string, label: string, recipe: Recipe): HistoryAppend {
    return this.db.tx(() => {
      this.ensureSteps(itemKey)
      const at = new Date().toISOString()
      const insert = this.db.prepare(
        'INSERT INTO history(item_key, seq, label, at, recipe, patch, hidden) VALUES (?, ?, ?, ?, ?, ?, 0)'
      )
      const head = this.head(itemKey, true)
      // What was written is returned as written, not read back.
      if (!head) {
        const json = JSON.stringify(recipe)
        insert.run(itemKey, 1, label, at, json, null)
        const base = { seq: 1, label, at, recipe: JSON.parse(json) as Recipe }
        return { base, step: null, folded: [] }
      }
      const patch = diffRecipe(head, recipe)
      if (patch.length === 0) return { base: null, step: null, folded: [] }
      const last = this.db
        .prepare('SELECT MAX(seq) AS seq FROM history WHERE item_key = ?')
        .get(itemKey) as { seq: number }
      const seq = last.seq + 1
      const json = JSON.stringify(patch)
      const step: Step = { seq, label, at, patch: JSON.parse(json) as Patch, hidden: false }
      // A keyframe when this step is the KEYFRAME_EVERY-th since the last one.
      const keyed = this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM history WHERE item_key = ? AND patch IS NOT NULL AND seq > COALESCE(
             (SELECT MAX(seq) FROM history WHERE item_key = ? AND patch IS NOT NULL AND recipe <> ''), 0)`
        )
        .get(itemKey, itemKey) as { n: number }
      const keyframe = keyed.n + 1 >= KEYFRAME_EVERY ? JSON.stringify(replay(head, [step])) : ''
      insert.run(itemKey, seq, label, at, keyframe, json)
      return { ...this.fold(itemKey), step }
    })
  }

  /** Past the limit, the oldest steps fold into the base (a hidden one is dropped). */
  private fold(itemKey: string): { base: HistoryBase | null; folded: number[] } {
    const count = this.db
      .prepare('SELECT COUNT(*) AS n FROM history WHERE item_key = ?')
      .get(itemKey) as { n: number }
    const excess = count.n - HISTORY_LIMIT
    const first = this.baseRow(itemKey)
    if (!first || excess <= 0) return { base: null, folded: [] }
    const old = this.db
      .prepare(
        'SELECT seq, patch, hidden FROM history WHERE item_key = ? AND seq > ? ORDER BY seq LIMIT ?'
      )
      .all(itemKey, first.seq, excess) as { seq: number; patch: string | null; hidden: number }[]
    const recipe = replay(
      JSON.parse(first.recipe) as Recipe,
      old.map((r) => ({
        seq: r.seq,
        label: '',
        at: '',
        patch: JSON.parse(r.patch ?? '[]') as Patch,
        hidden: r.hidden !== 0
      }))
    )
    const json = JSON.stringify(recipe)
    this.db
      .prepare('UPDATE history SET recipe = ? WHERE item_key = ? AND seq = ?')
      .run(json, itemKey, first.seq)
    this.db
      .prepare('DELETE FROM history WHERE item_key = ? AND seq > ? AND seq <= ?')
      .run(itemKey, first.seq, old[old.length - 1].seq)
    return {
      base: {
        seq: first.seq,
        label: first.label,
        at: first.at,
        recipe: JSON.parse(json) as Recipe
      },
      folded: old.map((r) => r.seq)
    }
  }

  /** Keyframes from `seq` on no longer describe the history (a step at `seq` changed). */
  private dropKeyframes(itemKey: string, seq: number): void {
    this.db
      .prepare(
        "UPDATE history SET recipe = '' WHERE item_key = ? AND seq >= ? AND patch IS NOT NULL AND recipe <> ''"
      )
      .run(itemKey, seq)
  }

  /** The history and the recipe it now describes, its keyframes rebuilt first. */
  private logAndHead(itemKey: string): HistoryLog {
    this.head(itemKey, true)
    return this.history(itemKey)
  }

  /** Hide or show steps (never the base). */
  setHidden(itemKey: string, seqs: number[], hidden: boolean): HistoryLog {
    return this.db.tx(() => {
      this.ensureSteps(itemKey)
      const st = this.db.prepare(
        'UPDATE history SET hidden = ? WHERE item_key = ? AND seq = ? AND patch IS NOT NULL'
      )
      for (const seq of seqs) st.run(hidden ? 1 : 0, itemKey, seq)
      if (seqs.length > 0) this.dropKeyframes(itemKey, Math.min(...seqs))
      return this.logAndHead(itemKey)
    })
  }

  /** Delete steps (never the base). */
  delete(itemKey: string, seqs: number[]): HistoryLog {
    return this.db.tx(() => {
      this.ensureSteps(itemKey)
      const st = this.db.prepare(
        'DELETE FROM history WHERE item_key = ? AND seq = ? AND patch IS NOT NULL'
      )
      for (const seq of seqs) st.run(itemKey, seq)
      if (seqs.length > 0) this.dropKeyframes(itemKey, Math.min(...seqs))
      return this.logAndHead(itemKey)
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
