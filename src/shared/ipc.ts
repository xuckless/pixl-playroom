/** IPC channel names and the app-level types both sides of the bridge share. */
import type { ConvertReport, ImageStats, LossReport, SourceInfo, WhitePoint } from './engine-types'
import type { ExportSettings } from './export'
import type { BasicSetting, Recipe, RecipeGroup } from './recipe'

export const IPC = {
  app: {
    cpus: 'app:cpus',
    engineStatus: 'app:engine-status',
    getSetting: 'app:get-setting',
    setSetting: 'app:set-setting',
    reveal: 'app:reveal'
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
    /** main → renderer: a thumbnail (re)rendered */
    thumb: 'library:thumb',
    /** main → renderer: the folder's items changed (new file, new copy) */
    changed: 'library:changed'
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
    encodeMask: 'develop:encode-mask',
    saveSnapshots: 'develop:save-snapshots',
    historyList: 'develop:history-list',
    historyAppend: 'develop:history-append',
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
  restarts: number
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
  camera: CameraInfo
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

export interface HistoryEntry {
  seq: number
  label: string
  at: string
  recipe: Recipe
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
