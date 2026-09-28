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

/** Keys per request: the background engine measures this many side by side. */
const CHUNK = 4
const JOB = 'auto-wb-batch'

let running = false

const photos = (n: number): string => `${n} photo${n === 1 ? '' : 's'}`

/**
 * If the photo open in Develop was among `keys`, show what the batch wrote:
 * its recipe (the main process already renders it) and its history.
 */
async function refreshDevelop(keys: string[]): Promise<void> {
  const key = useDevelop.getState().session?.key
  if (!key || !keys.includes(key)) return
  const [s, history] = await Promise.all([api.develop.open(key), api.develop.historyList(key)])
  if (useDevelop.getState().session?.key === key)
    useDevelop.setState({ recipe: s.recipe, history, redo: [] })
}

async function restore(previous: AutoWbResult['previous']): Promise<void> {
  const lib = useLibrary.getState()
  const pairs = Object.entries(previous).map(([key, wb]) => ({ key, wb }))
  try {
    lib.patchItems(await api.library.setWb(pairs))
    await refreshDevelop(pairs.map((p) => p.key))
    lib.say(`White balance restored on ${photos(pairs.length)}`)
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
    title: 'Auto white balance',
    detail: `0 of ${photos(keys.length)}`,
    progress: 0,
    scope: 'global',
    cancel: () => {
      stopped = true
      busy.update(JOB, { title: 'Stopping auto white balance', cancel: undefined })
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
        detail: `${done} of ${photos(keys.length)}`
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
    if (failed.length > 0) lib.say(`Auto white balance: ${failed[0].message}`, 'error')
    return
  }
  const parts = [`Auto white balance on ${photos(changed.length)}`]
  if (failed.length > 0) parts.push(`${failed.length} failed (${failed[0].message})`)
  if (stopped && done < keys.length) parts.push(`stopped before ${keys.length - done} more`)
  useLibrary.getState().say(parts.join(', '), failed.length > 0 ? 'error' : 'info', {
    label: 'Undo',
    run: () => void restore(previous)
  })
}
