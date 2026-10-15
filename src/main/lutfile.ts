/**
 * The LUTs a recipe names, found in Playroom's LUT folder (`paths.luts()`,
 * where Import .cube… copies them) and nowhere else. A recipe travels in a
 * sidecar or a project someone else may have written, so the path it names
 * is only a name: its last part is looked up in the folder, and a file not
 * there, not a plain file, or larger than any cube is missing (the render
 * says so) rather than opened. The engine reads a `Path` LUT whole, so a
 * device (`/dev/zero`) or a network share must never reach it.
 *
 * Free of Electron (the folder is passed in), for tests/security.test.ts.
 */
import { stat } from 'fs/promises'
import { lutNamesOf } from '../shared/compile'
import { isBareName } from '../shared/ids'
import type { Recipe } from '../shared/recipe'
import { cacheFile } from './contain'

/** Larger than any cube a grade uses (a 65-point one is about 8 MB of text). */
export const LUT_MAX_BYTES = 32 * 1024 * 1024

/** The file in `dir` a LUT path names (its last part), or null when it is not there to read. */
export async function lutFileIn(dir: string, named: string): Promise<string | null> {
  const base = named.split(/[\\/]/).pop() ?? ''
  if (!isBareName(base) || !/\.cube$/i.test(base)) return null
  let file: string
  try {
    file = cacheFile(dir, base)
    const st = await stat(file)
    if (!st.isFile() || st.size === 0 || st.size > LUT_MAX_BYTES) return null
  } catch {
    return null
  }
  return file
}

/** Every LUT the recipe names, by the path it names it by, that is in `dir` (`CompileContext.luts`). */
export async function lutsFor(recipe: Recipe, dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const named of lutNamesOf(recipe)) {
    const file = await lutFileIn(dir, named)
    if (file) out[named] = file
  }
  return out
}
