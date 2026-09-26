/** `existsSync` for request paths: a stat off the main thread's back. */
import { access } from 'fs/promises'

export function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false
  )
}
