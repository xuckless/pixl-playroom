import { app, BrowserWindow, shell } from 'electron'
import log from 'electron-log/main'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { bootScale, onRenderScale, settleScale, watchDisplay } from './display'
import { EngineClient } from './engine/client'
import { Enhancer } from './enhance'
import { Exporter } from './exporter'
import { openIndex } from './indexer/client'
import { registerIpc } from './ipc'
import { Library } from './library'
import { buildMenu } from './menu'
import { PlaneStore } from './planestore'
import { pixels } from './workers/pool'
import { registerProtocol, registerSchemePrivileges } from './protocol'
import { DevelopSessions } from './render'

log.initialize()
log.transports.file.level = 'info'

registerSchemePrivileges()

// A separate profile for automated runs and experiments.
if (process.env['PLAYROOM_USER_DATA']) app.setPath('userData', process.env['PLAYROOM_USER_DATA'])
/** Automation: never show the window; render offscreen so it can still be captured. */
const hidden = process.env['PLAYROOM_HIDDEN'] === '1'

// A Retina Mac in Performance mode needs its scale on the command line; a
// build started without it starts again with it (see display.ts).
const relaunching = bootScale({ canRelaunch: app.isPackaged && !hidden })
if (relaunching) app.exit(0)

/** Previews and the develop view's measurements. */
const engine = new EngineClient('interactive', 8)
/** Thumbnails, exports, enhancement, the full-resolution masters. */
const bgEngine = new EngineClient('background', 4)
/** The SQLite index and the sidecars, in their own process. */
const index = openIndex()
let sessions: DevelopSessions | undefined

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    backgroundColor: '#141414',
    autoHideMenuBar: true,
    title: 'Pixl Playroom',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      backgroundThrottling: !hidden,
      // Automation renders offscreen: a hidden window stops painting after
      // its first frame, and nothing appears on the user's screen.
      offscreen: hidden
    }
  })

  mainWindow.on('ready-to-show', () => {
    if (!hidden) mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
  watchDisplay(mainWindow)
}

app.whenReady().then(() => {
  if (relaunching) return
  if (settleScale()) return app.exit(0)
  electronApp.setAppUserModelId('com.xuckless.pixlplayroom')
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerProtocol()
  index.start()
  engine.start()
  bgEngine.start()
  const library = new Library(index, bgEngine)
  sessions = new DevelopSessions(library, engine, bgEngine)
  const exporter = new Exporter(library, sessions, bgEngine)
  const enhancer = new Enhancer(library, bgEngine)
  const planes = new PlaneStore(index)
  registerIpc({ index, planes, library, sessions, exporter, enhancer, engine, bgEngine })

  buildMenu()
  onRenderScale(buildMenu)
  createWindow()

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
  const drain = (async (): Promise<void> => {
    await sessions?.closeAll()
    await index.stop()
  })().catch((err) => log.warn('quit: draining the index failed', err))
  let timer: NodeJS.Timeout | undefined
  void Promise.race([drain, new Promise((r) => (timer = setTimeout(r, QUIT_DRAIN_MS)))]).then(
    () => {
      clearTimeout(timer)
      engine.stop()
      bgEngine.stop()
      pixels.close()
      app.quit()
    }
  )
})
