import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { NoiseEstimate } from '../shared/engine-types'
import type { ExportSettings } from '../shared/export'
import {
  IPC,
  type AppError,
  type BasicSetting,
  type DevelopSession,
  type EngineStatus,
  type EnhanceProgress,
  type ExportPreset,
  type ExportProgress,
  type FolderListing,
  type HistoryEntry,
  type LibraryItem,
  type LutProfile,
  type MetaPatch,
  type Preset,
  type RegionRequest,
  type RegionResult,
  type RenderEvent,
  type RenderScale,
  type SampleResult,
  type Snapshot,
  type ViewState
} from '../shared/ipc'
import type { Recipe, RecipeGroup } from '../shared/recipe'

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const r = (await ipcRenderer.invoke(channel, ...args)) as
    { ok: true; value: T } | { ok: false; error: AppError }
  if (r.ok) return r.value
  const err = new Error(r.error.message) as Error & { code: string; field?: string }
  err.code = r.error.code
  err.field = r.error.field
  throw err
}

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  app: {
    cpus: () => call<number>(IPC.app.cpus),
    engineStatus: () => call<EngineStatus>(IPC.app.engineStatus),
    getSetting: <T>(key: string) => call<T | null>(IPC.app.getSetting, key),
    setSetting: (key: string, value: unknown) => call<void>(IPC.app.setSetting, key, value),
    reveal: (path: string) => call<void>(IPC.app.reveal, path),
    renderScale: () => call<RenderScale>(IPC.app.renderScale),
    restart: () => call<void>(IPC.app.restart),
    onRenderScale: (cb: (s: RenderScale) => void) => on(IPC.app.renderScaleChanged, cb),
    pathOf: (file: File) => webUtils.getPathForFile(file)
  },
  library: {
    chooseFolder: () => call<string | null>(IPC.library.chooseFolder),
    openFolder: (folder: string) => call<FolderListing>(IPC.library.openFolder, folder),
    recentFolders: () => call<string[]>(IPC.library.recentFolders),
    setMeta: (keys: string[], patch: MetaPatch) =>
      call<(LibraryItem | undefined)[]>(IPC.library.setMeta, keys, patch),
    createCopy: (key: string) => call<LibraryItem>(IPC.library.createCopy, key),
    deleteCopy: (key: string) => call<void>(IPC.library.deleteCopy, key),
    /** `sourceKey` is the photo the recipe came from, so a white balance can change units. */
    applyRecipe: (keys: string[], recipe: Recipe, groups: RecipeGroup[], sourceKey?: string) =>
      call<(LibraryItem | undefined)[]>(IPC.library.applyRecipe, keys, recipe, groups, sourceKey),
    resetRecipe: (keys: string[]) =>
      call<(LibraryItem | undefined)[]>(IPC.library.resetRecipe, keys),
    prioritize: (keys: string[]) => call<void>(IPC.library.prioritize, keys),
    onThumb: (cb: (p: { key: string; url: string | null; unreadable?: boolean }) => void) =>
      on(IPC.library.thumb, cb),
    onChanged: (cb: (p: { folder: string }) => void) => on(IPC.library.changed, cb)
  },
  develop: {
    open: (key: string) => call<DevelopSession>(IPC.develop.open, key),
    close: (key: string) => call<void>(IPC.develop.close, key),
    update: (key: string, recipe: Recipe, interactive: boolean) =>
      call<void>(IPC.develop.update, key, recipe, interactive),
    view: (key: string, view: ViewState) => call<void>(IPC.develop.view, key, view),
    region: (req: RegionRequest) => call<RegionResult>(IPC.develop.region, req),
    sample: (key: string, x: number, y: number) =>
      call<SampleResult>(IPC.develop.sample, key, x, y),
    autoTone: (key: string) => call<BasicSetting>(IPC.develop.autoTone, key),
    autoWb: (key: string) => call<SampleResult['wb']>(IPC.develop.autoWb, key),
    noise: (key: string) => call<NoiseEstimate | null>(IPC.develop.noise, key),
    putPlane: (png: string) => call<string>(IPC.develop.putPlane, png),
    getPlane: (ref: string) => call<string>(IPC.develop.getPlane, ref),
    saveSnapshots: (key: string, snapshots: Snapshot[]) =>
      call<void>(IPC.develop.saveSnapshots, key, snapshots),
    historyList: (key: string) => call<HistoryEntry[]>(IPC.develop.historyList, key),
    historyAppend: (key: string, label: string, recipe: Recipe) =>
      call<HistoryEntry>(IPC.develop.historyAppend, key, label, recipe),
    onRendered: (cb: (e: RenderEvent) => void) => on(IPC.develop.rendered, cb),
    onRenderError: (
      cb: (e: { key: string; message: string; code: string; field?: string }) => void
    ) => on(IPC.develop.renderError, cb)
  },
  presets: {
    list: () => call<Preset[]>(IPC.presets.list),
    save: (p: Omit<Preset, 'id' | 'builtin'> & { id?: string }) =>
      call<Preset>(IPC.presets.save, p),
    remove: (id: string) => call<void>(IPC.presets.remove, id),
    luts: () => call<LutProfile[]>(IPC.presets.luts),
    importLut: () => call<LutProfile[]>(IPC.presets.importLut)
  },
  export: {
    chooseFolder: () => call<string | null>(IPC.export.chooseFolder),
    start: (keys: string[], settings: ExportSettings) =>
      call<string>(IPC.export.start, keys, settings),
    cancel: (id: string) => call<void>(IPC.export.cancel, id),
    presets: () => call<ExportPreset[]>(IPC.export.presets),
    savePreset: (p: Omit<ExportPreset, 'id'> & { id?: string }) =>
      call<ExportPreset>(IPC.export.savePreset, p),
    removePreset: (id: string) => call<void>(IPC.export.removePreset, id),
    onProgress: (cb: (p: ExportProgress) => void) => on(IPC.export.progress, cb)
  },
  enhance: {
    available: () => call<{ available: boolean; reason?: string }>(IPC.enhance.available),
    run: (key: string, choice: 'auto' | 'cpu') => call<void>(IPC.enhance.run, key, choice),
    onProgress: (cb: (p: EnhanceProgress) => void) => on(IPC.enhance.progress, cb)
  }
}

export type PlayroomApi = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('playroom', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.playroom = api
}
