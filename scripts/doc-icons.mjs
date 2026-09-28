// Renders the document icons Finder and Explorer show for the photos Playroom
// opens (electron-builder.yml `mac.fileAssociations`, build/installer.nsh):
// build/brand/doc-icon.html → build/doc-icons/<fmt>.icns (iconutil),
// build/doc-icons/<fmt>.ico (PNG entries, Windows Vista and later) and
// build/doc-icons/png/<fmt>-256.png for the website.
//   pnpm doc-icons        (macOS, for iconutil)
import { app, BrowserWindow } from 'electron'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(import.meta.dirname, '..')
const PAGE = pathToFileURL(join(ROOT, 'build/brand/doc-icon.html'))
const OUT = join(ROOT, 'build/doc-icons')
/** File name → the label on the page and its tone (TIFF is what Enhance writes). */
const FORMATS = {
  raw: ['RAW', 'source'],
  dng: ['DNG', 'source'],
  jxl: ['JXL', 'source'],
  heic: ['HEIC', 'source'],
  tiff: ['TIFF', 'output'],
  jpg: ['JPG', 'source'],
  png: ['PNG', 'source'],
  webp: ['WEBP', 'source'],
  avif: ['AVIF', 'source']
}
/** An .iconset's files and their pixel sizes. */
const ICONSET = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024]
]
/** The sizes an .ico carries. */
const ICO = [16, 24, 32, 48, 64, 128, 256]

// One device pixel per CSS pixel: each size is drawn at its own resolution.
app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.dock?.hide()

/** An .ico of PNG entries: a sixth of the size of ImageMagick's bitmaps. */
function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(pngs.length, 4)
  let offset = head.length
  pngs.forEach(([size, png], i) => {
    const e = 6 + 16 * i
    head.writeUInt8(size % 256, e) // 0 means 256
    head.writeUInt8(size % 256, e + 1)
    head.writeUInt16LE(1, e + 4)
    head.writeUInt16LE(32, e + 6)
    head.writeUInt32LE(png.length, e + 8)
    head.writeUInt32LE(offset, e + 12)
    offset += png.length
  })
  return Buffer.concat([head, ...pngs.map(([, png]) => png)])
}

/** Transparency must survive the capture, or every icon sits on a black square. */
function checkAlpha(image, name) {
  const px = image.toBitmap() // BGRA
  const { width, height } = image.getSize()
  const corner = px[3]
  const centre = px[4 * (Math.floor(height / 2) * width + Math.floor(width / 2)) + 3]
  if (corner !== 0 || centre !== 255)
    throw new Error(`${name}: alpha lost (corner ${corner}, centre ${centre})`)
}

async function render(win, fmt, tone, size) {
  win.setContentSize(size, size)
  const url = new URL(PAGE)
  url.search = new URLSearchParams({ fmt, tone, size: String(size) }).toString()
  await win.loadURL(url.href)
  await win.webContents.executeJavaScript(
    'document.fonts.ready.then(() => Promise.all([...document.images].map((i) => i.decode())))'
  )
  // A frame after the fonts and the mark land.
  await new Promise((r) => setTimeout(r, 200))
  const shot = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size })
  const image =
    shot.getSize().width === size
      ? shot
      : shot.resize({ width: size, height: size, quality: 'best' })
  checkAlpha(image, `${fmt} ${size}`)
  return image.toPNG()
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 256,
    height: 256,
    useContentSize: true,
    transparent: true,
    frame: false,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true }
  })
  const tmp = mkdtempSync(join(tmpdir(), 'playroom-doc-icons-'))
  mkdirSync(join(OUT, 'png'), { recursive: true })
  try {
    for (const [name, [fmt, tone]] of Object.entries(FORMATS)) {
      const pngs = new Map()
      const at = async (size) => {
        if (!pngs.has(size)) pngs.set(size, await render(win, fmt, tone, size))
        return pngs.get(size)
      }
      const iconset = join(tmp, `${name}.iconset`)
      mkdirSync(iconset)
      for (const [file, size] of ICONSET) writeFileSync(join(iconset, file), await at(size))
      execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(OUT, `${name}.icns`)])

      const layers = []
      for (const size of ICO) layers.push([size, await at(size)])
      writeFileSync(join(OUT, `${name}.ico`), ico(layers))
      writeFileSync(join(OUT, 'png', `${name}-256.png`), await at(256))
      console.log(`${name}.icns, ${name}.ico, png/${name}-256.png`)
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
    win.destroy()
    app.quit()
  }
})
