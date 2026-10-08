/**
 * The engine's safe-shutdown advisory (0.19): while Playroom is out of the
 * way, its engine hosts are let go, and come back with the next work.
 *
 * - Hidden or minimised (or no window at all, on a Mac): after 60 s.
 * - Shown but not the active app: after 120 s.
 *
 * Nothing is cut short: a host is let go only while it runs nothing, and an
 * engine whose queue still holds work (an export, a queued AI batch) is left
 * until the queue is done. While resting, the check repeats, so a host that
 * work woke goes again once it is idle. Coming back starts the interactive
 * engine at once, so the first preview doesn't wait for it.
 */
import { app, BrowserWindow } from 'electron'
import log from 'electron-log/main'
import type { EngineClient } from './engine/client'
import { readdir, rm } from 'fs/promises'
import { basename, join } from 'path'
import { engineTempPid, restDelay } from '../shared/rest'

/** While resting, how often idle hosts are looked at again. */
const RECHECK_MS = 15_000

export interface RestEngine {
  engine: EngineClient
  /** Work still queued for it (an export, an AI batch): it is kept until that is done. */
  busy?: () => boolean
}

function windowState(): { visible: boolean; focused: boolean } {
  const wins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
  return {
    visible: wins.some((w) => w.isVisible() && !w.isMinimized()),
    focused: BrowserWindow.getFocusedWindow() !== null
  }
}

/**
 * Start watching. `wake` runs when Playroom is in use again (the interactive
 * engine starts); `rest`, when it goes to rest (Gemma's server stops).
 */
export function watchRest(engines: RestEngine[], wake: () => void, rest?: () => void): void {
  let timer: NodeJS.Timeout | undefined
  let recheck: NodeJS.Timeout | undefined
  let resting = false
  let deadline = 0

  const letGo = (): void => {
    const gone = engines.filter((e) => !e.busy?.() && e.engine.sleep())
    if (gone.length > 0) log.info(`rest: ${gone.length} engine host(s) let go`)
  }

  const update = (): void => {
    const delay = restDelay(windowState())
    if (delay === null) {
      clearTimeout(timer)
      timer = undefined
      clearInterval(recheck)
      recheck = undefined
      if (resting) {
        resting = false
        log.info('rest: back in use')
        wake()
      }
      return
    }
    if (resting) return
    // Counting down already: whichever deadline comes first (inactive for a
    // while, then minimised, rests 60 s after the minimise at the latest).
    const at = Date.now() + delay
    if (timer && at >= deadline) return
    clearTimeout(timer)
    deadline = at
    timer = setTimeout(() => {
      timer = undefined
      resting = true
      rest?.()
      letGo()
      recheck = setInterval(letGo, RECHECK_MS)
    }, delay)
  }

  // Events land before the window's own state settles: read it a tick later.
  const soon = (): void => void setTimeout(update, 0)
  const watch = (w: BrowserWindow): void => {
    for (const ev of ['hide', 'show', 'minimize', 'restore', 'closed'] as const)
      w.on(ev as 'hide', soon)
  }
  BrowserWindow.getAllWindows().forEach(watch)
  app.on('browser-window-created', (_, w) => watch(w))
  app.on('browser-window-focus', soon)
  app.on('browser-window-blur', soon)
  soon()
}

/** Whether a process is alive (signal 0 tests without sending anything). */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // Not ours to signal, but there.
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * HR-0.19-2: remove engine temps whose process is gone (a host killed
 * mid-write leaves at most one beside its target, the old file whole). The
 * engine keeps nothing between calls, so the sweep is the host's.
 */
export async function sweepEngineTemps(root: string): Promise<number> {
  let names: string[]
  try {
    names = await readdir(root, { recursive: true })
  } catch {
    return 0
  }
  let n = 0
  for (const rel of names) {
    const pid = engineTempPid(basename(rel))
    if (pid === null || alive(pid)) continue
    await rm(join(root, rel), { force: true }).then(
      () => n++,
      () => undefined
    )
  }
  return n
}
