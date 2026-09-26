import { app, BrowserWindow, shell } from 'electron'
import log from 'electron-log/main'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { Store } from './db'
import { bootScale, onRenderScale, settleScale, watchDisplay } from './display'
import { EngineClient } from './engine/client'
import { Enhancer } from './enhance'
import { Exporter } from './exporter'
import { registerIpc } from './ipc'
import { Library } from './library'
import { buildMenu } from './menu'
import { PlaneStore } from './planestore'
import { pixels } from './workers/pool'
import { paths } from './paths'
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
let store: Store | undefined
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
  store = Store.open(paths.db())
  engine.start()
  bgEngine.start()
  const library = new Library(store, bgEngine)
  sessions = new DevelopSessions(library, engine, bgEngine)
  const exporter = new Exporter(library, sessions, bgEngine)
  const enhancer = new Enhancer(library, bgEngine)
  const planes = new PlaneStore(store)
  registerIpc({ store, planes, library, sessions, exporter, enhancer, engine, bgEngine })

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

app.on('before-quit', () => {
  sessions?.closeAll()
  engine.stop()
  bgEngine.stop()
  pixels.close()
  store?.close()
})
