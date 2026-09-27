// Renders the brand kit's installer art to the PNGs electron-builder reads:
// build/brand/dmg.html → build/background.png (660×400) and
// build/background@2x.png (1320×800), which it merges into one HiDPI TIFF.
//   pnpm exec electron scripts/brand-art.mjs
import { app, BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const ART = [{ page: 'build/brand/dmg.html', out: 'build/background', width: 660, height: 400 }]

// Draw at 2×, and scale down for the 1× copy.
app.commandLine.appendSwitch('force-device-scale-factor', '2')
app.dock?.hide()

app.whenReady().then(async () => {
  for (const a of ART) {
    const win = new BrowserWindow({
      show: false,
      width: a.width,
      height: a.height,
      useContentSize: true,
      webPreferences: { offscreen: true }
    })
    await win.loadFile(join(ROOT, a.page))
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)')
    // A frame after the fonts land.
    await new Promise((r) => setTimeout(r, 300))
    const shot = await win.webContents.capturePage()
    const at2 = shot.resize({ width: a.width * 2, height: a.height * 2, quality: 'best' })
    const at1 = shot.resize({ width: a.width, height: a.height, quality: 'best' })
    writeFileSync(join(ROOT, `${a.out}@2x.png`), at2.toPNG())
    writeFileSync(join(ROOT, `${a.out}.png`), at1.toPNG())
    console.log(`${a.out}.png, ${a.out}@2x.png`)
    win.destroy()
  }
  app.quit()
})
