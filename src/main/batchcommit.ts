/**
 * ARCHITECTURE — the Library's batch writer.
 *
 * Every change the Library makes to photos' settings goes through here:
 * paste and sync (`library.applyRecipe`), auto white balance on a selection
 * (autowb.ts), and the looks and Quick develop nudges that come next. A batch
 * is written the way an edit in Develop is, so each photo's own history is
 * the record and the undo:
 *
 * - A photo with no history gets its base quietly (where it stood), with no
 *   "Before …" step that changes nothing (`IndexService.batchStep`).
 * - Each photo gets one step, labelled with the batch's id
 *   (shared/history.ts `batchLabel`), so the History timeline shows it as a
 *   row of its own and the Library can find it again.
 * - Paste, sync and look batches keep at most one automatic "Before …"
 *   Version of each photo; nudges and Auto keep none (their step is enough).
 * - A photo's first step makes its project. The renderer sends a batch in
 *   chunks (lib/batch.ts), after asking once where projects go, so a batch
 *   on thousands of photos shows its progress and can be stopped.
 *
 * Undo (`undoBatch`) goes through each photo's own history: the batch's
 * step is undone only where it is still the newest step in effect; a photo
 * edited since keeps everything and is reported as skipped. Nothing of the
 * recipes before is kept anywhere else.
 */
import type { BatchResult, BatchTag, BatchUndoResult } from '../shared/ipc'
import { batchLabel } from '../shared/history'
import { sameValue, type Recipe } from '../shared/recipe'
import type { PhotoRow } from './db'
import type { IndexClient } from './indexer/client'
import { parseKey } from './keys'
import type { Library } from './library'
import type { PlaneStore } from './planestore'
import type { DevelopSessions } from './render'

export interface BatchServices {
  index: IndexClient
  planes: PlaneStore
  library: Library
  sessions: DevelopSessions
}

const BATCH_ID = /^[A-Za-z0-9_-]{1,64}$/

/** A batch's tag as the renderer sent it, checked (its id goes into history labels). */
export function batchTagOf(v: unknown): BatchTag {
  const o = v as Partial<BatchTag> | null
  if (!o || typeof o.id !== 'string' || !BATCH_ID.test(o.id) || typeof o.label !== 'string')
    throw new Error('not a batch')
  const version = o.version
  const kept =
    version &&
    typeof version.name === 'string' &&
    (version.reason === 'paste' || version.reason === 'look')
      ? { name: version.name, reason: version.reason }
      : null
  return { id: o.id, label: o.label.slice(0, 200), version: kept }
}

/** A batch's steps as the renderer sent them, checked. */
export function stepRefsOf(v: unknown): { key: string; seq: number }[] {
  if (!Array.isArray(v)) throw new Error('not a batch')
  return v.flatMap((x: { key?: unknown; seq?: unknown }) =>
    typeof x?.key === 'string' && Number.isInteger(x.seq)
      ? [{ key: x.key, seq: x.seq as number }]
      : []
  )
}

/** One photo's change in a batch: where it stood, and its new recipe. */
export interface BatchChange {
  key: string
  before: Recipe
  next: Recipe
}

/**
 * Each key's recipe as it stands: an open session's (which may be newer
 * than its sidecar, and is written first) or the saved one.
 */
export async function currentRecipes(
  s: BatchServices,
  keys: string[]
): Promise<Map<string, { recipe: Recipe; row: PhotoRow }>> {
  await Promise.all(keys.map((key) => s.sessions.flush(key)))
  const saved = await s.index.recipes(keys)
  return new Map(
    saved.map((r) => [r.key, { row: r.row, recipe: s.sessions.liveRecipe(r.key) ?? r.recipe }])
  )
}

/** An open photo shows what was written, and every photo's thumbnail renders again. */
async function follow(s: BatchServices, recipes: { key: string; recipe: Recipe }[]): Promise<void> {
  for (const { key, recipe } of recipes) {
    if (s.sessions.liveRecipe(key)) s.sessions.update(key, await s.planes.hydrate(recipe), false)
    const { photoId, copyId } = parseKey(key)
    s.library.queueThumb(photoId, copyId, true)
  }
}

/**
 * Write a chunk of a batch: for each photo that changes, its Version (when
 * the batch keeps one) and its step, with the recipe saved alongside. An open
 * photo follows, and the thumbnails re-render. Returns the items after,
 * each changed photo's step, and the photos that failed (`failed`, on top of
 * any the caller found): one that fails never costs the others their step,
 * nor the batch its Undo of what was written.
 */
export async function commitBatch(
  s: BatchServices,
  changes: BatchChange[],
  tag: BatchTag,
  failed: BatchResult['failed'] = []
): Promise<BatchResult> {
  const label = batchLabel(tag.label, tag.id)
  const steps: BatchResult['steps'] = []
  const written: { key: string; recipe: Recipe }[] = []
  for (const { key, before, next } of changes) {
    if (sameValue(before, next)) continue
    try {
      const seq = await s.index.batchStep(key, label, s.planes.slim(before), s.planes.slim(next))
      if (seq === null) continue
      steps.push({ key, seq })
      written.push({ key, recipe: next })
      // What it had before the batch came over it, a Version to step back to
      // (kept only where the step was written; an automatic one never fails it).
      if (tag.version)
        await s.library
          .addVersion(key, {
            name: tag.version.name,
            kind: 'auto',
            reason: tag.version.reason,
            recipe: before
          })
          .catch(() => null)
    } catch (err) {
      failed.push({ key, message: err instanceof Error ? err.message : String(err) })
    }
  }
  await follow(s, written)
  const items = await s.index.itemsFor(changes.map((c) => c.key))
  return { items, steps, failed }
}

/**
 * A batch taken back (or, with `redo`, brought back) through each photo's
 * history, where its step is still the one to take (`IndexService.
 * undoBatchSteps`). Open photos follow; the rest re-render their thumbnails.
 */
export async function undoBatch(
  s: BatchServices,
  steps: { key: string; seq: number }[],
  redo = false
): Promise<BatchUndoResult> {
  const keys = steps.map((x) => x.key)
  await Promise.all(keys.map((key) => s.sessions.flush(key)))
  const { recipes, skipped } = redo
    ? await s.index.redoBatchSteps(steps)
    : await s.index.undoBatchSteps(steps)
  const done = Object.keys(recipes)
  await follow(
    s,
    done.map((key) => ({ key, recipe: recipes[key] }))
  )
  return { items: await s.index.itemsFor(keys), done, skipped }
}
