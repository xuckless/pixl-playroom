/**
 * `pixl://c/<path>` serves the cache (renders, thumbnails, mask planes) to
 * the renderer without base64 or IPC copies. Only files under the cache root
 * are served; anything else is a 404.
 */
import { net, protocol } from 'electron'
import { resolve, sep } from 'path'
import { pathToFileURL } from 'url'
import { cacheUrlIn, SCHEME } from './cache-url'
import { paths } from './paths'

export { SCHEME }

/** Must run before `app.whenReady()`. */
export function registerSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true
      }
    }
  ])
}

export function registerProtocol(): void {
  protocol.handle(SCHEME, (request) => {
    const url = new URL(request.url)
    const rel = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
    const root = paths.cacheRoot()
    const file = resolve(root, rel)
    if (url.hostname !== 'c' || !(file === root || file.startsWith(root + sep))) {
      return new Response('not found', { status: 404 })
    }
    // Readable by the renderer's canvases (clipping overlays, pickers): the
    // renderer's own origin differs from this scheme's.
    return net.fetch(pathToFileURL(file).toString()).then((res) => {
      const headers = new Headers(res.headers)
      headers.set('Access-Control-Allow-Origin', '*')
      headers.set('Cache-Control', 'no-store')
      return new Response(res.body, { status: res.status, headers })
    })
  })
}

/** The URL of a cache file; `version` busts the renderer's image cache. */
export function cacheUrl(file: string, version: string | number): string {
  return cacheUrlIn(paths.cacheRoot(), file, version)
}
