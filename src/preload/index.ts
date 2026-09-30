import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { NoiseEstimate, Transform } from '../shared/engine-types'
import type { GuideLine } from '../shared/upright'
import type { P as SpotPoint } from '../shared/retouch'
import type { ExportSettings } from '../shared/export'
import type { LensProfile } from '../shared/lens'
import {
  IPC,
  type AppError,
  type AutoWbResult,
  type BasicSetting,
  type CaMeasurement,
  type DenoiseState,
  type ModelInfo,
  type ProviderInfo,
  type Collection,
  type CrashConsent,
  type ErrorReport,
  type DevelopSession,
  type EngineStatus,
  type ExportPreset,
  type ExportProgress,
  type FolderListing,
  type HistoryLog,
  type KeywordNode,
  type LibraryItem,
  type LibrarySource,
  type LutProfile,
  type MetaPatch,
  type MetaTextPatch,
  type Preset,
  type Prefs,
  type RegionRequest,
  type RegionResult,
  type RenderEvent,
  type RenderScale,
  type SampleResult,
  type Snapshot,
  type SourceListing,
  type UpdateChannel,
  type UpdateState,
  type ViewState
} from '../shared/ipc'
import type { LicenceStatus } from '../shared/licence'
import type { Recipe, RecipeGroup } from '../shared/recipe'
import type { AiCapabilities, AiJobEvent, AiStartRequest } from '../shared/ai'
import type { EnhanceRates } from '../shared/enhance'

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
    takeOpens: () => call<string[]>(IPC.app.takeOpens),
    onOpenPaths: (cb: (paths: string[]) => void) => on(IPC.app.openPaths, cb),
    pathOf: (file: File) => webUtils.getPathForFile(file),
    onOpenPreferences: (cb: () => void) => on(IPC.app.openPreferences, cb),
    onOpenEngineReport: (cb: () => void) => on(IPC.app.openEngineReport, cb),
    reportError: (e: ErrorReport) => call<void>(IPC.app.reportError, e),
    openNotices: () => call<void>(IPC.app.openNotices)
  },
  updates: {
    getState: () => call<UpdateState>(IPC.updates.getState),
    check: () => call<UpdateState>(IPC.updates.check),
    install: () => call<void>(IPC.updates.install),
    setChannel: (channel: UpdateChannel) => call<UpdateState>(IPC.updates.setChannel, channel),
    onState: (cb: (s: UpdateState) => void) => on(IPC.updates.event, cb)
  },
  licence: {
    status: () => call<LicenceStatus>(IPC.licence.status),
    activate: (key: string) => call<LicenceStatus>(IPC.licence.activate, key),
    deactivate: () => call<LicenceStatus>(IPC.licence.deactivate),
    validate: () => call<LicenceStatus>(IPC.licence.validate),
    onChange: (cb: (s: LicenceStatus) => void) => on(IPC.licence.changed, cb)
  },
  prefs: {
    get: () => call<Prefs>(IPC.prefs.get),
    setCrashReports: (c: CrashConsent) => call<CrashConsent>(IPC.prefs.setCrashReports, c)
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
    onChanged: (cb: (p: { folder: string }) => void) => on(IPC.library.changed, cb),
    openSource: (source: LibrarySource) => call<SourceListing>(IPC.library.openSource, source),
    resolvePaths: (paths: string[]) =>
      call<{ folder: string | null; keys: string[] }>(IPC.library.resolvePaths, paths),
    setMetadata: (keys: string[], patch: MetaTextPatch) =>
      call<(LibraryItem | undefined)[]>(IPC.library.setMetadata, keys, patch),
    keywordTree: () => call<KeywordNode[]>(IPC.library.keywordTree),
    collections: () => call<Collection[]>(IPC.library.collections),
    saveCollection: (c: Omit<Collection, 'id' | 'count'> & { id?: string }) =>
      call<Collection>(IPC.library.saveCollection, c),
    removeCollection: (id: string) => call<void>(IPC.library.removeCollection, id),
    collectionItems: (id: string, keys: string[], action: 'add' | 'remove') =>
      call<void>(IPC.library.collectionItems, id, keys, action),
    /** Asks where to save; null when cancelled. */
    exportCollections: (ids: string[]) => call<string | null>(IPC.library.exportCollections, ids),
    /** Asks for a file; the collections it added. */
    importCollections: () => call<Collection[]>(IPC.library.importCollections),
    stack: (keys: string[], cover: string) =>
      call<(LibraryItem | undefined)[]>(IPC.library.stack, keys, cover),
    unstack: (keys: string[]) => call<(LibraryItem | undefined)[]>(IPC.library.unstack, keys),
    stackTop: (key: string) => call<(LibraryItem | undefined)[]>(IPC.library.stackTop, key),
    autoStack: (folder: string, seconds: number) =>
      call<number>(IPC.library.autoStack, folder, seconds),
    duplicates: (folder: string | null, threshold: number) =>
      call<SourceListing>(IPC.library.duplicates, folder, threshold),
    autoWb: (keys: string[]) => call<AutoWbResult>(IPC.library.autoWb, keys),
    setWb: (pairs: { key: string; wb: Recipe['wb'] }[]) =>
      call<(LibraryItem | undefined)[]>(IPC.library.setWb, pairs),
    onSourcesChanged: (cb: () => void) => on(IPC.library.sourcesChanged, cb)
  },
  develop: {
    open: (key: string) => call<DevelopSession>(IPC.develop.open, key),
    close: (key: string) => call<void>(IPC.develop.close, key),
    update: (key: string, recipe: Recipe, interactive: boolean, rev?: number) =>
      call<void>(IPC.develop.update, key, recipe, interactive, rev),
    view: (key: string, view: ViewState) => call<void>(IPC.develop.view, key, view),
    region: (req: RegionRequest) => call<RegionResult>(IPC.develop.region, req),
    sample: (key: string, x: number, y: number) =>
      call<SampleResult>(IPC.develop.sample, key, x, y),
    autoTone: (key: string) => call<BasicSetting>(IPC.develop.autoTone, key),
    autoWb: (key: string) => call<SampleResult['wb']>(IPC.develop.autoWb, key),
    noise: (key: string) => call<NoiseEstimate | null>(IPC.develop.noise, key),
    measureCa: (key: string) => call<CaMeasurement>(IPC.develop.measureCa, key),
    denoiseState: (key: string) => call<DenoiseState>(IPC.develop.denoiseState, key),
    suggestHeal: (
      key: string,
      points: SpotPoint[],
      radius: number,
      feather: number,
      kind: 'heal' | 'clone'
    ) => call<SpotPoint>(IPC.develop.suggestHeal, key, points, radius, feather, kind),
    suggestUpright: (key: string, mode: 'Level' | 'Vertical' | 'Full', focal: number) =>
      call<Transform>(IPC.develop.suggestUpright, key, mode, focal),
    uprightFromLines: (key: string, lines: GuideLine[], focal: number) =>
      call<Transform>(IPC.develop.uprightFromLines, key, lines, focal),
    putPlane: (png: string) => call<string>(IPC.develop.putPlane, png),
    getPlane: (ref: string) => call<string>(IPC.develop.getPlane, ref),
    saveSnapshots: (key: string, snapshots: Snapshot[]) =>
      call<void>(IPC.develop.saveSnapshots, key, snapshots),
    historyList: (key: string) => call<HistoryLog>(IPC.develop.historyList, key),
    historyAppend: (key: string, label: string, recipe: Recipe) =>
      call<HistoryLog>(IPC.develop.historyAppend, key, label, recipe),
    historySetHidden: (key: string, seqs: number[], hidden: boolean) =>
      call<HistoryLog>(IPC.develop.historySetHidden, key, seqs, hidden),
    historyDelete: (key: string, seqs: number[]) =>
      call<HistoryLog>(IPC.develop.historyDelete, key, seqs),
    onRendered: (cb: (e: RenderEvent) => void) => on(IPC.develop.rendered, cb),
    onRenderError: (
      cb: (e: { key: string; message: string; code: string; field?: string }) => void
    ) => on(IPC.develop.renderError, cb)
  },
  models: {
    list: () => call<ModelInfo[]>(IPC.models.list),
    download: (id: string) => call<void>(IPC.models.download, id),
    cancel: (id: string) => call<void>(IPC.models.cancel, id),
    remove: (id: string) => call<void>(IPC.models.remove, id),
    provider: () => call<ProviderInfo>(IPC.models.provider),
    benchmark: () => call<ProviderInfo>(IPC.models.benchmark),
    onEvent: (cb: (models: ModelInfo[]) => void) => on(IPC.models.event, cb)
  },
  lens: {
    profiles: () => call<LensProfile[]>(IPC.lens.profiles),
    importProfiles: () => call<LensProfile[]>(IPC.lens.importProfiles)
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
    /** How fast each step has run here (ms per megapixel), for the panel's estimate. */
    rates: () => call<EnhanceRates>(IPC.enhance.rates)
  },
  ai: {
    start: (req: AiStartRequest) => call<string>(IPC.ai.start, req),
    cancel: (jobId: string) => call<void>(IPC.ai.cancel, jobId),
    list: () => call<AiJobEvent[]>(IPC.ai.list),
    capabilities: () => call<AiCapabilities>(IPC.ai.capabilities),
    onEvent: (cb: (e: AiJobEvent) => void) => on(IPC.ai.event, cb)
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
