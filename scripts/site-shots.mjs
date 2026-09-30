// The website's app screenshots (pixl-web: public/playroom/shots), taken from the built app.
//   node scripts/site-shots.mjs <card dir> <work dir> <out dir>
// Copies a few dozen CR2s (and their sidecars) from the card into three
// folders under <work dir> — the card is only read — then drives the app on
// them with a throwaway profile: ratings, labels, flags, a stack, keywords
// and collections for the Library, then Develop and the Enhance dialog.
// Writes library.png, develop-masks.png, develop.png and enhance.png to
// <out dir> at twice 1600×1000 (site-media.sh scales them to webp).
// Needs the built app (pnpm exec electron-vite build).
import { _electron as electron } from 'playwright-core'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createRequire } from 'node:module'

const [card, work, out] = process.argv.slice(2).map((p) => p && path.resolve(p))
if (!card || !work || !out) {
  console.error('usage: node scripts/site-shots.mjs <card dir> <work dir> <out dir>')
  process.exit(2)
}

// The folders the sidebar shows, the one the grid shows last (so it heads the list).
const FOLDERS = {
  'Campus walk': [3137, 3143, 3149, 3153, 3157],
  'Oral history day': [3301, 3316, 3325, 3343, 3367, 3415],
  'Lakeshore weekend': [
    3161, 3175, 3191, 3204, 3205, 3208, 3218, 3219, 3223, 3244, 3252, 3253, 3258, 3263, 3271, 3272,
    3273, 3274, 3277, 3278, 3280, 3281, 3282, 3283, 3284, 3285, 3287, 3288, 3291, 3292, 3293, 3294,
    3295
  ]
}
const MAIN = 'Lakeshore weekend'
const name = (n) => `IMG_${n}.CR2`

// What the Library shot shows about the photos.
const RATINGS = {
  5: [3218, 3273],
  4: [3204, 3223, 3252, 3272, 3278, 3281, 3291],
  3: [3161, 3191, 3263, 3274, 3294],
  2: [3175, 3219, 3244]
}
const LABELS = { red: [3218], yellow: [3204], green: [3223, 3244], blue: [3191], purple: [3273] }
const PICKS = [3218, 3223, 3273, 3252]
const STACK = [3281, 3282, 3283, 3284]
const KEYWORDS = {
  'Places|Lakeshore': FOLDERS[MAIN],
  'Places|Campus': FOLDERS['Campus walk'],
  'Nature|Flowers': [3204, 3205, 3219, 3223, 3244, 3277, 3278],
  'Nature|Wildlife': [3175, 3280, 3281, 3282, 3283, 3284],
  'Nature|Water': [3161, 3191, 3263],
  'People|Portraits': [3252, 3253, 3258, 3271, 3272, 3273, 3274, 3285, 3292, 3295],
  'Events|Oral history': FOLDERS['Oral history day']
}
const PORTRAITS = [3252, 3258, 3271, 3272, 3273, 3274, 3292, 3295]
const NATURE = [3204, 3205, 3218, 3219, 3223, 3244, 3277, 3278, 3294]
const PRINTS = [3218, 3223, 3273]

// ── the files ─────────────────────────────────────────────────────────────────
fs.mkdirSync(out, { recursive: true })
const dirs = {}
for (const [folder, ns] of Object.entries(FOLDERS)) {
  const dir = path.join(work, folder)
  fs.mkdirSync(dir, { recursive: true })
  for (const n of ns) {
    const src = path.join(card, name(n))
    if (!fs.existsSync(path.join(dir, name(n)))) fs.copyFileSync(src, path.join(dir, name(n)))
    const side = `${src}.playroom.json`
    if (fs.existsSync(side)) fs.copyFileSync(side, path.join(dir, `${name(n)}.playroom.json`))
  }
  dirs[folder] = dir
}

// ── the app ───────────────────────────────────────────────────────────────────
const APP_DIR = path.resolve(import.meta.dirname, '..')
const bin = createRequire(import.meta.url)('electron')
const profile =
  process.env.PLAYROOM_USER_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'playroom-shots-'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const app = await electron.launch({
  executablePath: bin,
  args: [APP_DIR],
  env: { ...process.env, PLAYROOM_HIDDEN: '1', PLAYROOM_USER_DATA: profile },
  timeout: 30_000
})
const page = await app.firstWindow()
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('Content Security Policy'))
    console.log('[console]', m.text())
})
await page.waitForSelector('.app', { timeout: 20_000 })
// A 1600×1000 page drawn at twice the pixels, for a crisp downscale. (A hidden
// window draws at 1×, whatever the display or --force-device-scale-factor say.)
await app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows()[0]
  win.setContentSize(3200, 2000)
  win.webContents.setZoomFactor(2)
})

const lib = (fn, arg) => page.evaluate(fn, arg)

