import { app, BrowserWindow, shell } from 'electron'
import log from 'electron-log/main'
import { join } from 'path'
import { MAIN_DIR } from './dirs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import dockIcon from '../../resources/icon-dock.png?asset'
import { startCrashReporting } from './crash'
import { onRenderScale, settleScale, watchDisplay } from './display'
import { EngineClient } from './engine/client'
import { SelectService } from './select/service'
import { setBrushSnapper } from './brushes'
import { PromptRunner } from './ai/prompt'
import { endExiftool } from './exiftool'
import { externalAllowed } from './guard'
import { AiJobs } from './ai/jobs'
import { applyMaskResult } from './ai/apply'
import { SegmentRunner } from './ai/segment'
import { DenoiseRunner } from './ai/denoise'
import { ModelStore } from './ai/models'
import { EnhanceRunner } from './enhance'
import { Exporter } from './exporter'
import { openIndex } from './indexer/client'
import { registerIpc } from './ipc'
import { LensProfileStore } from './lensprofiles'
import { startLicence } from './licence'
import { startAccount } from './account'
import { startGate } from './gate'
import { Library } from './library'
import { OriginalEmbedder } from './project/embed'
import { buildMenu } from './menu'
import {
  handOffOpens,
  onOpenPaths,
  openable,
  pathsFromArgv,
  queueOpen,
  rendererGone,
  takeHandOff
} from './open'
import { paths } from './paths'
import { PlaneStore } from './planestore'
import { pixels } from './workers/pool'
import { registerProtocol, registerSchemePrivileges } from './protocol'
import { DevelopSessions } from './render'
import { setupUpdater } from './updater'
import { startPolicy } from './policy'
import { IPC } from '../shared/ipc'

log.initialize()
log.transports.file.level = 'info'

registerSchemePrivileges()

// userData is settled (index.ts) — consent lives there — so before anything else can crash:
startCrashReporting()
/** Automation: never show the window; render offscreen so it can still be captured. */
const hidden = process.env['PLAYROOM_HIDDEN'] === '1'

// The display's scale was settled before this module loaded (index.ts): a
// process that is starting again with it never gets here.

// One Playroom per profile: a second launch (Explorer's "Open With", a path
// on the command line) hands its arguments to the first and leaves. The lock
// is per userData, so PLAYROOM_USER_DATA runs stand apart; automation never
// takes it.
const secondary = !hidden && !app.requestSingleInstanceLock({ argv: process.argv })
if (secondary) app.exit(0)

/** Opens are sent here; undefined while every window is closed (macOS). */
let mainWindow: BrowserWindow | undefined

function focusWindow(): void {
  if (!mainWindow || hidden) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

/** The executable, and in development the app path Electron was given. */
const ARGV_SKIP = app.isPackaged ? 1 : 2
const APP_PATH = app.isPackaged ? undefined : app.getAppPath()

// macOS delivers Finder's "Open With" and Dock drops as `open-file`, possibly
// before ready: queue them, and bring a window back if all were closed.
app.on('open-file', (e, path) => {
  e.preventDefault()
  const p = openable(path)
  if (p) queueOpen([p])
  if (!app.isReady() || secondary) return
  if (!mainWindow) createWindow()
  else focusWindow()
})

app.on('second-instance', (_e, argv, cwd, data) => {
  // Electron's own `argv` can be rewritten by Chromium; the launch's is in `data`.
  queueOpen(
    pathsFromArgv((data as { argv?: string[] } | undefined)?.argv ?? argv, cwd, ARGV_SKIP, APP_PATH)
  )
  if (!app.isReady()) return
  if (!mainWindow) createWindow()
  else focusWindow()
})

if (!secondary) takeHandOff(app.getPath('userData'))
queueOpen(pathsFromArgv(process.argv, process.cwd(), ARGV_SKIP, APP_PATH))

/** Previews and the develop view's measurements. */
const engine = new EngineClient('interactive', 8)
/** Thumbnails, exports, the full-resolution masters. */
const bgEngine = new EngineClient('background', 4, true)
/** AI jobs, one at a time: started when first needed, restarted to cancel one. */
const aiEngine = new EngineClient('ai', 4, true)
/**
 * Select by clicks, a box or strokes (SAM 2.1): started when first needed,
 * at normal priority and never held behind a preview (a hover follows the
 * pointer), put to sleep when idle (main/select/service.ts).
 */
const selectEngine = new EngineClient('select', 4)
// One scheduler across them: new background and AI work waits (briefly)
// while a preview is being rendered, rather than splitting the cores with it.
bgEngine.holdFor(engine)
aiEngine.holdFor(engine)
/** The SQLite index and the sidecars, in their own process. */
const index = openIndex()
let sessions: DevelopSessions | undefined

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    // The launch splash's black, so the window never flashes another colour first.
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    title: 'Pixl Playroom',
    // macOS takes the bundle's .icns; elsewhere the window carries the mark.
    ...(process.platform !== 'darwin' ? { icon } : {}),
    webPreferences: {
      preload: join(MAIN_DIR, '../preload/index.js'),
      // The preload needs nothing beyond contextBridge, ipcRenderer and webUtils.
      sandbox: true,
      backgroundThrottling: !hidden,
      // Automation renders offscreen: a hidden window stops painting after
      // its first frame, and nothing appears on the user's screen.
      offscreen: hidden
    }
  })

  mainWindow = win
  win.on('ready-to-show', () => {
    if (!hidden) win.show()
  })
  // A closed window or a reload boots a new renderer: opens queue until it takes them.
  win.webContents.on('did-start-loading', rendererGone)
  // Previews' pixels go straight from the interactive engine to this page,
  // on a channel each load of it gets afresh.
  win.webContents.on('did-finish-load', () => engine.sendPreviewsTo(win.webContents))
  win.on('closed', () => {
    rendererGone()
    if (mainWindow === win) mainWindow = undefined
  })

  // The window stays on the app's page: links open in the browser, and only
  // to our own sites and the checkout (guard.ts); nothing navigates the
  // window itself or embeds a webview.
  win.webContents.setWindowOpenHandler((details) => {
    if (externalAllowed(details.url)) void shell.openExternal(details.url)
    else log.warn(`refused to open ${details.url}`)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url === win.webContents.getURL()) return
    event.preventDefault()
    if (externalAllowed(url)) void shell.openExternal(url)
  })
  win.webContents.on('will-attach-webview', (event) => event.preventDefault())

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(MAIN_DIR, '../renderer/index.html'))
  }
  watchDisplay(win)
}

