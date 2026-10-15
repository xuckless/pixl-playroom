/**
 * Paths built from what a file says (a project's origin, a recipe's plane
 * reference, a collections file's items) kept where they belong. A file
 * a user was given is untrusted: a name in it must never reach outside the
 * cache folder it is filed in, and a path in it must never open a network
 * share or a device just by being looked at (on Windows a UNC path sends
 * the user's NTLM hash to whoever serves it).
 *
 * Free of Electron, for tests/security.test.ts.
 */
import { isAbsolute, resolve, sep, win32 } from 'path'

/** Whether `path` is `root` itself or inside it, lexically (after resolving `..`). */
export function within(root: string, path: string): boolean {
  const r = resolve(root)
  const p = resolve(path)
  return p === r || p.startsWith(r.endsWith(sep) ? r : r + sep)
}

/**
 * `name` in the cache folder `dir`, or a throw when it would land anywhere
 * else: every cache file named from a file's contents is built here.
 */
export function cacheFile(dir: string, name: string): string {
  const path = resolve(dir, name)
  if (/[\\/\0]/.test(name) || !within(dir, path) || path === resolve(dir))
    throw new Error(`refused a cache file outside ${dir}: ${JSON.stringify(name)}`)
  return path
}

/** A Windows device path (`\\.\…`, `\\?\…`, either separator): never a photo. */
export const isDevicePath = (p: string): boolean => /^[\\/]{2}[.?][\\/]/.test(p)

/** A network path (`\\server\share\…` or `//server/share/…`). */
export const isUncPath = (p: string): boolean => !isDevicePath(p) && /^[\\/]{2}[^\\/]/.test(p)

/**
 * Whether a path a file names may be looked at: absolute, no NUL, never a
 * device, and a network path only inside one of `roots` (the folders the
 * user has added to the library: a NAS library is a real one).
 */
export function isSafeLocalPath(p: unknown, roots: readonly string[] = []): p is string {
  if (typeof p !== 'string' || p === '' || p.includes('\0')) return false
  if (isDevicePath(p)) return false
  if (isUncPath(p)) return roots.some((r) => isUncPath(r) && withinUnc(r, p))
  return isAbsolute(p) || win32.isAbsolute(p)
}

/** `within` for network paths, compared as Windows compares them (either separator, any case). */
function withinUnc(root: string, p: string): boolean {
  const norm = (s: string): string =>
    win32
      .normalize(s)
      .replace(/[\\/]+$/, '')
      .toLowerCase()
  const r = norm(root)
  const x = norm(p)
  return x === r || x.startsWith(r + '\\')
}
