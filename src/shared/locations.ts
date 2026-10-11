/**
 * Where Playroom saves what it makes for the user: projects (`.pixl`) and
 * exports. Each has the same three choices, one setting each in the index
 * (`projects.location`, `export.location`): beside the photo, the preset
 * folder in the user's home (`~/Pixl Projects`, and `Exports` inside it), or
 * a folder of the user's. Pure: main/project/locate.ts makes the paths.
 */

/** Beside the photo, the preset folder, or a folder of the user's. */
export type SaveLocation = 'beside' | 'home' | { folder: string }

/** What is saved there. */
export type LocationKind = 'projects' | 'exports'

/** The index setting that holds each. */
export const LOCATION_SETTING: Record<LocationKind, string> = {
  projects: 'projects.location',
  exports: 'export.location'
}

/** Set once the "where should these go?" question has been answered (or closed). */
export const LOCATIONS_ASKED = 'locations.asked'

/** The preset folder's name in the user's home, and the exports folder's inside it. */
export const PROJECTS_FOLDER = 'Pixl Projects'
export const EXPORTS_FOLDER = 'Exports'

/** Read a location setting's stored value (anything else is beside the photo). */
export function locationOf(v: unknown): SaveLocation {
  if (v === 'home') return 'home'
  if (v && typeof v === 'object' && typeof (v as { folder?: unknown }).folder === 'string')
    return { folder: (v as { folder: string }).folder }
  return 'beside'
}

/** A location's kind alone: which of the three choices it is. */
export function locationMode(loc: SaveLocation): 'beside' | 'home' | 'folder' {
  return typeof loc === 'object' ? 'folder' : loc
}

/**
 * Where exports went before they had a setting of their own: the Export
 * dialog remembered its last settings (`export.last`), a chosen folder among
 * them. That folder, or beside each original (what the dialog started as):
 * what someone updating has, so it is what they are shown.
 */
export function exportLocationFromLast(last: unknown): SaveLocation {
  const folder = (last as { folder?: unknown } | null)?.folder
  return typeof folder === 'string' && folder.trim() ? { folder } : 'beside'
}

/** What `IPC.app.locations` answers: each location, the folder it is now, and whether to ask. */
export interface LocationsInfo {
  projects: { location: SaveLocation; path: string | null }
  exports: { location: SaveLocation; path: string | null }
  /** The question has not been answered on this install. */
  ask: boolean
}
