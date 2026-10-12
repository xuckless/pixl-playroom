/**
 * Other copies of Playroom that macOS still offers. Launch Services registers
 * every copy of an app it has seen, and Finder's "Open With" lists each one
 * that is still on disk, with its version: the disk image a build was
 * installed from (still mounted), an older copy in Downloads or the Trash, a
 * packaged build in a checkout. An update only replaces the installed copy,
 * so the menu then shows two Playrooms. The installed copy has macOS forget
 * the others (src/main/othercopies.ts).
 */
import { compareVersions } from './policy'

/** A copy registered with Launch Services, and the version its Info.plist states. */
export interface AppCopy {
  path: string
  version: string | null
}

const norm = (path: string): string => path.replace(/\/+$/, '').toLowerCase()

/**
 * The copies the running one (`self`, its bundle path) has macOS forget: every
 * other copy that is no newer than it. Only the installed copy does this (in
 * /Applications or the user's own Applications): one started from a disk
 * image or a checkout must not take the installed one off the menu. A newer
 * copy is left alone, it is the one about to be installed.
 */
export function copiesToForget(
  self: string,
  version: string,
  home: string,
  copies: AppCopy[]
): string[] {
  const own = norm(self)
  const folder = own.slice(0, own.lastIndexOf('/'))
  if (folder !== '/applications' && folder !== norm(`${home}/Applications`)) return []
  return copies
    .filter((c) => norm(c.path) !== own && compareVersions(c.version ?? '', version) <= 0)
    .map((c) => c.path)
}
