import { app, BrowserWindow, shell } from 'electron'
import log from 'electron-log/main'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import dockIcon from '../../resources/icon-dock.png?asset'
import { startCrashReporting } from './crash'
import { bootScale, onRenderScale, settleScale, watchDisplay } from './display'
import { EngineClient } from './engine/client'
import { endExiftool } from './exiftool'
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
import { PlaneStore } from './planestore'
import { pixels } from './workers/pool'
import { registerProtocol, registerSchemePrivileges } from './protocol'
import { DevelopSessions } from './render'
import { setupUpdater } from './updater'
import { IPC } from '../shared/ipc'

log.initialize()
log.transports.file.level = 'info'

registerSchemePrivileges()

// A separate profile for automated runs and experiments.
if (process.env['PLAYROOM_USER_DATA']) app.setPath('userData', process.env['PLAYROOM_USER_DATA'])
// Once userData is settled (consent lives there) and before anything else can crash.
startCrashReporting()
/** Automation: never show the window; render offscreen so it can still be captured. */
const hidden = process.env['PLAYROOM_HIDDEN'] === '1'

// A Retina Mac in Performance mode needs its scale on the command line; a
// build started without it starts again with it (see display.ts).
const relaunching = bootScale({ canRelaunch: app.isPackaged && !hidden })
// The relaunch starts when this process exits. It leaves at ready, once
// macOS has delivered the photos this launch was asked to open (`open-file`),
// and hands them to the next process.
if (relaunching) app.once('ready', () => leaveForRelaunch())

// One Playroom per profile: a second launch (Explorer's "Open With", a path
// on the command line) hands its arguments to the first and leaves. The lock
// is per userData, so PLAYROOM_USER_DATA runs stand apart; automation never
// takes it.
const secondary = !relaunching && !hidden && !app.requestSingleInstanceLock({ argv: process.argv })
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
  if (!app.isReady() || relaunching || secondary) return
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

if (!relaunching && !secondary) takeHandOff(app.getPath('userData'))
queueOpen(pathsFromArgv(process.argv, process.cwd(), ARGV_SKIP, APP_PATH))

function leaveForRelaunch(): void {
  handOffOpens(app.getPath('userData'))
  app.exit(0)
}

/** Previews and the develop view's measurements. */
const engine = new EngineClient('interactive', 8)
/** Thumbnails, exports, the full-resolution masters. */
const bgEngine = new EngineClient('background', 4)
/** AI jobs, one at a time: started when first needed, restarted to cancel one. */
const aiEngine = new EngineClient('ai', 4)
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
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
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
  win.on('closed', () => {
    rendererGone()
    if (mainWindow === win) mainWindow = undefined
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  watchDisplay(win)
}

/** About Pixl Playroom: the app's version and the engine it runs on. */
function setAbout(engineVersion?: string): void {
  app.setAboutPanelOptions({
    applicationName: 'Pixl Playroom',
    applicationVersion: app.getVersion(),
    credits: engineVersion ? `Powered by PIXL Engine ${engineVersion}` : 'Powered by PIXL Engine',
    copyright: 'Copyright © 2026 xuckless',
    iconPath: icon
  })
}

app.whenReady().then(() => {
  if (relaunching || secondary) return
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
  bgEngine.start()
  void engine.whenStarted().then(() => setAbout(engine.getStatus().version))
  const library = new Library(index, bgEngine)
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
  const planes = new PlaneStore(index)
  const ai = new AiJobs(
    {
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
    lenses
  })
  onOpenPaths((paths) => mainWindow?.webContents.send(IPC.app.openPaths, paths))

  buildMenu()
  onRenderScale(buildMenu)
  createWindow()
  setupUpdater()
  startLicence()

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
      pixels.close()
      app.quit()
    }
  )
})
