/**
 * Auto white balance across a selection: each photo measured on its own,
 * a few at a time so the identity bar can show how far along it is and the
 * user can stop it. A Library batch (lib/batch.ts): one step in each photo's
 * history, and one toast whose Undo takes them back through those histories,
 * leaving any photo edited since as it is.
 */
import { api } from './api'
import { runRecipeBatch } from './batch'
import { t, tk, tp } from './i18n'

/** Keys per request: the background engine measures this many side by side. */
const CHUNK = 4

/** Auto white balance on every key, each photo its own. */
export async function autoWbBatch(keys: string[]): Promise<void> {
  await runRecipeBatch({
    keys,
    label: tk('White balance: Auto'),
    title: t('Auto white balance'),
    busy: t('Auto white balance'),
    chunk: CHUNK,
    write: (part, tag) => api.library.autoWb(part, tag),
    said: (n) =>
      tp('Auto white balance on {{count}} photo', 'Auto white balance on {{count}} photos', n)
  })
}
