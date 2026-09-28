/** IPC channel names and the app-level types both sides of the bridge share. */
import type { ConvertReport, ImageStats, LossReport, SourceInfo, WhitePoint } from './engine-types'
import type { ExportSettings } from './export'
import type { Step } from './history'
import type { BasicSetting, Recipe, RecipeGroup } from './recipe'
import type { SmartGroup } from './smart'

export const IPC = {
  app: {
    cpus: 'app:cpus',
    engineStatus: 'app:engine-status',
    getSetting: 'app:get-setting',
    setSetting: 'app:set-setting',
    reveal: 'app:reveal',
    renderScale: 'app:render-scale',
    restart: 'app:restart',
    /** Paths the OS asked us to open (Open With, a second launch), taken once the renderer is up. */
    takeOpens: 'app:take-opens',
    /** main → renderer: more paths to open */
    openPaths: 'app:open-paths',
    /** main → renderer: the display or the rendering mode changed */
    renderScaleChanged: 'app:render-scale-changed'
  },
  library: {
    chooseFolder: 'library:choose-folder',
    openFolder: 'library:open-folder',
    recentFolders: 'library:recent-folders',
    setMeta: 'library:set-meta',
    createCopy: 'library:create-copy',
    deleteCopy: 'library:delete-copy',
    applyRecipe: 'library:apply-recipe',
    resetRecipe: 'library:reset-recipe',
    /** Thumbnails of these keys first (they are on screen). */
    prioritize: 'library:prioritize',
    /** main → renderer: a thumbnail (re)rendered */
    thumb: 'library:thumb',
    /** main → renderer: the folder's items changed (new file, new copy) */
    changed: 'library:changed',
    /** The items of any source: a folder, a collection, a keyword, the duplicates. */
    openSource: 'library:open-source',
    /** Files → their folder and item keys (indexing the folder if new). */
    resolvePaths: 'library:resolve-paths',
    setMetadata: 'library:set-metadata',
    keywordTree: 'library:keyword-tree',
    collections: 'library:collections',
    saveCollection: 'library:save-collection',
    removeCollection: 'library:remove-collection',
    /** Add or remove items of a manual collection. */
    collectionItems: 'library:collection-items',
    exportCollections: 'library:export-collections',
    importCollections: 'library:import-collections',
    stack: 'library:stack',
    unstack: 'library:unstack',
    stackTop: 'library:stack-top',
    autoStack: 'library:auto-stack',
    duplicates: 'library:duplicates',
    /** Measure and set each photo's own auto white balance. */
    autoWb: 'library:auto-wb',
    /** Put white balances back (the undo of autoWb). */
    setWb: 'library:set-wb',
    /** main → renderer: collections, keywords or metadata changed */
    sourcesChanged: 'library:sources-changed'
  },
  develop: {
    open: 'develop:open',
    close: 'develop:close',
    update: 'develop:update',
    view: 'develop:view',
    region: 'develop:region',
    sample: 'develop:sample',
    autoTone: 'develop:auto-tone',
    autoWb: 'develop:auto-wb',
    /** A painted plane (grey PNG, base64) into the plane store; its reference back. */
    putPlane: 'develop:put-plane',
    getPlane: 'develop:get-plane',
    saveSnapshots: 'develop:save-snapshots',
    historyList: 'develop:history-list',
    historyAppend: 'develop:history-append',
    historySetHidden: 'develop:history-set-hidden',
    historyDelete: 'develop:history-delete',
    noise: 'develop:noise',
    /** main → renderer: a render finished */
    rendered: 'develop:rendered',
    /** main → renderer: a render failed */
    renderError: 'develop:render-error'
  },
  presets: {
    list: 'presets:list',
    save: 'presets:save',
    remove: 'presets:remove',
    importLut: 'presets:import-lut',
    luts: 'presets:luts'
  },
  export: {
    start: 'export:start',
    cancel: 'export:cancel',
    chooseFolder: 'export:choose-folder',
    presets: 'export:presets',
    savePreset: 'export:save-preset',
    removePreset: 'export:remove-preset',
    /** main → renderer */
    progress: 'export:progress'
  },
  enhance: {
    available: 'enhance:available',
    run: 'enhance:run',
    /** main → renderer */
    progress: 'enhance:progress'
  }
} as const

export interface AppError {
  message: string
  code: string
  /** The request field the engine named, when it named one. */
  field?: string
}