async function shot(file) {
  // No toast in the picture.
  await lib(() => window.__playroom.useLibrary.setState({ toast: null }))
  await sleep(400)
  // capturePage works on a hidden window, where Playwright's screenshot waits for frames forever.
  const b64 = await app.evaluate(async ({ BrowserWindow }) => {
    const img = await BrowserWindow.getAllWindows()[0].webContents.capturePage()
    return img.toPNG().toString('base64')
  })
  fs.writeFileSync(path.join(out, file), Buffer.from(b64, 'base64'))
  console.log('shot', file)
}

/** Every thumbnail in the grid rendered (edited photos render from their recipe). */
async function thumbsReady(ms = 240_000) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    const left = await lib(
      () =>
        window.__playroom.useLibrary.getState().items.filter((i) => !i.thumbUrl && !i.unreadable)
          .length
    )
    if (left === 0) return
    await sleep(500)
  }
  console.log('thumbnails still missing')
}

/** Develop has a full render and nothing in flight. */
async function settle(ms = 90_000) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    const s = await lib(() => {
      const d = window.__playroom.useDevelop.getState()
      return { busy: d.loading || d.rendering, kind: d.picture?.kind, error: d.error }
    })
    if (s.error) throw new Error(s.error)
    if (!s.busy && s.kind === 'full') return
    await sleep(200)
  }
  console.log('develop never settled')
}

// Open the side folders first, so the main one heads the recent list.
for (const folder of Object.keys(FOLDERS)) {
  await lib((p) => window.__playroom.useLibrary.getState().openFolder(p), dirs[folder])
  await thumbsReady()
}

// Ratings, labels, flags, keywords, a stack and collections, through the app's own API.
await lib(
  async ({ RATINGS, LABELS, PICKS, STACK, KEYWORDS, PORTRAITS, NATURE, PRINTS, dirs, MAIN }) => {
    const api = window.playroom
    const L = window.__playroom.useLibrary
    const byName = new Map()
    for (const dir of Object.values(dirs)) {
      const listing = await api.library.openFolder(dir)
      for (const i of listing.items) if (i.copyId === null) byName.set(i.name, i.key)
    }
    const keys = (ns) => ns.map((n) => byName.get(`IMG_${n}.CR2`)).filter(Boolean)
    for (const [r, ns] of Object.entries(RATINGS))
      await api.library.setMeta(keys(ns), { rating: Number(r) })
    for (const [label, ns] of Object.entries(LABELS)) await api.library.setMeta(keys(ns), { label })
    await api.library.setMeta(keys(PICKS), { flag: 'pick' })
    for (const [k, ns] of Object.entries(KEYWORDS))
      await api.library.setMetadata(keys(ns), { addKeywords: [k] })
    await api.library.setMetadata(keys([3218]), {
      title: 'Rowan berries',
      caption: 'Mountain ash by the lake path, late afternoon.'
    })
    await api.library.stack(keys(STACK), keys(STACK)[0])
    const save = (c) => api.library.saveCollection({ parent: null, rules: null, sort: 0, ...c })
    const portfolio = await save({ name: 'Portfolio', kind: 'set' })
    const portraits = await save({ name: 'Portraits', kind: 'manual', parent: portfolio.id })
    const nature = await save({ name: 'Nature', kind: 'manual', parent: portfolio.id, sort: 1 })
    await save({
      name: 'Four stars and up',
      kind: 'smart',
      sort: 1,
      rules: { match: 'all', rules: [{ field: 'rating', op: 'gte', value: 4 }] }
    })
    const prints = await save({ name: 'Prints to order', kind: 'manual', sort: 2 })
    await api.library.collectionItems(portraits.id, keys(PORTRAITS), 'add')
    await api.library.collectionItems(nature.id, keys(NATURE), 'add')
    await api.library.collectionItems(prints.id, keys(PRINTS), 'add')
    await L.getState().openFolder(dirs[MAIN])
    L.getState().togglePin(dirs[MAIN])
    await L.getState().loadSources()
  },
  { RATINGS, LABELS, PICKS, STACK, KEYWORDS, PORTRAITS, NATURE, PRINTS, dirs, MAIN }
)
await thumbsReady()

