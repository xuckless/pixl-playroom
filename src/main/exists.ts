/** `existsSync` for request paths: a stat off the main thread's back. */
import { access, stat } from 'fs/promises'

export function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false
  )
}

/**
 * Whether two paths name one file on disk: the same device and inode, so a
 * name differing only in case (on a case-insensitive disk) or a hard link
 * counts. False when either is missing.
 */
export async function sameFile(a: string, b: string): Promise<boolean> {
  if (a === b) return true
  try {
    const [x, y] = await Promise.all([stat(a, { bigint: true }), stat(b, { bigint: true })])
    return x.ino !== 0n && x.dev === y.dev && x.ino === y.ino
  } catch {
    return false
  }
}
