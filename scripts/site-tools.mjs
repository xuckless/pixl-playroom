// The website's tool screenshots: one per tool on the Develop wheel, taken
// from the built app.
//   node scripts/site-tools.mjs <photos dir> <work dir> <out dir>
// Copies the CR2s below (and any sidecars) into <work dir> — <photos dir> is
// only read — then opens each in Develop with a throwaway profile, applies an
// edit that shows the tool off, turns the wheel to it and captures the window.
// Writes tool-<id>.png to <out dir> at twice 1600×1000 (site-media.sh scales
// them to webp). Needs the built app (pnpm exec electron-vite build).
import { _electron as electron } from 'playwright-core'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createRequire } from 'node:module'

const [photos, work, out] = process.argv.slice(2).map((p) => p && path.resolve(p))
if (!photos || !work || !out) {
  console.error('usage: node scripts/site-tools.mjs <photos dir> <work dir> <out dir>')
  process.exit(2)
}
const name = (n) => `IMG_${n}.CR2`

// Each tool, the photo it's shown on, and the edit (a recipe mutation, run in
// the page) that gives its panel something to show.
const SHOTS = [
  {
    id: 'basic',
    photo: 3161,
    edit: (r) => {
      Object.assign(r.basic, {
        exposure: 0.35,
        contrast: 18,
        highlights: -48,
        shadows: 36,
        whites: 14,
        blacks: -12
      })
      Object.assign(r.presence, { clarity: 12, dehaze: 6, vibrance: 24 })
    }
  },
  {
    id: 'curve',
    photo: 3191,
    edit: (r) => {
      Object.assign(r.toneCurve, { highlights: -14, lights: 10, darks: -12, shadows: 16 })
      r.toneCurve.master = [
        { x: 0, y: 0.03 },
        { x: 0.25, y: 0.2 },
        { x: 0.75, y: 0.83 },
        { x: 1, y: 1 }
      ]
    }
  },
  {
    id: 'hsl',
    photo: 3223,
    tab: 'all',
    edit: (r) => {
      Object.assign(r.hsl.orange, { hue: -4, saturation: 16, luminance: 6 })
      Object.assign(r.hsl.yellow, { hue: -10, saturation: 22, luminance: -4 })
      Object.assign(r.hsl.green, { hue: 18, saturation: -34, luminance: -18 })
      Object.assign(r.hsl.aqua, { saturation: -20 })
      Object.assign(r.hsl.blue, { hue: -6, saturation: -12 })
    }
  },
  {
    id: 'grade',
    photo: 3252,
    edit: (r) => {
      Object.assign(r.colorGrade.shadows, { hue: 205, saturation: 22, luminance: -4 })
      Object.assign(r.colorGrade.midtones, { hue: 30, saturation: 6 })
      Object.assign(r.colorGrade.highlights, { hue: 42, saturation: 16, luminance: 3 })
      r.colorGrade.blending = 60
      r.colorGrade.balance = -12
    }
  },
  {
    // ISO 3200: something for the noise reduction to do.
    id: 'detail',
    photo: 3218,
    edit: (r) => {
      Object.assign(r.detail, {
        sharpenAmount: 62,
        sharpenRadius: 1.1,
        sharpenDetail: 32,
        sharpenMasking: 48,
        noiseLuminance: 38,
        noiseLuminanceDetail: 55,
        noiseColor: 30
      })
    }
  },
  {
    id: 'effects',
    photo: 3273,
    edit: (r) => {
      Object.assign(r.effects, {
        vignetteAmount: -30,
        vignetteMidpoint: 38,
        vignetteFeather: 64,
        grainAmount: 22,
        grainSize: 28,
        grainRoughness: 55
      })
    }
  },
  {
    // The berries picked out by a colour range, brightened and saturated a touch.
    id: 'masks',
    photo: 3218,
    select: 'Berries',
    edit: (r) => {
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
          adjust: {
            temperature: 0,
            tint: 0,
            exposure: 0.25,
            contrast: 0,
            highlights: 0,
            shadows: 0,
            whites: 0,
            blacks: 0,
            texture: 0,
            clarity: 12,
            dehaze: 0,
            hue: 0,
            saturation: 18,
            sharpness: 0,
            noise: 0,
            tintHue: 0,
            tintAmount: 0
          },
          amount: 100
        }
      ]
    }
  },
  {
    id: 'crop',
    photo: 3291,
    tool: 'crop',
    edit: (r) => {
      Object.assign(r.geometry, {
        straighten: 1.6,
        aspect: 1.5,
        crop: { x: 0.06, y: 0.07, width: 0.86, height: 0.86 }
      })
    }
  },
  {
    id: 'calibration',
    photo: 3204,
    edit: (r) => {
      Object.assign(r.calibration, {
        shadowsTint: 6,
        redHue: 8,
        redSaturation: 14,
        greenHue: -6,
        blueHue: -12,
        blueSaturation: 22
      })
    }
  },
  {
    // The Engine panel lists the compiled grade, so give it one to list.
    id: 'advanced',
    photo: 3258,
    edit: (r) => {
      Object.assign(r.basic, { exposure: 0.2, contrast: 12, highlights: -30, shadows: 22 })
      Object.assign(r.presence, { clarity: 8, vibrance: 16 })
      Object.assign(r.colorGrade.shadows, { hue: 210, saturation: 14 })
      Object.assign(r.colorGrade.highlights, { hue: 40, saturation: 10 })
      Object.assign(r.effects, { vignetteAmount: -18 })
    }
  }
]

