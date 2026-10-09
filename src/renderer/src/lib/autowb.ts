/**
 * Auto white balance across a selection: each photo measured on its own,
 * a few at a time so the identity bar can show how far along it is and the
 * user can stop it, then one toast whose Undo puts every white back.
 */
import type { AutoWbResult } from '../../../shared/ipc'
import type { Recipe } from '../../../shared/recipe'
import { useBusy } from '../state/busy'
import { useDevelop } from '../state/develop'
import { useLibrary } from '../state/library'
import { api, errorText } from './api'
import { t, tp } from './i18n'

/** Keys per request: the background engine measures this many side by side. */
const CHUNK = 4
const JOB = 'auto-wb-batch'

let running = false

/**
 * If the photo open in Develop was among `keys`, show what the batch wrote:
 * its recipe (the main process already renders it) and its history.
 */
async function refreshDevelop(keys: string[]): Promise<void> {
  const key = useDevelop.getState().session?.key
  if (!key || !keys.includes(key)) return
  const [s, listed] = await Promise.all([api.develop.open(key), api.develop.historyList(key)])
  // The head is the session's recipe here; the state keeps only the log.
  const history = { base: listed.base, steps: listed.steps }
  if (useDevelop.getState().session?.key === key)
    useDevelop.setState({ recipe: s.recipe, history, redo: [] })
}

async function restore(previous: AutoWbResult['previous']): Promise<void> {
  const lib = useLibrary.getState()
  const pairs = Object.entries(previous).map(([key, wb]) => ({ key, wb }))
  try {
    lib.patchItems(await api.library.setWb(pairs))
    await refreshDevelop(pairs.map((p) => p.key))
    lib.say(
      tp(
        'White balance restored on {{count}} photo',
        'White balance restored on {{count}} photos',
        pairs.length
      )
    )
  } catch (err) {
    lib.say(errorText(err), 'error')
  }
}

/** Auto white balance on every key, each photo its own. */
export async function autoWbBatch(keys: string[]): Promise<void> {
  const lib = useLibrary.getState()
  if (keys.length === 0 || running) return
  running = true
  let stopped = false
  const busy = useBusy.getState()
  busy.begin({
    id: JOB,
    title: t('Auto white balance'),
    detail: tp('{{done}} of {{count}} photo', '{{done}} of {{count}} photos', keys.length, {
      done: 0
    }),
    progress: 0,
    scope: 'global',
    cancel: () => {
      stopped = true
      busy.update(JOB, { title: t('Stopping auto white balance'), cancel: undefined })
    }
  })
  const previous: Record<string, Recipe['wb']> = {}
  const failed: AutoWbResult['failed'] = []
  let done = 0
  try {
    for (let i = 0; i < keys.length && !stopped; i += CHUNK) {
      const chunk = keys.slice(i, i + CHUNK)
      const r = await api.library.autoWb(chunk)
      lib.patchItems(r.items)
      Object.assign(previous, r.previous)
      failed.push(...r.failed)
      done += chunk.length
      busy.update(JOB, {
        progress: done / keys.length,
        detail: tp('{{done}} of {{count}} photo', '{{done}} of {{count}} photos', keys.length, {
          done
        })
      })
    }
  } catch (err) {
    failed.push({ key: '', message: errorText(err) })
  } finally {
    busy.end(JOB)
    running = false
  }
  const changed = Object.keys(previous)
  await refreshDevelop(changed).catch((err) => lib.say(errorText(err), 'error'))
  if (changed.length === 0) {
    if (failed.length > 0)
      lib.say(t('Auto white balance: {{error}}', { error: failed[0].message }), 'error')
    return
  }
  const parts = [
    tp(
      'Auto white balance on {{count}} photo',
      'Auto white balance on {{count}} photos',
      changed.length
    )
  ]
  if (failed.length > 0)
    parts.push(
      tp('{{count}} failed ({{error}})', '{{count}} failed ({{error}})', failed.length, {
        error: failed[0].message
      })
    )
  if (stopped && done < keys.length)
    parts.push(
      tp('stopped before {{count}} more', 'stopped before {{count}} more', keys.length - done)
    )
  useLibrary.getState().say(parts.join(', '), failed.length > 0 ? 'error' : 'info', {
    label: t('Undo'),
    run: () => void restore(previous)
  })
}
