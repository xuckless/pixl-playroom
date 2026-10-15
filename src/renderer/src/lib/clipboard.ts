/**
 * ARCHITECTURE — copy, paste and sync of settings (the clipboard itself is
 * shared/clipboard.ts; the writes are Library batches, lib/batch.ts).
 *
 * - `copySettings(key)`: ⌘C. In Develop the open photo's settings as seen
 *   now; in the Library the focused photo's, read from main. The clipboard
 *   is named after its photo.
 * - `pasteSettings(keys)`: ⌘V in both views, at once, with Undo; ⇧⌘V opens
 *   the chooser (the 'paste' dialog) to pick the groups first.
 * - `syncSettings(source, keys, groups)`: the Sync dialog (⇧⌘S), always from
 *   the focused photo (Library) or the open one (Develop), read when asked:
 *   never a stale recipe Develop showed earlier.
 */
import { effective } from '../../../shared/edits'
import { COPY_GROUPS, type SettingsClipboard } from '../../../shared/clipboard'
import type { LibraryItem } from '../../../shared/ipc'
import type { Recipe, RecipeGroup } from '../../../shared/recipe'
import { useDevelop } from '../state/develop'
import { useLibrary } from '../state/library'
import { api, errorText } from './api'
import { runRecipeBatch, type BatchOutcome } from './batch'
import { keyHint } from './commands'
import { t, tk, tp } from './i18n'

/** A photo as the grid names it (a virtual copy with its copy's name). */
export function photoName(it: Pick<LibraryItem, 'name' | 'copyName'>): string {
  return it.copyName ? `${it.name} · ${it.copyName}` : it.name
}

/** The name of the photo `key`, from the listing (or Develop's session). */
export function nameOfKey(key: string): string {
  const it =
    useLibrary.getState().items.find((i) => i.key === key) ??
    (useDevelop.getState().session?.key === key ? useDevelop.getState().session?.item : undefined)
  return it ? photoName(it) : key
}

/**
 * A photo's settings as seen: the open photo's live recipe (a section
 * switched off goes as its defaults), else the saved one from main.
 */
export async function settingsOf(key: string): Promise<Recipe> {
  const d = useDevelop.getState()
  if (d.session?.key === key && d.recipe)
    return structuredClone(effective(d.recipe, d.session.isRaw))
  return api.library.copyRecipe(key)
}

/** ⌘C: copy the photo's settings to the clipboard, named after it. */
export async function copySettings(key: string): Promise<void> {
  const lib = useLibrary.getState()
  try {
    const recipe = await settingsOf(key)
    const clip: SettingsClipboard = {
      recipe,
      groups: [...COPY_GROUPS],
      source: { key, name: nameOfKey(key) },
      at: Date.now()
    }
    lib.setClipboard(clip)
    lib.say(
      t('Copied the settings of {{name}} ({{paste}} to paste, {{choose}} to choose)', {
        name: clip.source.name,
        paste: keyHint('library.paste'),
        choose: keyHint('settings.pasteSpecial')
      })
    )
  } catch (err) {
    lib.say(errorText(err), 'error')
  }
}

/** ⌘V: the clipboard's settings (or `groups` of them) onto `keys`, at once, with Undo. */
export async function pasteSettings(
  keys: string[],
  groups?: RecipeGroup[]
): Promise<BatchOutcome | null> {
  const clip = useLibrary.getState().clipboard
  if (!clip) {
    useLibrary
      .getState()
      .say(t('Copy settings from a photo first ({{key}}).', { key: keyHint('library.copy') }))
    return null
  }
  const chosen = groups ?? clip.groups
  if (chosen.length === 0) return null
  return runRecipeBatch({
    keys,
    label: tk('Paste settings'),
    title: t('Paste settings'),
    busy: t('Pasting settings'),
    version: { name: tk('Before pasted settings'), reason: 'paste' },
    write: (part, tag) => api.library.applyRecipe(part, clip.recipe, chosen, clip.source.key, tag),
    said: (n) =>
      tp(
        'Pasted the settings of {{name}} onto {{count}} photo',
        'Pasted the settings of {{name}} onto {{count}} photos',
        n,
        { name: clip.source.name }
      )
  })
}

/** Sync: `groups` of `source`'s settings (as `settingsOf` read them) onto `keys`. */
export function syncSettings(
  source: { key: string; name: string; recipe: Recipe },
  keys: string[],
  groups: RecipeGroup[]
): Promise<BatchOutcome | null> {
  return runRecipeBatch({
    keys: keys.filter((k) => k !== source.key),
    label: tk('Sync settings'),
    title: t('Sync settings'),
    busy: t('Syncing settings'),
    version: { name: tk('Before pasted settings'), reason: 'paste' },
    write: (part, tag) => api.library.applyRecipe(part, source.recipe, groups, source.key, tag),
    said: (n) =>
      tp(
        'Synced the settings of {{name}} to {{count}} photo',
        'Synced the settings of {{name}} to {{count}} photos',
        n,
        { name: source.name }
      )
  })
}
