/**
 * ARCHITECTURE — the settings clipboard (pure; the renderer's
 * lib/clipboard.ts fills and pastes it).
 *
 * ⌘C copies one photo's settings, in the Library (the focused photo, read
 * from main with `library.copyRecipe`) or in Develop (the open photo). The
 * clipboard is named: which photo it came from, when, and which groups, so
 * ⌘V (paste at once, in both views) and ⇧⌘V (choose the groups) always say
 * what they are about to paste. Sync is different: it copies from the
 * focused or open photo when asked, never from a clipboard or a photo
 * Develop showed earlier.
 */
import { t } from './i18n'
import { GROUP_LABELS, RECIPE_GROUPS, type Recipe, type RecipeGroup } from './recipe'

/** What a copy leaves behind by default: what belongs to one frame (its crop, its spots, its masks). */
export const NOT_COPIED: readonly RecipeGroup[] = [
  'crop',
  'upright',
  'orientation',
  'localAdjustments',
  'retouch'
]

/** The groups ⌘C copies. */
export const COPY_GROUPS: readonly RecipeGroup[] = RECIPE_GROUPS.filter(
  (g) => !NOT_COPIED.includes(g)
)

export interface SettingsClipboard {
  /** What was seen: a section switched off goes as its defaults (`effective`). */
  recipe: Recipe
  groups: RecipeGroup[]
  /** The photo it was copied from; its name as the grid shows it. */
  source: { key: string; name: string }
  /** When it was copied (ms). */
  at: number
  /** Its photo's settings stamped when copied (`library.stamps`): another stamp, it changed since. */
  stamp?: string
}

/** "4 min ago", "just now", "2 h ago": how long since a copy, roughly. */
export function copiedAgo(at: number, now: number): string {
  const min = Math.floor((now - at) / 60_000)
  if (min < 1) return t('just now')
  if (min < 60) return t('{{count}} min ago', { count: min })
  return t('{{count}} h ago', { count: Math.floor(min / 60) })
}

/** The groups as a short list ("White balance, Exposure & tone and 4 more"). */
export function groupsSummary(groups: readonly RecipeGroup[], show = 2): string {
  const named = groups.slice(0, show).map((g) => t(GROUP_LABELS[g]))
  const rest = groups.length - named.length
  if (named.length === 0) return t('no settings')
  return rest > 0
    ? t('{{groups}} and {{count}} more', { groups: named.join(', '), count: rest })
    : named.join(', ')
}

/** The clipboard as one line: "IMG_0412 · 3 min ago · White balance, Exposure & tone". */
export function clipboardLine(c: SettingsClipboard, now: number): string {
  return [c.source.name, copiedAgo(c.at, now), groupsSummary(c.groups)].join(' · ')
}
