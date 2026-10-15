/**
 * ARCHITECTURE — running a Library batch of settings (the renderer's half of
 * main/batchcommit.ts).
 *
 * `runRecipeBatch` is how anything changes many photos' settings at once:
 * paste and sync (lib/clipboard.ts, the Sync dialog), auto white balance on
 * a selection (lib/autowb.ts), and the looks and Quick develop to come. It
 *
 * 1. asks first above CONFIRM_ABOVE photos;
 * 2. asks once where projects go, if Develop has not asked yet (a photo's
 *    first step makes its project);
 * 3. sends the photos to main in chunks, each a call that writes one step per
 *    photo tagged with the batch's id, with progress and Stop in the
 *    identity bar (a stopped batch is still one undo entry);
 * 4. shows the open photo what was written (its recipe and history);
 * 5. puts one entry on the Library's undo stack (state/libraryUndo.ts) and
 *    says what it did, with Undo when it changed more than one photo.
 */
import type { BatchResult, BatchTag } from '../../../shared/ipc'
import { CONFIRM_ABOVE, type RecipeEntry } from '../../../shared/libraryundo'
import { useBusy } from '../state/busy'
import { useDevelop } from '../state/develop'
import { confirmMany, nextId, useLibrary } from '../state/library'
import { onBatchWritten, pushUndo, undoAction } from '../state/libraryUndo'
import { api, errorText } from './api'
import { t, tp } from './i18n'

export interface RecipeBatch {
  keys: string[]
  /** Each photo's step, as History shows it (English, `tk`: stored, then translated). */
  label: string
  /** What it is, short, for the Edit menu ("Undo Paste settings"); in the language shown. */
  title: string
  /** The progress line's title ("Pasting settings"). */
  busy: string
  /** The Version kept of each photo before (paste, sync, looks); none for nudges and Auto. */
  version?: BatchTag['version']
  /** Photos per call (the background engine measures a few at a time). */
  chunk?: number
  /** Write one chunk: main's half of the batch. */
  write(keys: string[], tag: BatchTag): Promise<BatchResult>
  /** What it did ("Pasted onto 12 photos"). */
  said(count: number): string
}

export interface Failure {
  key: string
  message: string
}

export interface BatchOutcome {
  steps: BatchResult['steps']
  failed: Failure[]
  stopped: boolean
}

/** Photos per call when a batch doesn't say. */
const CHUNK = 25

let running: string | null = null

/**
 * If the photo open in Develop is among `keys`, show what was written: its
 * recipe (main already renders it) and its history.
 */
export async function refreshDevelop(keys: string[]): Promise<void> {
  const key = useDevelop.getState().session?.key
  if (!key || !keys.includes(key)) return
  const [s, listed] = await Promise.all([api.develop.open(key), api.develop.historyList(key)])
  // The head is the session's recipe here; the state keeps only the log.
  const history = { base: listed.base, steps: listed.steps }
  if (useDevelop.getState().session?.key === key) useDevelop.setState({ recipe: s.recipe, history })
}
onBatchWritten(refreshDevelop)

/** The answer to "where do projects go?", once: resolves when the dialog has closed. */
export async function askProjectsLocation(): Promise<void> {
  const ask = await api.app.locations().then(
    (l) => l.ask,
    () => false
  )
  const lib = useLibrary.getState()
  // Another dialog is up: asked at the next batch or Develop instead.
  if (!ask || lib.dialog) return
  lib.setDialog('projects-location')
  await new Promise<void>((resolve) => {
    const off = useLibrary.subscribe((s) => {
      if (s.dialog === 'projects-location') return
      off()
      resolve()
    })
  })
}

/** Run a batch of settings on many photos (see the top of this file). Null when it didn't start. */
export async function runRecipeBatch(b: RecipeBatch): Promise<BatchOutcome | null> {
  const lib = useLibrary.getState()
  const keys = [...new Set(b.keys)]
  if (keys.length === 0) return null
  if (running) {
    lib.say(t('{{what}} is still running', { what: running }))
    return null
  }
  if (keys.length > CONFIRM_ABOVE && !(await confirmMany(keys.length))) return null
  running = b.busy
  const job = `batch-${nextId()}`
  const tag: BatchTag = { id: nextId(), label: b.label, version: b.version ?? null }
  const chunk = b.chunk ?? CHUNK
  const steps: BatchResult['steps'] = []
  const failed: Failure[] = []
  let stopped = false
  let done = 0
  const busy = useBusy.getState()
  try {
    await askProjectsLocation()
    const progress = (): string =>
      tp('{{done}} of {{count}} photo', '{{done}} of {{count}} photos', keys.length, { done })
    busy.begin({
      id: job,
      title: b.busy,
      detail: progress(),
      progress: 0,
      scope: 'global',
      cancel: () => {
        stopped = true
        busy.update(job, { title: t('Stopping'), cancel: undefined })
      }
    })
    for (let i = 0; i < keys.length && !stopped; i += chunk) {
      const part = keys.slice(i, i + chunk)
      const r = await b.write(part, tag)
      useLibrary.getState().patchItems(r.items)
      steps.push(...r.steps)
      failed.push(...r.failed)
      done += part.length
      busy.update(job, { progress: done / keys.length, detail: progress() })
    }
  } catch (err) {
    failed.push({ key: '', message: errorText(err) })
  } finally {
    busy.end(job)
    running = null
  }
  await refreshDevelop(steps.map((s) => s.key)).catch((err) =>
    useLibrary.getState().say(errorText(err), 'error')
  )
  const entry: RecipeEntry = { kind: 'recipe', id: tag.id, title: b.title, steps }
  pushUndo(entry)
  sayOutcome(
    b,
    keys.length - done,
    { steps, failed, stopped: stopped && done < keys.length },
    entry
  )
  return { steps, failed, stopped }
}

function sayOutcome(b: RecipeBatch, left: number, o: BatchOutcome, entry: RecipeEntry): void {
  const lib = useLibrary.getState()
  const changed = o.steps.length
  if (changed === 0 && o.failed.length > 0) {
    lib.say(t('{{what}}: {{error}}', { what: b.title, error: o.failed[0].message }), 'error')
    return
  }
  const parts = [changed === 0 ? t('Nothing to change') : b.said(changed)]
  if (o.failed.length > 0)
    parts.push(
      tp('{{count}} failed ({{error}})', '{{count}} failed ({{error}})', o.failed.length, {
        error: o.failed[0].message
      })
    )
  if (o.stopped)
    parts.push(tp('stopped before {{count}} more', 'stopped before {{count}} more', left))
  // More than one photo changed: the toast keeps its Undo until it is used or replaced.
  lib.say(
    parts.join(', '),
    o.failed.length > 0 ? 'error' : 'info',
    changed > 1 ? undoAction(entry) : undefined
  )
}