// ── Library ───────────────────────────────────────────────────────────────────
// Open the set and the top keywords in the sidebar.
async function expand(section, label) {
  await lib(
    ({ section, label }) => {
      const box = [...document.querySelectorAll('.lib-sidebar section')].find(
        (s) => s.querySelector('header .title')?.textContent === section
      )
      const row = [...(box?.querySelectorAll('.src-row') ?? [])].find(
        (r) => r.querySelector('.src-label')?.textContent === label
      )
      if (row?.getAttribute('aria-expanded') === 'false')
        row.querySelector('.src-caret')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    },
    { section, label }
  )
  await sleep(250)
}
await lib(
  ({ size, info }) => {
    window.__playroom.useUi.getState().setLibrarySidebar(true)
    window.__playroom.useUi.getState().setLibraryInfo(info)
    window.__playroom.useLibrary.getState().setThumbSize(size)
  },
  { size: Number(process.env.THUMB) || 196, info: process.env.INFO === '1' }
)
await expand('Collections', 'Portfolio')
await expand('Keywords', 'Places')
await expand('Keywords', 'Nature')
await lib(() => {
  const L = window.__playroom.useLibrary.getState()
  const focus = L.visible().find((i) => i.name === 'IMG_3218.CR2')
  if (focus) {
    L.select(focus.key, 'only')
    L.setFocus(focus.key)
  }
  document.activeElement?.blur()
  document.querySelector('.grid')?.scrollTo(0, 0)
})
await sleep(1500)
await shot('library.png')

// ── Develop: a mask with its overlay ──────────────────────────────────────────
async function develop(n) {
  await lib((file) => {
    const L = window.__playroom.useLibrary.getState()
    const item = L.visible().find((i) => i.name === file) ?? L.items.find((i) => i.name === file)
    L.setFocus(item.key)
    L.setView('develop')
    void window.__playroom.useDevelop.getState().open(item.key)
  }, name(n))
  await sleep(500)
  await settle()
}
async function clickText(text) {
  const ok = await lib((t) => {
    const els = [...document.querySelectorAll('button, [role="button"], .layer-row')]
    const el =
      els.find((e) => e.textContent?.trim() === t) ?? els.find((e) => e.textContent?.includes(t))
    el?.click()
    return !!el
  }, text)
  if (!ok) console.log('not found:', text)
}

// The berries picked out by a colour range, brightened and saturated a touch.
await develop(3218)
await lib(() => {
  const d = window.__playroom.useDevelop.getState()
  const none = Object.fromEntries(
    [
      'temperature',
      'tint',
      'exposure',
      'contrast',
      'highlights',
      'shadows',
      'whites',
      'blacks',
      'texture',
      'clarity',
      'dehaze',
      'hue',
      'saturation',
      'sharpness',
      'noise',
      'tintHue',
      'tintAmount'
    ].map((k) => [k, 0])
  )
  d.edit((r) => {
    r.layers = [
      {
        id: 'site-mask-berries',
        name: 'Berries',
        enabled: true,
        opacity: 100,
        blend: 'Normal',
        invert: false,
        components: [
          {
            id: 'site-range-red',
            kind: 'range',
            mode: 'Add',
            opacity: 100,
            invert: false,
            feather: 5,
            hue: { centre: 2, width: 22, softness: 14 },
            saturation: { centre: 0.82, width: 0.36, softness: 0.14 },
            luma: null,
            smoothness: 0
          }
        ],
        adjust: { ...none, exposure: 0.25, saturation: 18, clarity: 12 },
        amount: 100
      }
    ]
  })
  d.commit('Mask: berries')
  // A violet overlay, so it reads against the red it selects.
  window.__playroom.useUi.getState().setMaskOverlay({ hue: 270 })
  window.__playroom.useUi.getState().setPanel('masks')
})
await sleep(1500)
await clickText('Berries')
await sleep(2500)
await settle()
await shot('develop-masks.png')

// ── Develop: the colour mixer's Point tab ─────────────────────────────────────
await develop(3223)
await lib(() => {
  window.__playroom.useUi.getState().setPanel('hsl')
  const d = window.__playroom.useDevelop.getState()
  d.setHslTab('point')
  // A sampled yellow from the flowers, warmed and deepened a touch.
  d.edit((r) => {
    r.pointColors = [
      {
        id: 'site-point-leaf',
        hue: 96,
        saturation: 0.45,
        luminance: 0.3,
        shiftHue: 8,
        shiftSat: -12,
        shiftLum: -6,
        range: 35
      },
      {
        id: 'site-point-petal',
        hue: 46,
        saturation: 0.82,
        luminance: 0.52,
        shiftHue: -6,
        shiftSat: 18,
        shiftLum: -8,
        range: 45
      }
    ]
  })
  d.commit('Point colour')
})
await sleep(1500)
await settle()
await shot('develop.png')

// ── Enhance ───────────────────────────────────────────────────────────────────
await lib(() => window.__playroom.useLibrary.getState().setDialog('enhance'))
await sleep(2500)
// This engine build has no upscaler: drop its error line and the disabled look it
// gives the button (a build with the model shows neither).
await lib(() => {
  for (const e of document.querySelectorAll('p.error')) e.remove()
  for (const b of document.querySelectorAll('.modal button.primary, .dialog button.primary'))
    b.disabled = false
})
await sleep(800)
await shot('enhance.png')

await app.close()
