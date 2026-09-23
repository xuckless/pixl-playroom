/**
 * The sidecar: `<photo file name>.playroom.json` beside the original. It is
 * the truth about a photo's edits, snapshots, virtual copies, rating, flag
 * and colour label — portable with the folder, readable by anyone, and never
 * inside the photo itself. The original is never written.
 *
 * Writes are atomic (a temporary file renamed over the old one), and a photo
 * with nothing to say gets no sidecar at all.
 */
import { existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs'
import type { ColorLabel, Flag, Snapshot } from '../shared/ipc'
import { normaliseRecipe, type Recipe } from '../shared/recipe'

export const SIDECAR_SUFFIX = '.playroom.json'

export interface SidecarItem {
  rating: number
  flag: Flag
  label: ColorLabel
  recipe: Recipe | null
  snapshots: Snapshot[]
}

export interface SidecarCopy extends SidecarItem {
  id: string
  name: string
}

export interface Sidecar {
  app: 'pixl-playroom'
  version: 1
  photo: SidecarItem
  copies: SidecarCopy[]
}

export function sidecarPath(photoPath: string): string {
  return photoPath + SIDECAR_SUFFIX
}

export function emptySidecar(): Sidecar {
  return {
    app: 'pixl-playroom',
    version: 1,
    photo: { rating: 0, flag: null, label: null, recipe: null, snapshots: [] },
    copies: []
  }
}

function item(v: unknown, isRaw: boolean): SidecarItem {
  const o = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>
  const rating = typeof o.rating === 'number' ? Math.max(0, Math.min(5, Math.round(o.rating))) : 0
  const flag = o.flag === 'pick' || o.flag === 'reject' ? o.flag : null
  const label = ['red', 'yellow', 'green', 'blue', 'purple'].includes(o.label as string)
    ? (o.label as ColorLabel)
    : null
  const recipe = o.recipe ? normaliseRecipe(o.recipe, isRaw) : null
  const snapshots = Array.isArray(o.snapshots)
    ? (o.snapshots as Snapshot[]).map((s) => ({ ...s, recipe: normaliseRecipe(s.recipe, isRaw) }))
    : []
  return { rating, flag, label, recipe, snapshots }
}

/** Read a photo's sidecar, or an empty one. A damaged sidecar is kept aside, not overwritten. */
export function readSidecar(
  photoPath: string,
  isRaw: boolean
): { sidecar: Sidecar; mtime: number | null } {
  const file = sidecarPath(photoPath)
  if (!existsSync(file)) return { sidecar: emptySidecar(), mtime: null }
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    const copies = Array.isArray(raw.copies)
      ? (raw.copies as Record<string, unknown>[]).map((c) => ({
          ...item(c, isRaw),
          id: String(c.id ?? ''),
          name: String(c.name ?? 'Copy')
        }))
      : []
    return {
      sidecar: { app: 'pixl-playroom', version: 1, photo: item(raw.photo, isRaw), copies },
      mtime: statSync(file).mtimeMs
    }
  } catch {
    const aside = `${file}.damaged-${Date.now()}`
    try {
      renameSync(file, aside)
    } catch {
      // leave it where it is; the next write will still go to a temporary first
    }
    return { sidecar: emptySidecar(), mtime: null }
  }
}

function saysNothing(s: Sidecar): boolean {
  const p = s.photo
  return (
    s.copies.length === 0 &&
    p.rating === 0 &&
    p.flag === null &&
    p.label === null &&
    p.recipe === null &&
    p.snapshots.length === 0
  )
}

/** Write (or remove, when it says nothing) a photo's sidecar. Returns its mtime. */
export function writeSidecar(photoPath: string, sidecar: Sidecar): number | null {
  const file = sidecarPath(photoPath)
  if (saysNothing(sidecar)) {
    if (existsSync(file)) unlinkSync(file)
    return null
  }
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, JSON.stringify(sidecar, null, 2))
  renameSync(tmp, file)
  return statSync(file).mtimeMs
}

/** The item a key names inside a sidecar: the photo, or one of its copies. */
export function itemOf(sidecar: Sidecar, copyId: string | null): SidecarItem | undefined {
  return copyId === null ? sidecar.photo : sidecar.copies.find((c) => c.id === copyId)
}
