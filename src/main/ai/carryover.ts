/**
 * A model whose roster version moved while its files stayed the same (SAM 2.1
 * tiny went 1.0.0 → 1.0.1 with engine 0.17, byte for byte): the copy an
 * earlier release downloaded, under `<models>/<id>/<old version>/`, is moved
 * to the new version's folder rather than downloaded again. Only a folder
 * holding every file at the roster's size and SHA-256 is taken.
 *
 * Pure (no Electron), for tests/carryover.test.ts.
 */
import { createHash } from 'crypto'
import { createReadStream } from 'fs'
import { readdir, rename, rm, stat } from 'fs/promises'
import { join } from 'path'
import { pipeline } from 'stream/promises'

export interface CarriedModel {
  id: string
  version: string
  files: { name: string; bytes: number; sha256: string }[]
}

async function sha256(file: string): Promise<string> {
  const h = createHash('sha256')
  await pipeline(createReadStream(file), h)
  return h.digest('hex')
}

/** True when an older version's folder held this version's files and is now its folder. */
export async function carryOver(modelsRoot: string, m: CarriedModel): Promise<boolean> {
  const base = join(modelsRoot, m.id)
  const dest = join(base, m.version)
  for (const name of await readdir(base).catch(() => [] as string[])) {
    const dir = join(base, name)
    if (name === m.version || !(await stat(dir).catch(() => null))?.isDirectory()) continue
    let same = true
    for (const f of m.files) {
      const s = await stat(join(dir, f.name)).catch(() => null)
      if (!s || s.size !== f.bytes || (await sha256(join(dir, f.name))) !== f.sha256) {
        same = false
        break
      }
    }
    if (!same) continue
    // What a part download left under the new version gives way to the whole copy.
    await rm(dest, { recursive: true, force: true })
    await rename(dir, dest)
    return true
  }
  return false
}

/**
 * What under `<models>` no release uses any more, as `id` (a retired model)
 * or `id/version` (a version a shipped model has moved on from): for the
 * store to delete, after it has carried over what it could. `shipped` maps
 * each shipped id to its version; `keep` names other folders to leave
 * (on-demand models).
 */
export async function retiredModelDirs(
  modelsRoot: string,
  shipped: ReadonlyMap<string, string>,
  keep: ReadonlySet<string>
): Promise<string[]> {
  const out: string[] = []
  for (const d of await readdir(modelsRoot, { withFileTypes: true }).catch(() => [])) {
    if (!d.isDirectory() || d.name.startsWith('.') || keep.has(d.name)) continue
    const version = shipped.get(d.name)
    if (!version) {
      out.push(d.name)
      continue
    }
    for (const v of await readdir(join(modelsRoot, d.name), { withFileTypes: true }).catch(
      () => []
    ))
      if (v.isDirectory() && v.name !== version) out.push(`${d.name}/${v.name}`)
  }
  return out
}
