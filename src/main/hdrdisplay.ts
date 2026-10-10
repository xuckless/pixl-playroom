/**
 * The window's display as an HDR target (engine 0.18): macOS's EDR headroom
 * through Playroom's native reader (src/native/display, built by
 * scripts/build-native.mjs), or the white and peak stated in Preferences,
 * or typical numbers when the renderer says the screen shows HDR (Windows,
 * which has no reader; a Mac whose reader did not load).
 * Re-read when the displays change and every 2 s on macOS (the headroom
 * moves with the brightness slider and ambient light, and macOS raises it
 * only while a window shows extended-range content); published when it
 * moves enough to render again.
 */
import { app, BrowserWindow, screen } from 'electron'
import log from 'electron-log/main'
import { createRequire } from 'module'
import { join } from 'path'
import {
  displayChanged,
  normaliseDisplaySetting,
  resolveDisplay,
  type DisplayHdr,
  type DisplayHdrSetting
} from '../shared/hdrdisplay'
import { IPC } from '../shared/ipc'

export const DISPLAY_SETTING_KEY = 'display.hdr'

interface Reader {
  headroom(id: number): { current: number; potential: number; reference: number }
}

let reader: Reader | null | undefined
function nativeReader(): Reader | null {
  if (reader !== undefined) return reader
  reader = null
  if (process.platform !== 'darwin') return reader
  // Packaged: beside the app's resources. A checkout: build/native, found
  // from the app's path, the bundle, or where the app was started.
  const files = app.isPackaged
    ? [join(process.resourcesPath, 'native', 'display.node')]
    : [
        join(app.getAppPath(), 'build', 'native', 'display.node'),
        join(__dirname, '..', '..', 'build', 'native', 'display.node'),
        join(process.cwd(), 'build', 'native', 'display.node')
      ]
  for (const file of files) {
    try {
      // A native addon: required at run time from beside the app, never bundled.
      reader = createRequire(__filename)(file) as Reader
      return reader
    } catch {
      // the next place
    }
  }
  log.warn('display reader not loaded (stated values only)', files.join(', '))
  return reader
}

let setting: DisplayHdrSetting = normaliseDisplaySetting(null)
/** The renderer's `dynamic-range: high` for the window's screen. */
let detected = false
let last: DisplayHdr | null = null
let win: BrowserWindow | null = null

function read(): DisplayHdr {
  const r = nativeReader()
  let measured: { current: number; potential: number } | null = null
  if (r && win && !win.isDestroyed()) {
    try {
      const id = screen.getDisplayMatching(win.getBounds()).id
      measured = r.headroom(id)
    } catch (err) {
      log.warn('display headroom not read', (err as Error).message)
    }
  }
  return resolveDisplay(setting, measured, detected)
}

function publish(): void {
  const next = read()
  if (!displayChanged(last, next)) return
  last = next
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.app.displayHdrChanged, next)
}

/** The window's display now. */
export function displayHdr(): DisplayHdr {
  return (last ??= read())
}

/** Preferences → Display changed. */
export function setDisplaySetting(v: unknown): DisplayHdr {
  setting = normaliseDisplaySetting(v)
  last = null
  publish()
  return displayHdr()
}

/** The renderer says whether the window's screen shows HDR now. */
export function setDisplayDetected(hdr: boolean): DisplayHdr {
  if (hdr !== detected) {
    detected = hdr
    publish()
  }
  return displayHdr()
}

/** Follow `w`'s display: its moves, the displays' changes, and on macOS the headroom. */
export function watchDisplayHdr(w: BrowserWindow, stored: unknown): void {
  win = w
  setting = normaliseDisplaySetting(stored)
  const again = (): void => publish()
  w.on('moved', again)
  screen.on('display-metrics-changed', again)
  screen.on('display-added', again)
  screen.on('display-removed', again)
  if (process.platform === 'darwin' && nativeReader()) {
    const t = setInterval(again, 2000)
    t.unref()
    w.on('closed', () => clearInterval(t))
  }
  publish()
}

export type { DisplayHdr }
