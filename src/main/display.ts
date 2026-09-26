/**
 * How finely the window is drawn on a scaled Mac display. Performance draws
 * a Retina display at 1.5× and lets macOS scale it to the panel: every
 * layer, blur and backdrop filter costs about half as many pixels, for UI a
 * little softer than native. Ultra draws at 1× (a quarter of the pixels,
 * and the loupe asks for a 1× picture too), softer still. Native draws at
 * the display's own scale.
 *
 * Chromium reads the scale once, from the command line it was started with
 * (`app.commandLine.appendSwitch` is too late for it), so a packaged build
 * that wants Performance and was started without the switch starts itself
 * again with it, before anything shows. Moving to a display that wants the
 * other scale asks for a restart; the next launch picks it on its own.
 *
 * Windows and Linux draw at the display's scale directly (forcing it resizes
 * the UI rather than drawing it coarser), so there is no choice there.
 */
import { app, BrowserWindow, screen, type Display } from 'electron'
import log from 'electron-log/main'
import { execFile } from 'child_process'
import { readFileSync, writeFileSync } from 'fs'
import { IPC, type RenderMode, type RenderScale } from '../shared/ipc'
import { paths } from './paths'

export const PERFORMANCE_SCALE = 1.5
export const ULTRA_SCALE = 1
const SWITCH = 'force-device-scale-factor'

const mac = process.platform === 'darwin'

interface State {
  mode: RenderMode
  /** The native scale of the display the window was last on. */
  scale: number | null
}

let state: State = { mode: 'performance', scale: null }
/** The scale this process was started with, when it was forced. */
let forced: number | null = null
/** Whether this process may start itself again (not in dev, not in automation). */
let canRelaunch = false
/** The native scale of the window's display now. */
let current: number | null = null
const listeners: (() => void)[] = []

// Sync on purpose: read before the app is ready (the scale goes on the
// command line), and written only when the mode or the display changes.
function read(): State {
  try {
    const s = JSON.parse(readFileSync(paths.displayState(), 'utf8')) as Partial<State>
    return {
      mode: s.mode === 'native' || s.mode === 'ultra' ? s.mode : 'performance',
      scale: typeof s.scale === 'number' && s.scale > 0 ? s.scale : null
    }
  } catch {
    return { mode: 'performance', scale: null }
  }
}

function write(): void {
  try {
    writeFileSync(paths.displayState(), JSON.stringify(state))
  } catch (err) {
    log.warn('saving the display state failed', err)
  }
}

/** The scale a mode draws at, where it is below the display's own. */
function scaleOf(mode: RenderMode, native: number | null): number | null {
  if (!mac || native === null) return null
  const s = mode === 'ultra' ? ULTRA_SCALE : mode === 'performance' ? PERFORMANCE_SCALE : null
  return s !== null && native > s ? s : null
}

/** The scale to force for a display of this native scale, or null for native. */
function wanted(native: number | null): number | null {
  return scaleOf(state.mode, native)
}

function relaunch(): void {
  const args = process.argv.slice(1).filter((a) => !a.startsWith(`--${SWITCH}`))
  const scale = wanted(current)
  if (scale !== null) args.push(`--${SWITCH}=${scale}`)
  app.relaunch({ args })
}

/**
 * Before `app.whenReady()`: read the saved mode and, when this launch lacks
 * the scale the last display wanted, start again with it. True when the
 * caller should exit.
 */
export function bootScale(opts: { canRelaunch: boolean }): boolean {
  if (!mac) return false
  state = read()
  current = state.scale
  const v = parseFloat(app.commandLine.getSwitchValue(SWITCH))
  forced = v > 0 ? v : null
  canRelaunch = opts.canRelaunch
  if (!canRelaunch || forced !== null || wanted(current) === null) return false
  relaunch()
  return true
}

/**
 * After ready, before the first window: on a first launch the display is
 * not known yet; learn it (an unforced process sees its true scale) and
 * start again if it wants Performance. True when the caller should exit.
 */
export function settleScale(): boolean {
  if (!mac || state.scale !== null || forced !== null) return false
  current = screen.getPrimaryDisplay().scaleFactor
  state.scale = current
  write()
  if (!canRelaunch || wanted(current) === null) return false
  relaunch()
  return true
}

interface Probed {
  id: number
  width: number
  height: number
  scale: number
}

let probed: Promise<Probed[]> | null = null

