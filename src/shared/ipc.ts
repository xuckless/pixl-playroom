import type { ResolvedProfile } from './lens'
/** IPC channel names and the app-level types both sides of the bridge share. */
import type {
  ConvertReport,
  ImageStats,
  LateralCa,
  LossReport,
  SourceInfo,
  WhitePoint
} from './engine-types'
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
    renderScaleChanged: 'app:render-scale-changed',
    /** main → renderer: the menu's Settings… was chosen */
    openPreferences: 'app:open-preferences',
    /** main → renderer: the menu's Engine Report… was chosen */
    openEngineReport: 'app:open-engine-report',
    /** main → renderer: Help → Report a Problem (Settings, at that section). */
    openReport: 'app:open-report',
    /** An uncaught error in the renderer, for the log and (opted in) a crash report. */
    reportError: 'app:report-error',
    /** A problem report the user wrote (Settings); answers the server's reference. */
    reportProblem: 'app:report-problem',
    /** The bundled THIRD_PARTY_NOTICES.txt, opened in the system's text viewer. */
    openNotices: 'app:open-notices'
  },
  updates: {
    getState: 'updates:get-state',
    check: 'updates:check',
    install: 'updates:install',
    setChannel: 'updates:set-channel',
    /** main → renderer: the update state changed */
    event: 'updates:event'
  },
  prefs: {
    get: 'prefs:get',
    setCrashReports: 'prefs:set-crash-reports'
  },
  licence: {
    status: 'licence:status',
    activate: 'licence:activate',
    deactivate: 'licence:deactivate',
    validate: 'licence:validate',
    /** main → renderer: the licence changed */
    changed: 'licence:changed'
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
    hdr: 'library:hdr',
    /** main → renderer: the folder's items changed (new file, new copy) */
    changed: 'library:changed',
    /** The items of any source: a folder, a collection, a keyword, the duplicates. */
    openSource: 'library:open-source',
    /** Files → their folder and item keys (indexing the folder if new). */
    resolvePaths: 'library:resolve-paths',
    projectInfo: 'library:project-info',
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
    /** main → renderer: the port preview frames arrive on, from the interactive engine */
    previewPort: 'develop:preview-port',
    /** main → renderer: a preview frame main relays (when the engine had no port) */
    previewFrame: 'develop:preview-frame',
    historySetHidden: 'develop:history-set-hidden',
    historyDelete: 'develop:history-delete',
    noise: 'develop:noise',
    /** Measure the photo's lateral chromatic aberration (Lens → Remove CA). */
    measureCa: 'develop:measure-ca',
    /** Upright: a mode's suggestion measured on the photo, or the guides' transform. */
    suggestUpright: 'develop:suggest-upright',
    uprightFromLines: 'develop:upright-from-lines',
    /** Heal / clone: the best place to copy a spot from. */
    suggestHeal: 'develop:suggest-heal',
    bakeSpot: 'develop:bake-spot',
    /** Where the open photo's AI denoise stands. */
    /** main → renderer: a render finished */
    rendered: 'develop:rendered',
    /** main → renderer: a render failed */
    renderError: 'develop:render-error',
    /** The working frame changed size (an upscale step added or undone). */
    frame: 'develop:frame'
  },
  presets: {
    list: 'presets:list',
    save: 'presets:save',
    remove: 'presets:remove',
    importLut: 'presets:import-lut',
    luts: 'presets:luts'
  },
  models: {
    list: 'models:list',
    download: 'models:download',
    cancel: 'models:cancel',
    remove: 'models:remove',
    /** Time the models on the CPU and the accelerator; keep the faster. */
    benchmark: 'models:benchmark',
    provider: 'models:provider',
    /** main → renderer: the models' state changed (a download's progress, one installed). */
    event: 'models:event'
  },
  lens: {
    importProfiles: 'lens:import-profiles',
    status: 'lens:status',
    check: 'lens:check',
    search: 'lens:search',
    resolve: 'lens:resolve',
    /** main → renderer: the catalogue or the imported profiles changed. */
    changed: 'lens:changed'
  },
  export: {
    start: 'export:start',
    cancel: 'export:cancel',
    chooseFolder: 'export:choose-folder',
    chooseWatermark: 'export:choose-watermark',
    readWatermark: 'export:read-watermark',
    presets: 'export:presets',
    savePreset: 'export:save-preset',
    removePreset: 'export:remove-preset',
    /** main → renderer */
    progress: 'export:progress'
  },
  enhance: {
    rates: 'enhance:rates'
  },
  ai: {
    start: 'ai:start',
    cancel: 'ai:cancel',
    list: 'ai:list',
    capabilities: 'ai:capabilities',
    /** main → renderer: a job's progress, its end and its result */
    event: 'ai:event'
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
  /** The ONNX Runtime bundled with the engine: what model steps run on. */
  runtime?: { library: string; version: string; providers: string[] }
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
  /** HDR, and how; null when it is not; absent until the file has been probed. */
  hdr?: HdrKind | null
  /** Its `.pixl` project, once it has one (the truth about its edits and history). */
  project?: string | null
}

/** A gain map over an SDR base (iPhone, UltraHDR), or a PQ / HLG signal. */
export type HdrKind = 'gainmap' | 'pq' | 'hlg'

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

/** What a photo's `.pixl` project carries of its original (Info pane). */
export interface ProjectInfo {
  project: string | null
  state: 'none' | 'pending' | 'ready' | 'failed'
  kind: string | null
  bytes: number | null
}

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
  /**
   * The recipe it describes, when the sender worked it out (from a keyframe,
   * after a hide, show or delete), so the receiver need not replay it.
   */
  head?: Recipe
}