/** About Pixl Playroom: the app's version and the engine it runs on. */
function setAbout(engineVersion?: string): void {
  app.setAboutPanelOptions({
    applicationName: 'Pixl Playroom',
    applicationVersion: app.getVersion(),
    credits: engineVersion ? `Powered by PIXL Engine ${engineVersion}` : 'Powered by PIXL Engine',
    copyright: 'Copyright © 2026 Syed Ali (PIXL Foundation)',
    iconPath: icon
  })
}

/** A first launch learning it wants another scale: hand the opens on and leave. */
function leaveForRelaunch(): void {
  handOffOpens(app.getPath('userData'))
  app.exit(0)
}

app.whenReady().then(() => {
  if (secondary) return
  if (settleScale()) return leaveForRelaunch()
  electronApp.setAppUserModelId('com.xuckless.pixlplayroom')
  // A packaged app's dock shows its bundle icon; `pnpm dev` would show Electron's.
  if (!app.isPackaged) app.dock?.setIcon(dockIcon)
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerProtocol()
  index.start()
  engine.start()
  // The background engine waits off the launch's path: it starts with the
  // first work for it (a thumbnail, a probe), or a few seconds in.
  setTimeout(() => bgEngine.ensureStarted(), 3000)
  // Thumbnails nothing names any more, once the launch has settled.
  setTimeout(() => {
    void index
      .pruneThumbs(paths.thumbs())
      .then((n) => n > 0 && log.info(`pruned ${n} unused thumbnails`))
      .catch((err) => log.warn('pruning thumbnails failed', err))
  }, 20_000)
  void engine.whenStarted().then(() => setAbout(engine.getStatus().version))
  const planes = new PlaneStore(index)
  const library = new Library(index, bgEngine, planes)
  sessions = new DevelopSessions(library, engine, bgEngine)
  // A photo's new project gets its original carried inside it.
  const embedder = new OriginalEmbedder(index, library, bgEngine)
  index.on((e) => {
    if (e.name === 'project') embedder.request(e.key)
  })
  const models = new ModelStore(index, () => bgEngine.getStatus())
  const lenses = new LensProfileStore()
  void lenses.start()
  const exporter = new Exporter(library, sessions, bgEngine)
  const select = new SelectService(selectEngine, bgEngine, library, planes, models, () => sessions)
  // A stroke with Snap to edges is kept to the object SAM finds under it.
  setBrushSnapper({
    key: (key, lens) => select.snapKey(key, lens),
    object: (key, lens, stroke) => select.objectUnder(key, lens, stroke)
  })
  const ai = new AiJobs(
    {
      prompt: new PromptRunner(select, models),
      enhance: new EnhanceRunner(
        library,
        aiEngine,
        () => bgEngine.getStatus(),
        models,
        index,
        () => sessions
      ),
      segment: new SegmentRunner(library, planes, aiEngine, models, () => sessions),
      denoise: new DenoiseRunner(library, aiEngine, models, index, () => sessions)
    },
    async (key) => (await library.photoRow(key)).name,
    (e) => applyMaskResult(e, { library, sessions: sessions!, planes })
  )
  registerIpc({
    index,
    embedder,
    planes,
    library,
    sessions,
    exporter,
    ai,
    engine,
    bgEngine,
    aiEngine,
    models,
    lenses,
    select
  })
  onOpenPaths((paths) => mainWindow?.webContents.send(IPC.app.openPaths, paths))

  buildMenu()
  onRenderScale(buildMenu)
  createWindow()
  startPolicy()
  void setupUpdater().catch((err) => log.warn('updater setup failed', err))
  startLicence()
  startAccount()
  startGate()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

/** The longest a quit waits for pending edits to reach their sidecars. */
const QUIT_DRAIN_MS = 3000
let drained = false

app.on('before-quit', (e) => {
  if (drained) return
  // Pending edits go to the index host, and it closes the database, before
  // anything stops: once, and never for longer than QUIT_DRAIN_MS.
  e.preventDefault()
  drained = true
  const drain = Promise.all([
    (async (): Promise<void> => {
      await sessions?.closeAll()
      await index.stop()
    })().catch((err) => log.warn('quit: draining the index failed', err)),
    // The exporter's perl processes.
    endExiftool().catch((err) => log.warn('quit: stopping exiftool failed', err))
  ])
  let timer: NodeJS.Timeout | undefined
  void Promise.race([drain, new Promise((r) => (timer = setTimeout(r, QUIT_DRAIN_MS)))]).then(
    () => {
      clearTimeout(timer)
      engine.stop()
      bgEngine.stop()
      aiEngine.stop()
      selectEngine.stop()
      pixels.close()
      app.quit()
    }
  )
})