// ── the files ─────────────────────────────────────────────────────────────────
fs.mkdirSync(out, { recursive: true })
const dir = path.join(work, 'Tools')
fs.mkdirSync(dir, { recursive: true })
for (const n of new Set(SHOTS.map((s) => s.photo))) {
  const src = path.join(photos, name(n))
  if (!fs.existsSync(path.join(dir, name(n)))) fs.copyFileSync(src, path.join(dir, name(n)))
  const side = `${src}.playroom.json`
  if (fs.existsSync(side)) fs.copyFileSync(side, path.join(dir, `${name(n)}.playroom.json`))
}

// ── the app ───────────────────────────────────────────────────────────────────
const APP_DIR = path.resolve(import.meta.dirname, '..')
const bin = createRequire(import.meta.url)('electron')
const profile =
  process.env.PLAYROOM_USER_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'playroom-tools-'))
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
// A 1600×1000 page drawn at twice the pixels, as site-shots.mjs does.
await app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows()[0]
  win.setContentSize(3200, 2000)
  win.webContents.setZoomFactor(2)
})

const lib = (fn, arg) => page.evaluate(fn, arg)

async function shot(file) {
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

async function develop(n) {
  await lib((file) => {
    const L = window.__playroom.useLibrary.getState()
    const item = L.items.find((i) => i.name === file)
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

await lib((p) => window.__playroom.useLibrary.getState().openFolder(p), dir)
await sleep(1500)

const only = process.env.TOOLS?.split(',')
for (const s of SHOTS) {
  if (only && !only.includes(s.id)) continue
  await develop(s.photo)
  await lib(
    ({ id, edit, tab, tool }) => {
      const d = window.__playroom.useDevelop.getState()
      const ui = window.__playroom.useUi.getState()
      d.setTool('none')
      d.edit(new Function(`return (${edit})`)())
      d.commit(`Site: ${id}`)
      if (id === 'masks') ui.setMaskOverlay({ hue: 270 })
      ui.setPanel(id)
      if (tab) d.setHslTab(tab)
      if (tool) d.setTool(tool)
    },
    { id: s.id, edit: s.edit.toString(), tab: s.tab, tool: s.tool }
  )
  await sleep(1500)
  if (s.select) {
    await clickText(s.select)
    await sleep(2500)
  }
  await settle()
  await lib(() => document.activeElement?.blur())
  await shot(`tool-${s.id}.png`)
}

await app.close()