/**
 * What recording an edit changed (`appendToLog` lays it on the log): the
 * step (null when the edit changed nothing), a new base (the first edit, or
 * the oldest steps folding into it), and the steps folded away.
 */
export interface HistoryAppend {
  base: HistoryBase | null
  step: Step | null
  folded: number[]
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
  /**
   * Render the chosen layer's mask with every draft too (a range slider
   * moving: only the engine knows exactly what the key selects).
   */
  maskLive?: boolean
  /** Longest edge wanted from the renderer, in device pixels. */
  targetEdge: number
  /** Upright's guides are being drawn: show the whole frame before the warp. */
  guides?: boolean
  /** An HDR photo: also render where the picture rises above white (the headroom overlay). */
  headroom?: boolean
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
  /** Per local layer id: whether it applied, and how much of the frame its mask covers (0…1). */
  layers?: Record<string, { applied: boolean; coverage: number | null; ms: number }>
}

export interface RenderEvent {
  key: string
  seq: number
  /** The renderer's number for the recipe this was rendered from (see `develop.update`). */
  rev?: number
  kind: 'draft' | 'full' | 'before' | 'mask' | 'mask-thumb' | 'headroom'
  url: string
  /** A mask's (or mask thumbnail's) layer. */
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
  /** A headroom plane: how many stops above white its full scale stands for. */
  stops?: number
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
  /**
   * The fields it sets, when it sets only those (a built-in look): applied,
   * the photo's other sliders in the same groups stay as they are.
   */
  fields?: string[][]
  /**
   * A custom white balance as the engine's white (`opOf`), so the preset can
   * be converted onto a photo of the other kind (RAW ↔ anything else);
   * `absolute` says which kind `recipe.wb` is in (absolute Kelvin on a RAW),
   * and a photo of that kind takes the numbers as they are.
   */
  wbOp?: { kelvin: number; tint: number; absolute: boolean }
}

export interface LutProfile {
  name: string
  path: string
}

/** Where the lens catalogue stands (Settings, the Lens panel's credit). */
export interface LensCatalogStatus {
  version: string | null
  /** The catalogue the app shipped, or a newer one from the models server. */
  origin: 'bundled' | 'online' | null
  generated: string | null
  lensfunCommit: string | null
  lenses: number
  cameras: number
  imported: number
  /** When the server was last asked, and what went wrong if it could not be. */
  checkedAt: string | null
  error: string | null
  url: string
}

/** A lens the profile search found. */
export interface LensSearchHit {
  id: string
  name: string
  mount: string | null
  /** The calibration camera's crop factor (a lens profiled on several bodies has one per). */
  crop: number | null
  source: string | null
}

/** A photo's lens profile: which one, found how, and its correction for this photo. */
export interface LensMatch {
  profile: {
    id: string
    name: string
    source: string | null
    mount: string | null
    calibrationCrop: number | null
  } | null
  /** The camera the catalogue found for the photo (its crop factor). */
  camera: { name: string; crop: number } | null
  resolved: ResolvedProfile | null
  /** The catalogue version it was resolved from. */
  catalog: string | null
}

/** A watermark PNG as the export dialog shows it. */
export interface WatermarkFile {
  path: string
  width: number
  height: number
  /** The picture as a data URL, for the preview. */
  url: string
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
  /** `warning`: the file was written, but not all of it (its metadata). */
  errors: { name: string; message: string; warning?: boolean }[]
  finished: boolean
  outputs: string[]
}

export type { BasicSetting, ConvertReport }

// ── Updates ──────────────────────────────────────────────────────────────────

/** `latest` follows stable releases; `beta` also takes prereleases (0.3.0-beta.1). */
export type UpdateChannel = 'latest' | 'beta'

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'not-available'
  | 'error'
  /** A development build: there is nothing to update against. */
  | 'disabled'

export interface UpdateProgress {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

export interface UpdateState {
  phase: UpdatePhase
  channel: UpdateChannel
  currentVersion: string
  /** The newest version the feed offered. */
  version?: string
  releaseDate?: string
  progress?: UpdateProgress
  error?: string
  lastCheckedAt?: string
}

// ── Preferences ──────────────────────────────────────────────────────────────

/** Crash reports leave the machine only once the user says yes; `unset` asks once. */
export type CrashConsent = 'unset' | 'on' | 'off'

export interface Prefs {
  updateChannel: UpdateChannel
  crashReports: CrashConsent
  version: string
  platform: string
  arch: string
}

/** An uncaught error or rejection in the renderer. */
export interface ErrorReport {
  kind: 'error' | 'rejection'
  message: string
  stack?: string
}

/** Lens → Remove chromatic aberration: the measurement, and how much it explains. */
export interface CaMeasurement {
  ca: LateralCa
  /** RMS shift of red and blue from green, before and after the correction, in pixels. */
  red: [number, number]
  blue: [number, number]
  points: number
}

/** One AI model, as Settings lists it. */
export interface ModelInfo {
  id: string
  title: string
  role: 'upscale' | 'denoise' | 'deblur' | 'restore' | 'segment' | 'inpaint'
  bytes: number
  licence: string
  holder: string
  /** What is known about the training data's own terms. */
  caveat: string
  installed: boolean
  /** 0…1 while downloading, else null. */
  progress: number | null
  error?: string
}

/** Which provider AI models run on, and what the performance test measured. */
export interface ProviderInfo {
  choice: 'cpu' | 'accelerated'
  /** The accelerator the bundled runtime offers ('coreml', 'directml'), if any. */
  accelerator: string | null
  measured?: { cpuMs: number | null; acceleratedMs: number | null }
}

/** Where a photo's AI denoise stands: nothing made yet, the preview, or the full resolution. */
