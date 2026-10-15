/**
 * Exports as the renderer sees them: the queue in main (main/exportqueue.ts)
 * as it goes, the receipts of the last few, and the settings Export with
 * previous uses. Fed once from the launch (a window opened again finds what
 * is still running); read by the top bar's pill and the menus.
 */
import { create } from 'zustand'
import { normaliseExportSettings, type ExportSettings } from '../../../shared/export'
import { blocked } from '../../../shared/exportGuards'
import { selectionGuards } from '../../../shared/exportSummary'
import type { ExportProgress } from '../../../shared/ipc'
import { locationMode } from '../../../shared/locations'
import { withExport } from '../lib/activity'
import { api, errorText } from '../lib/api'
import { t, tp } from '../lib/i18n'
import { useLibrary } from './library'

/** How long the toast with Stop stays after an export is queued. */
const STOP_TOAST_MS = 5000

interface ExportsState {
  /** Running and queued first, then the receipts, newest first. */
  jobs: ExportProgress[]
  /** Receipts whose dot is gone: the list was opened since they finished. */
  seen: Record<string, true>
  /** Receipts put away. */
  dismissed: Record<string, true>
  /** What the last export was made with (Export with previous), and the preset's name. */
  last: { settings: ExportSettings; label: string | null } | null
  onProgress(p: ExportProgress): void
  load(): Promise<void>
  /** Queue an export of `keys`: said in a toast that can stop it. Its id, or null when refused. */
  start(keys: string[], settings: ExportSettings, label: string | null): Promise<string | null>
  /** The selection, exported as the last export was. */
  previous(): Promise<void>
  /** The receipts shown in the open list lose their dot. */
  markSeen(): void
  dismiss(id: string): void
}

export const useExports = create<ExportsState>((set, get) => ({
  jobs: [],
  seen: {},
  dismissed: {},
  last: null,
  onProgress(p) {
    set({ jobs: withExport(get().jobs, p) })
  },
  async load() {
    const [jobs, settings, label] = await Promise.all([
      api.export.jobs().catch(() => [] as ExportProgress[]),
      api.app.getSetting<ExportSettings>('export.last').catch(() => null),
      api.app.getSetting<string | null>('export.lastLabel').catch(() => null)
    ])
    let list = get().jobs
    for (const p of jobs) list = withExport(list, p)
    set({
      jobs: list,
      last: settings ? { settings: normaliseExportSettings(settings), label: label ?? null } : null
    })
  },
  async start(keys, settings, label) {
    const lib = useLibrary.getState()
    if (keys.length === 0) {
      lib.say(t('Select photos first'))
      return null
    }
    try {
      const id = await api.export.start(keys, settings, label)
      set({ last: { settings, label } })
      const what = tp('Exporting {{count}} photo', 'Exporting {{count}} photos', keys.length)
      const text = label ? `${what} · ${label}` : what
      lib.say(text, 'info', { label: t('Stop'), run: () => void api.export.cancel(id) })
      setTimeout(() => {
        if (useLibrary.getState().toast?.text === text) useLibrary.setState({ toast: null })
      }, STOP_TOAST_MS)
      return id
    } catch (err) {
      lib.say(errorText(err), 'error')
      return null
    }
  },
  async previous() {
    const last = get().last
    if (!last) return
    const lib = useLibrary.getState()
    const keys = lib.targets()
    if (keys.length === 0) return void lib.say(t('Select photos first'))
    // What would stop the export (the settings', and the disk's: a folder
    // that cannot be written, too little room, an original written over)
    // opens Export, where it is said.
    const byKey = new Map(lib.items.map((i) => [i.key, i]))
    const items = keys.flatMap((k) => (byKey.has(k) ? [byKey.get(k)!] : []))
    const beside = await api.app.locations().then(
      (l) => locationMode(l.exports.location) === 'beside',
      () => true
    )
    const disk = await api.export.check(keys, last.settings).catch(() => [])
    if (blocked([...selectionGuards(last.settings, items, beside), ...disk]))
      return lib.setDialog('export')
    await get().start(keys, last.settings, last.label)
  },
  markSeen() {
    const seen = { ...get().seen }
    for (const p of get().jobs) if (p.finished) seen[p.jobId] = true
    set({ seen })
  },
  dismiss(id) {
    set({ dismissed: { ...get().dismissed, [id]: true } })
  }
}))

/** Follow the queue in main: once, at the launch. */
export function startExportUpkeep(): () => void {
  void useExports.getState().load()
  return api.export.onProgress((p) => useExports.getState().onProgress(p))
}
