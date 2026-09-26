/** Where Playroom keeps what it makes. Everything under userData is a cache or an index — the truth lives beside the photos. */
import { app } from 'electron'
import { mkdirSync } from 'fs'
import { join } from 'path'

const made = new Set<string>()

/** A directory under userData, made the first time it is asked for (the protocol asks per request). */
function dir(...parts: string[]): string {
  const p = join(app.getPath('userData'), ...parts)
  if (!made.has(p)) {
    mkdirSync(p, { recursive: true })
    made.add(p)
  }
  return p
}

export const paths = {
  db: (): string => join(dir(), 'playroom.db'),
  /** The rendering mode and the last display's scale, read before the app is ready. */
  displayState: (): string => join(dir(), 'display.json'),
  /** Per-photo working files: proxies, renders, mask planes. */
  photoCache: (photoId: number): string => dir('cache', 'photos', String(photoId)),
  thumbs: (): string => dir('cache', 'thumbs'),
  luts: (): string => dir('luts'),
  cacheRoot: (): string => dir('cache'),
  /** The bundled AI runtime and model: resources/ai/<platform>-<arch>. */
  ai: (): string =>
    app.isPackaged
      ? join(process.resourcesPath, 'ai')
      : join(app.getAppPath(), 'resources', 'ai', `${process.platform}-${process.arch}`)
}
