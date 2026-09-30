/**
 * The lens profile store: one JSON file per lens in `userData/lens-profiles`
 * (the format is `LensProfile` in `shared/lens.ts`). Imported by the user
 * for now; filled from Lensfun and the corrections cameras embed later.
 */
import log from 'electron-log/main'
import { readdir, readFile, writeFile } from 'fs/promises'
import { basename, extname, join } from 'path'
import { validateProfile, type LensProfile } from '../shared/lens'
import { paths } from './paths'

/** Every profile in the store that reads; a file that does not is logged and left out. */
export async function listProfiles(): Promise<LensProfile[]> {
  const dir = paths.lensProfiles()
  const files = (await readdir(dir)).filter((f) => extname(f).toLowerCase() === '.json').sort()
  const out: LensProfile[] = []
  for (const f of files) {
    try {
      const p = validateProfile(
        JSON.parse(await readFile(join(dir, f), 'utf8')),
        basename(f, '.json')
      )
      if (typeof p === 'string') log.warn('lens profile refused', f, p)
      else out.push(p)
    } catch (err) {
      log.warn('lens profile unreadable', f, (err as Error).message)
    }
  }
  return out
}

/**
 * Copy profiles into the store after checking each; a file that is not a
 * profile is refused by name with the reason, and nothing of it is kept.
 */
export async function importProfiles(files: string[]): Promise<LensProfile[]> {
  const out: LensProfile[] = []
  for (const f of files) {
    const id = basename(f, extname(f))
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(f, 'utf8'))
    } catch {
      throw new Error(`${basename(f)} is not JSON`)
    }
    const p = validateProfile(parsed, id)
    if (typeof p === 'string') throw new Error(`${basename(f)}: ${p}`)
    await writeFile(join(paths.lensProfiles(), `${id}.json`), JSON.stringify(parsed, null, 2))
    out.push(p)
  }
  return out
}