const pair = (s: unknown): [number, number] | null => {
  const m = typeof s === 'string' ? /(\d+)\s*x\s*(\d+)/.exec(s) : null
  return m ? [Number(m[1]), Number(m[2])] : null
}

function parseProfile(json: string): Probed[] {
  const out: Probed[] = []
  try {
    const gpus = (JSON.parse(json) as { SPDisplaysDataType?: { spdisplays_ndrvs?: unknown[] }[] })
      .SPDisplaysDataType
    for (const gpu of gpus ?? []) {
      for (const d of (gpu.spdisplays_ndrvs ?? []) as Record<string, unknown>[]) {
        const points = pair(d['_spdisplays_resolution'])
        const pixels = pair(d['_spdisplays_pixels']) ?? points
        if (!points || !pixels || points[0] === 0) continue
        out.push({
          id: Number(d['_spdisplays_displayID']),
          width: points[0],
          height: points[1],
          scale: Math.round((pixels[0] / points[0]) * 100) / 100
        })
      }
    }
  } catch (err) {
    log.warn('reading the display profile failed', err)
  }
  return out
}

/**
 * Every display's native scale, from the system profile: a process started
 * with a forced scale reports that scale for every display.
 */
function probe(): Promise<Probed[]> {
  return new Promise((resolve) =>
    execFile('system_profiler', ['SPDisplaysDataType', '-json'], (err, stdout) =>
      resolve(err ? [] : parseProfile(stdout))
    )
  )
}

async function nativeScale(d: Display): Promise<number | null> {
  if (forced === null) return d.scaleFactor
  probed ??= probe()
  const all = await probed
  const hit =
    all.find((p) => p.id === d.id) ??
    all.find((p) => p.width === d.size.width && p.height === d.size.height)
  return hit?.scale ?? null
}

export function renderScale(): RenderScale {
  const w = wanted(current)
  return {
    available: scaleOf('ultra', current) !== null,
    modes: (['ultra', 'performance', 'native'] as const).filter(
      (m) => m === 'native' || scaleOf(m, current) !== null
    ),
    mode: state.mode,
    target: w,
    native: current,
    active: forced ?? current,
    restartNeeded: canRelaunch && w !== forced,
    canRestart: canRelaunch
  }
}

function publish(): void {
  const s = renderScale()
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.app.renderScaleChanged, s)
  for (const l of listeners) l()
}

/** Called whenever the display or the mode changes (the menu rebuilds itself). */
export function onRenderScale(l: () => void): void {
  listeners.push(l)
}

export function setRenderMode(mode: RenderMode): void {
  if (!mac || mode === state.mode) return
  state.mode = mode
  write()
  if (!canRelaunch && wanted(current) !== forced)
    log.info(
      `rendering: ${mode} applies from the next start` +
        (wanted(current) !== null ? ` (in dev: pnpm dev -- --${SWITCH}=${wanted(current)})` : '')
    )
  publish()
}

/** Quit and start again at the scale the window's display wants. */
export function restart(): void {
  if (!canRelaunch) return
  relaunch()
  app.quit()
}

async function locate(win: BrowserWindow): Promise<void> {
  if (win.isDestroyed()) return
  const n = await nativeScale(screen.getDisplayMatching(win.getBounds()))
  if (n === null || win.isDestroyed()) return
  const changed = n !== current
  current = n
  if (n !== state.scale) {
    state.scale = n
    write()
  }
  if (changed) publish()
}

/** Follow the window across displays, and displays being added, removed or rescaled. */
export function watchDisplay(win: BrowserWindow): void {
  if (!mac) return
  let t: NodeJS.Timeout | undefined
  const check = (): void => {
    clearTimeout(t)
    t = setTimeout(() => void locate(win), 400)
  }
  const reprobe = (): void => {
    probed = null
    check()
  }
  const metrics = (_e: unknown, _d: Display, changed: string[]): void => {
    if (changed.includes('bounds') || changed.includes('scaleFactor')) reprobe()
  }
  win.on('moved', check)
  screen.on('display-added', reprobe)
  screen.on('display-removed', reprobe)
  screen.on('display-metrics-changed', metrics)
  win.on('closed', () => {
    clearTimeout(t)
    screen.off('display-added', reprobe)
    screen.off('display-removed', reprobe)
    screen.off('display-metrics-changed', metrics)
  })
  void locate(win)
}
