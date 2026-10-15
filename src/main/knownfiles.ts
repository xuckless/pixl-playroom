/**
 * Cache files known to be on disk, so a hot path (every draft of a drag
 * compiles its mask planes) skips the stat that would say so again. Plane
 * files are named by what they hold, so one known is the right one; what
 * deletes them (a sweep, a prune) forgets them here.
 *
 * Free of Electron, for tests/perf.test.ts.
 */
import { resolve, sep } from 'path'

export class KnownFiles {
  private files = new Set<string>()

  has(file: string): boolean {
    return this.files.has(file)
  }

  add(file: string): void {
    this.files.add(file)
  }

  /** Forget the files directly in `dir` (or only those whose name starts with `prefix`). */
  forget(dir: string, prefix = ''): void {
    const root = resolve(dir) + sep + prefix
    for (const f of this.files) {
      if (f.startsWith(root) && !f.slice(root.length - prefix.length).includes(sep))
        this.files.delete(f)
    }
  }

  get size(): number {
    return this.files.size
  }
}
