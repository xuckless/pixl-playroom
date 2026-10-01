/**
 * Where a photo's `.pixl` project goes, and how projects are found again.
 *
 * - Beside the photo (the default): `IMG_0001.pixl` next to `IMG_0001.CR3`.
 *   When another photo in the folder shares the name's stem (a RAW and its
 *   JPEG), each project keeps its extension: `IMG_0001.CR3.pixl`.
 * - In a projects folder (`~/Pixl Projects`, or one the user chose): one
 *   subfolder per photo folder, named after it and told apart by a short hash
 *   of its path, so two folders called "Export" never share projects.
 *
 * A folder that cannot be written (a locked card, a read-only share) puts
 * its projects in the projects folder instead.
 */
import { createHash } from 'crypto'
import { accessSync, constants, existsSync, mkdirSync, readdirSync } from 'fs'
import { homedir } from 'os'
import { basename, dirname, extname, join } from 'path'
import { PIXL_EXT } from './pixlfile'

/** The setting `projects.location`: beside the photo, the default folder, or a folder of the user's. */
export type ProjectLocation = 'beside' | 'home' | { folder: string }

export const DEFAULT_PROJECTS_DIR = join(homedir(), 'Pixl Projects')

export function projectsRoot(loc: ProjectLocation): string {
  return typeof loc === 'object' ? loc.folder : DEFAULT_PROJECTS_DIR
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
  imageNames: string[]
): string {
  const folder = dirname(photoPath)
  const name = projectName(basename(photoPath), imageNames)
  if (loc === 'beside' && writable(folder)) return free(folder, name)
  const dir = projectsDirFor(projectsRoot(loc === 'beside' ? 'home' : loc), folder)
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

/** Read the setting's stored value (anything else is the default). */
export function locationOf(v: unknown): ProjectLocation {
  if (v === 'home') return 'home'
  if (v && typeof v === 'object' && typeof (v as { folder?: unknown }).folder === 'string')
    return { folder: (v as { folder: string }).folder }
  return 'beside'
}