export type Result<T> = ({ ok: true } & T) | { ok: false; error: AppError }

export interface EngineStatus {
  status: 'starting' | 'ready' | 'unavailable' | 'crashed'
  version?: string
  enhance?: boolean
  reason?: string
  /** Why the engine is unavailable, when the load named it (e.g. `VersionMismatch`). */
  code?: string
  restarts: number
}

/** Ultra draws a scaled display at 1×, Performance at 1.5×, Native at the display's own scale. */
export type RenderMode = 'ultra' | 'performance' | 'native'

export interface RenderScale {
  /** There is a choice: a Mac display finer than 1×. */
  available: boolean
  /** The modes that differ on this display (Performance is gone at 1.5× and below). */
  modes: RenderMode[]
  mode: RenderMode
  /** The scale this display wants in the chosen mode (null: native). */
  target: number | null
  /** The window's display: its pixels per point, when known. */
  native: number | null
  /** The scale this process draws at (forced at launch, else the display's). */
  active: number | null
  /** The display wants another scale than this process was started with. */
  restartNeeded: boolean
  /** The app can restart itself (a packaged build). */
  canRestart: boolean
}

// ── Library ──────────────────────────────────────────────────────────────────

export type Flag = 'pick' | 'reject' | null
export type ColorLabel = 'red' | 'yellow' | 'green' | 'blue' | 'purple' | null

export interface CameraInfo {
  make: string | null
  model: string | null
  lens: string | null
  iso: number | null
  /** Seconds. */
  exposureTime: number | null
  fNumber: number | null
  focalLength: number | null
  capturedAt: string | null
  gps: { lat: number; lon: number } | null
}

/** One thing in the grid: a photo, or a virtual copy of one. */
export interface LibraryItem {
  key: string
  photoId: number
  /** null for the photo itself. */
  copyId: string | null
  copyName: string | null
  path: string
  name: string
  ext: string
  size: number
  mtime: number
  isRaw: boolean
  rating: number
  flag: Flag
  label: ColorLabel
  edited: boolean
  thumbUrl: string | null
  /** Its thumbnail failed: the file cannot be read (until it changes). */
  unreadable?: boolean
  camera: CameraInfo
  /** The folder the file is in (items of a collection come from many). */
  folder: string
  title: string | null
  caption: string | null
  copyright: string | null
  /** Keyword paths, `|` between levels ("Places|Canada|Winnipeg"). */
  keywords: string[]
  stack: StackInfo | null
  /** The file is not where the index last saw it (a collection's item on an unplugged drive). */
  offline?: boolean
}

export interface StackInfo {
  id: string
  /** 0 is the cover: the one the collapsed stack shows. */
  position: number
  size: number
}

export type LibrarySource =
  | { kind: 'folder'; path: string }
  /** A manual collection, a smart one or a set (the union of its children). */
  | { kind: 'collection'; id: string }
  | { kind: 'keyword'; path: string }
  /** `folder` null: the whole library. `threshold`: the dHash distance still "similar". */
  | { kind: 'duplicates'; folder: string | null; threshold: number }

export interface DuplicateGroup {
  kind: 'exact' | 'near'
  keys: string[]
  /** For near groups: the largest distance inside the group. */
  distance?: number
}

export interface SourceListing {
  source: LibrarySource
  items: LibraryItem[]
  /** The duplicates source: its groups, in order. */
  groups?: DuplicateGroup[]
}

/** What the .xmp sidecar says about a photo. */
export interface PhotoMeta {
  title: string | null
  caption: string | null
  copyright: string | null
  keywords: string[]
}

/** A metadata edit on a selection: fields set outright, keywords added or removed. */
export interface MetaTextPatch {
  title?: string | null
  caption?: string | null
  copyright?: string | null
  /** Replace the keywords outright. */
  keywords?: string[]
  addKeywords?: string[]
  removeKeywords?: string[]
}

export interface KeywordNode {
  name: string
  /** The full path, `|` between levels. */
  path: string
  /** Photos with this keyword or any under it. */
  count: number
  children: KeywordNode[]
}

export interface Collection {
  id: string
  name: string
  kind: 'manual' | 'smart' | 'set'
  /** A set this one sits in. */
  parent: string | null
  rules: SmartGroup | null
  sort: number
  count?: number
}

