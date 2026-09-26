/** Cache URLs without Electron, so the index process can make them too. See protocol.ts. */
import { relative, sep } from 'path'

export const SCHEME = 'pixl'

/** The URL of a file under the cache root `root`; `version` busts the renderer's image cache. */
export function cacheUrlIn(root: string, file: string, version: string | number): string {
  const rel = relative(root, file).split(sep).map(encodeURIComponent).join('/')
  return `${SCHEME}://c/${rel}?v=${encodeURIComponent(String(version))}`
}
