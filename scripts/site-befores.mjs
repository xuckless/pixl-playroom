// Renders the "before" half of each before/after pair on the website with the
// app itself, so it has the same framing as the edit but none of the grade.
//   node scripts/site-befores.mjs <folder of CR2 + sidecars> <out dir>
// For every photo in the folder: make a virtual copy, reset it, give it the
// original's crop and orientation, export it (JPEG q90, full size; the site
// script resizes it) and delete the copy. The photos' own recipes are left alone.
// Needs the built app (pnpm exec electron-vite build). Work on a scratch copy
// of the files: the sidecars in the folder are written to while it runs.
import { _electron as electron } from 'playwright-core'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createRequire } from 'node:module'

const [folder, out] = process.argv.slice(2).map((p) => p && path.resolve(p))
if (!folder || !out) {
  console.error('usage: node scripts/site-befores.mjs <folder> <out dir>')
  process.exit(2)
}
fs.mkdirSync(out, { recursive: true })

const APP_DIR = path.resolve(import.meta.dirname, '..')
const bin = createRequire(import.meta.url)('electron')
const profile =
  process.env.PLAYROOM_USER_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'playroom-site-'))

const app = await electron.launch({
  executablePath: bin,
  args: [APP_DIR],
  env: { ...process.env, PLAYROOM_HIDDEN: '1', PLAYROOM_USER_DATA: profile },
  timeout: 30_000
})
const page = await app.firstWindow()
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[console]', m.text())
})
await page.waitForSelector('.app', { timeout: 20_000 })

const sidecars = Object.fromEntries(
  fs
    .readdirSync(folder)
    .filter((f) => f.endsWith('.playroom.json'))
    .map((f) => [
      f.replace(/\.playroom\.json$/, ''),
      JSON.parse(fs.readFileSync(path.join(folder, f), 'utf8')).photo.recipe
    ])
)

const result = await page.evaluate(
  async ({ folder, out, sidecars }) => {
    const api = window.playroom
    const listing = await api.library.openFolder(folder)
    const photos = listing.items.filter((i) => i.copyId === null && sidecars[i.name])
    const log = []
    for (const item of photos) {
      const original = sidecars[item.name]
      const copy = await api.library.createCopy(item.key)
      await api.library.resetRecipe([copy.key])
      await api.library.applyRecipe([copy.key], original, ['crop', 'orientation'], item.key)
      const settings = {
        folder: out,
        subfolder: '',
        template: '{name}-before',
        collision: 'overwrite',
        format: 'jpeg',
        quality: 90,
        jpegSubsampling: 'Quarter',
        jxlDistance: 1,
        jxlEffort: 7,
        jxlLossless: false,
        avifSpeed: 6,
        webpMethod: 4,
        webpLossless: false,
        pngCompression: 'Balanced',
        tiffCompression: 'Deflate',
        bitDepth: 8,
        chroma: 'Full',
        lossless: false,
        colorSpace: 'Srgb',
        intent: 'RelativeColorimetric',
        blackPointCompensation: true,
        resize: { mode: 'none', value: 2400, enlarge: false },
        metadata: { exif: false, icc: true, xmp: false, iptc: false },
        metaMode: 'all',
        removeLocation: true,
        copyright: '',
        outputSharpen: { enabled: false, media: 'screen', amount: 'standard' },
        dither: true,
        hdr: {
          mode: 'sdr',
          operator: 'Bt2390',
          sourcePeak: null,
          targetPeak: 203,
          gamut: 'Compress',
          to: 'Rec2100Pq',
          peak: 1000,
          sdrWhite: 203,
          referenceWhite: 203
        },
        reveal: false
      }
      const done = new Promise((resolve) => {
        const off = api.export.onProgress((p) => {
          if (p.finished) {
            off?.()
            resolve(p)
          }
        })
      })
      await api.export.start([copy.key], settings)
      const p = await done
      log.push({ name: item.name, outputs: p.outputs, errors: p.errors })
      await api.library.deleteCopy(copy.key)
    }
    return { log }
  },
  { folder, out, sidecars }
)

for (const l of result.log) console.log(l.name, l.outputs.join(' '), l.errors.length ? l.errors : '')
await app.close()