export interface AutoWbResult {
  items: (LibraryItem | undefined)[]
  /** Each key's white balance before, for undo. */
  previous: Record<string, Recipe['wb']>
  failed: { key: string; message: string }[]
}

export interface FolderListing {
  folder: string
  items: LibraryItem[]
}

export interface MetaPatch {
  rating?: number
  flag?: Flag
  label?: ColorLabel
}

// ── Develop ──────────────────────────────────────────────────────────────────

export interface Snapshot {
  id: string
  name: string
  at: string
  recipe: Recipe
}

/** Where a photo's history starts: the recipe it had when first opened. */
export interface HistoryBase {
  seq: number
  label: string
  at: string
  recipe: Recipe
}

/**
 * A photo's edit history: its base, and every settled edit since as a step
 * holding only what it changed (see `shared/history.ts`). The recipe is the
 * base with every visible step replayed; `base` is null before the first
 * open.
 */
export interface HistoryLog {
  base: HistoryBase | null
  steps: Step[]
}

export interface DevelopSession {
  key: string
  item: LibraryItem
  info: SourceInfo
  isRaw: boolean
  isHdr: boolean
  asShot: WhitePoint | null
  /** The full-resolution base frame (upright, before the user's turns). */
  frameWidth: number
  frameHeight: number
  /** The proxy previews are rendered from. */
  proxyWidth: number
  proxyHeight: number
  recipe: Recipe
  snapshots: Snapshot[]
  seed: number
}

export interface ViewState {
  /** Crop tool open: render the whole, unrotated frame. */
  cropMode: boolean
  /** Also render the "before" (default recipe) for comparison and the ghost bars. */
  before: boolean
  /** Render this local layer's mask as an overlay, and measure inside it. */
  maskLayer: string | null
  /** Also render every mask small (the masks panel's thumbnails, "show all"). */
  maskThumbs?: boolean
  /** Longest edge wanted from the renderer, in device pixels. */
  targetEdge: number
}

export interface RenderReport {
  totalMs: number
  decodeMs: number
  colorMs: number
  encodeMs: number
  gradeLines: string[]
  clampedSamples: number
  loss: LossReport
  notes: string[]
  colorSpace: string
}

export interface RenderEvent {
  key: string
  seq: number
  kind: 'draft' | 'full' | 'before' | 'mask' | 'mask-thumb'
  url: string
  /** A mask thumbnail's layer. */
  layerId?: string
  /** The view the render was made for: the crop tool's whole frame, or the framed picture. */
  cropMode?: boolean
  width: number
  height: number
  /** Present for picture renders: the measurements behind the histogram and hue chart. */
  stats?: ImageStats
  /** Present for a mask render with the masked-region hue chart. */
  maskStats?: ImageStats
  /**
   * Present for a settled render of a PQ/HLG photo: the graded picture as an
   * HDR export would hold it, measured in linear light (1.0 is reference
   * white; the histograms span `0…range_max`).
   */
  hdrStats?: ImageStats
  report?: RenderReport
}

export interface RegionRequest {
  key: string
  /** In pixels of the full-resolution user-oriented frame. */
  x: number
  y: number
  width: number
  height: number
  /** Output pixels per frame pixel (1 for 100%). */
  zoom: number
  /** Also render this layer's mask over the same region (the overlay at 1:1). */
  maskLayer?: string | null
}

export interface RegionResult {
  url: string
  x: number
  y: number
  width: number
  height: number
  ms: number
  /** The requested layer's mask over the same region, when asked for. */
  maskUrl?: string
}

export interface SampleResult {
  /** Linear Rec.2020 of the source (before the white balance), averaged over 5×5. */
  linear: [number, number, number]
  wb: { temperature: number; tint: number; clamped: boolean } | null
}

// ── Presets ──────────────────────────────────────────────────────────────────

export interface Preset {
  id: string
  name: string
  group: string
  builtin: boolean
  groups: RecipeGroup[]
  recipe: Recipe
}

export interface LutProfile {
  name: string
  path: string
}

export interface ExportPreset {
  id: string
  name: string
  settings: ExportSettings
}

export interface ExportProgress {
  jobId: string
  done: number
  total: number
  current: string | null
  errors: { name: string; message: string }[]
  finished: boolean
  outputs: string[]
}

export interface EnhanceProgress {
  key: string
  phase: 'running' | 'done' | 'error'
  message: string
  output?: string
}

export type { BasicSetting, ConvertReport }
