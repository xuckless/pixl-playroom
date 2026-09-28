// Renders the brand kit's art pages to PNGs:
//   dmg: build/brand/dmg.html → build/background.png (660×400) and
//        build/background@2x.png (1320×800), which electron-builder merges
//        into one HiDPI TIFF.
//   og:  build/brand/og.html → site/assets/og.png (1200×630), the website's
//        link card.
//   pnpm exec electron scripts/brand-art.mjs [dmg] [og]     (no names: all)
import { app, BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const ART = [
  { name: 'dmg', page: 'build/brand/dmg.html', out: 'build/background', width: 660, height: 400 },
  // A link card is fetched at 1×: no @2x copy.
  {
    name: 'og',
    page: 'build/brand/og.html',
    out: 'site/assets/og',
    width: 1200,
    height: 630,
    only1x: true
  }
]
const wanted = process.argv.slice(2).filter((a) => ART.some((x) => x.name === a))
const todo = wanted.length ? ART.filter((a) => wanted.includes(a.name)) : ART

// Draw at 2×, and scale down for the 1× copy.
app.commandLine.appendSwitch('force-device-scale-factor', '2')
app.dock?.hide()

app.whenReady().then(async () => {
  for (const a of todo) {
    const win = new BrowserWindow({
      show: false,
      width: a.width,
      height: a.height,
      useContentSize: true,
      webPreferences: { offscreen: true }
    })
    await win.loadFile(join(ROOT, a.page))
    await win.webContents.executeJavaScript(
      'Promise.all([document.fonts.ready, ...[...document.images].map((i) => i.decode().catch(() => {}))]).then(() => true)'
    )
    // A frame after the fonts land.
    await new Promise((r) => setTimeout(r, 300))
    const shot = await win.webContents.capturePage()
    const at1 = shot.resize({ width: a.width, height: a.height, quality: 'best' })
    writeFileSync(join(ROOT, `${a.out}.png`), at1.toPNG())
    if (a.only1x) {
      console.log(`${a.out}.png`)
    } else {
      const at2 = shot.resize({ width: a.width * 2, height: a.height * 2, quality: 'best' })
      writeFileSync(join(ROOT, `${a.out}@2x.png`), at2.toPNG())
      console.log(`${a.out}.png, ${a.out}@2x.png`)
    }
    win.destroy()
  }
  app.quit()
})
