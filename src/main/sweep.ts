/**
 * Keeping a photo's caches from growing without end. Everything swept here
 * is made again when wanted: the previews' "before" and mask thumbnails, the
 * planes masks are drawn from, a heal's leftovers, frozen masks.
 */
import { readdir, rm, stat } from 'fs/promises'
import { join } from 'path'

const DAY = 24 * 60 * 60 * 1000

/** Each kind of file, and how long it is kept unused (0: gone whenever swept). */
const RENDERS: [RegExp, number][] = [
  [/^before-/, 0],
  [/^mthumb-/, 0]
]
const CACHE: [RegExp, number][] = [
  [/^heal-/, 0],
  [/^freeze-/, DAY],
  [/^brush-/, 7 * DAY],
  [/^grad-/, 7 * DAY]
]

async function sweep(dir: string, kinds: [RegExp, number][]): Promise<void> {
  const now = Date.now()
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    const kind = kinds.find(([re]) => re.test(name))
    if (!kind) continue
    const file = join(dir, name)
    if (kind[1] > 0) {
      const st = await stat(file).catch(() => null)
      if (!st || now - st.mtimeMs < kind[1]) continue
    }
    await rm(file, { force: true }).catch(() => undefined)
  }
}

/**
 * Sweep a photo's caches as it leaves the develop view: its renders folder
 * (`before-…`, `mthumb-…`, per visit) and its cache folder (a heal's
 * leftovers, frozen masks a day old, mask planes unused for a week).
 */
export async function sweepPhoto(rendersDir: string, cacheDir: string): Promise<void> {
  await sweep(rendersDir, RENDERS)
  await sweep(cacheDir, CACHE)
}
