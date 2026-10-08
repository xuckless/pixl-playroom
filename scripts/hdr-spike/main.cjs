/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type -- a CommonJS dev spike, never shipped */
// The HDR preview spike (TODO.md Pass 96): in the Electron Playroom ships,
// does a WebGPU float canvas show light above white, and can <img> decode a
// JPEG XL and an AVIF? macOS's own answer is read with Playroom's display
// reader: a screen's current EDR headroom rises only while a window shows
// extended-range content.
//   node scripts/build-native.mjs && npx electron scripts/hdr-spike [files…]
const { app, BrowserWindow, ipcMain, screen } = require('electron')
const { join } = require('path')
app.commandLine.appendSwitch('enable-unsafe-webgpu')
app.whenReady().then(async () => {
  const reader = require(join(__dirname, '../../build/native/display.node'))
  const win = new BrowserWindow({
    width: 900,
    height: 600,
    show: true,
    webPreferences: { preload: join(__dirname, 'preload.cjs') }
  })
  const id = () => screen.getDisplayMatching(win.getBounds()).id
  console.log('headroom before', JSON.stringify(reader.headroom(id())))
  // Never hang: whatever the page did, quit after 20 s.
  setTimeout(() => {
    console.log('timed out')
    app.quit()
  }, 20000)
  win.webContents.on('console-message', (_e, _l, msg) => console.log('page:', msg))
  ipcMain.handle('headroom', () => reader.headroom(id()))
  ipcMain.on('done', (_e, report) => {
    console.log('report', JSON.stringify(report))
    console.log('headroom while showing', JSON.stringify(reader.headroom(id())))
    app.quit()
  })
  await win.loadFile(join(__dirname, 'index.html'), {
    query: {
      files: JSON.stringify(process.argv.slice(2).filter((a) => /\.(jxl|avif|png)$/.test(a)))
    }
  })
})
