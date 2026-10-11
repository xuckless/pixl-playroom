/**
 * Where a photo's `.pixl` project goes, and how projects are found again.
 *
 * - Beside the photo (while the setting is unset, as on installs from
 *   before the choice): `IMG_0001.pixl` next to `IMG_0001.CR3`.
 *   When another photo in the folder shares the name's stem (a RAW and its
 *   JPEG), each project keeps its extension: `IMG_0001.CR3.pixl`.
 * - In a projects folder (`~/Pixl Projects`, where a new install starts, or
 *   one the user chose): one
 *   subfolder per photo folder, named after it and told apart by a short hash
 *   of its path, so two folders called "Export" never share projects.
 *
 * A photo's own folder that cannot be written (a locked card, a read-only
 * share) puts its projects in the preset folder instead. A projects folder
 * that cannot be written is an error that names it: nothing is made
 * anywhere the user did not choose.
 *
 * Exports follow the same three choices (shared/locations.ts): beside the
 * original, `~/Pixl Projects/Exports/<the photo's folder>`, or a folder of
 * the user's.
 */
import { createHash } from 'crypto'
import { accessSync, constants, existsSync, mkdirSync, readdirSync } from 'fs'
import { homedir } from 'os'
import { basename, dirname, extname, join } from 'path'
import { EXPORTS_FOLDER, PROJECTS_FOLDER, type SaveLocation } from '../../shared/locations'
import { PIXL_EXT } from './pixlfile'

export { locationOf } from '../../shared/locations'

/** The setting `projects.location`: beside the photo, the preset folder, or a folder of the user's. */
export type ProjectLocation = SaveLocation

/**
 * The preset projects folder: `Pixl Projects` in `home`, the user's home
 * folder on every platform. A scripted run names another (its own profile),
 * so it never writes into the user's.
 */
export function presetProjectsDir(home: string = homedir()): string {
  return join(home, PROJECTS_FOLDER)
}

/** The preset exports folder, inside the projects one. */
export function presetExportsDir(home: string = homedir()): string {
  return join(presetProjectsDir(home), EXPORTS_FOLDER)
}

export function projectsRoot(loc: ProjectLocation, home: string = homedir()): string {
  return typeof loc === 'object' ? loc.folder : presetProjectsDir(home)
}

/**
 * The folder a photo in `photoFolder` is exported to: its own; its folder's
 * name under the preset exports folder (shoots stay apart; two folders of
 * one name share theirs, and a name taken is the exporter's to settle); or
 * the user's folder.
 */
export function exportDirFor(
  loc: SaveLocation,
  photoFolder: string,
  home: string = homedir()
): string {
  if (loc === 'beside') return photoFolder
  if (loc === 'home') return join(presetExportsDir(home), basename(photoFolder) || 'Photos')
  return loc.folder
}

/** The folder a location names as a whole (for showing it): none beside the photo. */
export function locationRoot(
  kind: 'projects' | 'exports',
  loc: SaveLocation,
  home: string = homedir()
): string | null {
  if (loc === 'beside') return null
  if (typeof loc === 'object') return loc.folder
  return kind === 'projects' ? presetProjectsDir(home) : presetExportsDir(home)
}

/** A photo folder's own subfolder under a projects folder. */
export function projectsDirFor(root: string, folder: string): string {
  const tag = createHash('sha1').update(folder).digest('hex').slice(0, 6)
  return join(root, `${basename(folder) || 'Photos'}-${tag}`)
}

const stemOf = (name: string): string => basename(name, extname(name))

/**
 * The project's file name for `photoName` among the folder's `siblings`
 * (image file names): the stem, or the whole name when another image shares
 * the stem.
 */
export function projectName(photoName: string, siblings: string[]): string {
  const stem = stemOf(photoName).toLowerCase()
  const shared = siblings.some(
    (n) =>
      n !== photoName && stemOf(n).toLowerCase() === stem && !n.toLowerCase().endsWith(PIXL_EXT)
  )
  return (shared ? photoName : stemOf(photoName)) + PIXL_EXT
}

function writable(dir: string): boolean {
  try {
    accessSync(dir, constants.W_OK)
    return true
  } catch {
    return false
  }
}

/** A name not yet taken in `dir`: `name`, else `name (2)`, `name (3)`… */
function free(dir: string, name: string): string {
  let path = join(dir, name)
  for (let n = 2; existsSync(path); n++) path = join(dir, `${stemOf(name)} (${n})${PIXL_EXT}`)
  return path
}

/**
 * Where a new project for `photoPath` goes. `imageNames` are the image files
 * in its folder (for a RAW+JPEG pair's names). The directory is made if need
 * be; the path returned does not exist yet.
 */
export function newProjectPath(
  photoPath: string,
  loc: ProjectLocation,
  imageNames: string[],
  home: string = homedir()
): string {
  const folder = dirname(photoPath)
  const name = projectName(basename(photoPath), imageNames)
  if (loc === 'beside' && writable(folder)) return free(folder, name)
  const dir = projectsDirFor(projectsRoot(loc === 'beside' ? 'home' : loc, home), folder)
  mkdirSync(dir, { recursive: true })
  return free(dir, name)
}

/** The `.pixl` files in a directory (none when it cannot be read). */
export function projectFilesIn(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((n) => n.toLowerCase().endsWith(PIXL_EXT) && !n.startsWith('.'))
      .map((n) => join(dir, n))
  } catch {
    return []
  }
}

/** Every place a folder's projects may be: beside its photos, and its subfolder in each projects folder. */
export function projectDirsFor(folder: string, roots: string[]): string[] {
  return [folder, ...roots.map((r) => projectsDirFor(r, folder))]
}

/** Read `projects.pastFolders`: the folders chosen before the one in use. */
export function pastFoldersOf(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((f): f is string => typeof f === 'string') : []
}
