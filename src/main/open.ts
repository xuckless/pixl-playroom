/**
 * Photos opened from outside the app: Finder's and Explorer's "Open With", a
 * drop on the Dock icon, a path on the command line, or a second launch
 * handing its arguments to the first. They wait here until the renderer has
 * booted and takes them; after that they go straight to it.
 */
import { statSync } from 'fs'
import { extname, isAbsolute, resolve, sep } from 'path'
import { IMAGE_EXTENSIONS } from './source'

const OPENABLE = new Set(IMAGE_EXTENSIONS)

/**
 * The photos and folders among a launch's arguments. `skip` drops the
 * executable (and, in development, the app path Electron was started with);
 * switches are ignored, relative paths resolve against `cwd`, and only
 * existing folders and files Playroom can read are kept. A folder comes back
 * with a trailing separator, so the renderer can tell it from a file.
 */
export function pathsFromArgv(argv: readonly string[], cwd: string, skip: number): string[] {
  const out: string[] = []
  for (const arg of argv.slice(skip)) {
    if (!arg || arg.startsWith('-')) continue
    const path = openable(isAbsolute(arg) ? arg : resolve(cwd, arg))
    if (path && !out.includes(path)) out.push(path)
  }
  return out
}

/** The path as the renderer takes it, or null when it is not a photo or a folder. */
export function openable(path: string): string | null {
  try {
    const st = statSync(path)
    if (st.isDirectory()) return path.endsWith(sep) ? path : path + sep
    if (!st.isFile()) return null
  } catch {
    return null
  }
  return OPENABLE.has(extname(path).slice(1).toLowerCase()) ? path : null
}

let queue: string[] = []
let ready = false
let deliver: ((paths: string[]) => void) | null = null

/** Where opens go once the renderer is up: the main window's webContents. */
export function onOpenPaths(send: (paths: string[]) => void): void {
  deliver = send
}

/** Queues paths until the renderer has taken the first batch, then sends them on. */
export function queueOpen(paths: string[]): void {
  if (paths.length === 0) return
  if (ready && deliver) deliver(paths)
  else for (const p of paths) if (!queue.includes(p)) queue.push(p)
}

/** The renderer's boot: everything waiting, once; later opens are pushed. */
export function takeOpens(): string[] {
  ready = true
  const paths = queue
  queue = []
  return paths
}

/** The window closed or is reloading: queue again until the next boot takes them. */
export function rendererGone(): void {
  ready = false
}
