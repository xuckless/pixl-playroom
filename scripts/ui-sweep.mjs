#!/usr/bin/env node
/**
 * The interface in every theme and language, at the smallest window, with
 * what overflows listed: screenshots of the library, the develop view (its
 * cards, the masks pane, Edits, History), Settings and the main menus, and
 * `overflow.json` naming each element whose text is cut with no ellipsis and
 * no tooltip (styles/fit.css, lib/overflowTitles.ts).
 *
 *   pnpm build:renderer   (or electron-vite build: not while `pnpm dev` runs)
 *   node scripts/ui-sweep.mjs <folder of photos> [--themes original,calm,bold] [--langs en,de,…,pseudo]
 *
 * Screenshots go to SCREENSHOT_DIR (default: a temp folder), as
 * <theme>/<language>/<screen>.png; `pseudo` is PLAYROOM_PSEUDO_LOCALE=expand
 * (every string accented and 1.4 times as long). A throwaway profile each run.
 */
import { _electron as electron } from 'playwright-core'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { createRequire } from 'node:module'

const APP_DIR = path.resolve(import.meta.dirname, '..')
const OUT = process.env.SCREENSHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'playroom-sweep-'))
const bin = createRequire(import.meta.url)('electron')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const args = process.argv.slice(2)
const folder = args.find((a) => !a.startsWith('--'))
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1].split(',') : def
}
const THEMES = opt('themes', ['original', 'calm', 'bold'])
const LANGS = opt('langs', ['en', 'fr', 'de', 'zh-Hans', 'ja', 'vi', 'pseudo'])
/** The smallest window Playroom allows (src/main/app.ts). */
const SIZE = { width: 1000, height: 640 }

/** In the page: each element whose own text is cut, without an ellipsis or a tooltip. */
function probe() {
  const out = []
  for (const el of document.querySelectorAll('body *')) {
    if (!(el instanceof HTMLElement) || el.offsetParent === null) continue
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
    if (!own || el.scrollWidth <= el.clientWidth + 1) continue
    const cs = getComputedStyle(el)
    if (cs.overflowX === 'visible' && cs.textOverflow !== 'ellipsis') {
      // Spilling out of its box onto what is beside it.
      out.push({ text: el.textContent.trim().slice(0, 80), cls: el.className, why: 'spills' })
    } else if (cs.textOverflow !== 'ellipsis' && !el.title) {
      out.push({ text: el.textContent.trim().slice(0, 80), cls: el.className, why: 'cut' })
    }
  }
  return out
}

async function shoot(app, file) {
  const b64 = await app.evaluate(async ({ BrowserWindow }) => {
    const img = await BrowserWindow.getAllWindows()[0].webContents.capturePage()
    return img.toPNG().toString('base64')
  })
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, Buffer.from(b64, 'base64'))
}

async function sweep(theme, lang) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'playroom-sweep-profile-'))
  const app = await electron.launch({
    executablePath: bin,
    args: [APP_DIR],
    env: {
      ...process.env,
      PLAYROOM_HIDDEN: '1',
      PLAYROOM_USER_DATA: profile,
      ...(lang === 'pseudo' ? { PLAYROOM_PSEUDO_LOCALE: 'expand' } : {})
    },
    timeout: 30_000
  })
  const found = {}
  try {
    const page = await app.firstWindow()
    await app.evaluate(
      ({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0]?.setContentSize(s.width, s.height),
      SIZE
    )
    await page.waitForSelector('.app', { timeout: 20_000 })
    await page.evaluate(
      async ({ theme, lang }) => {
        const p = window.__playroom
        p.useUi.getState().setTheme(theme)
        if (lang !== 'pseudo') await window.playroom.app.setLanguage?.(lang)
      },
      { theme, lang }
    )
    const at = async (screen, go, arg) => {
      await page.evaluate(go, arg).catch(() => undefined)
      await sleep(1200)
      found[screen] = await page.evaluate(probe)
      await shoot(app, path.join(OUT, theme, lang, `${screen}.png`))
    }
    if (folder)
      await page.evaluate((f) => window.__playroom.useLibrary.getState().openFolder(f), folder)
    await at('library', () => window.__playroom.useLibrary.getState().setView('library'))
    await at('develop', () => {
      const lib = window.__playroom.useLibrary.getState()
      const item = lib.visible()[0]
      if (!item) return
      lib.setFocus(item.key)
      lib.setView('develop')
      void window.__playroom.useDevelop.getState().open(item.key)
    })
    for (const rail of ['presets', 'edits', 'history', 'info'])
      await at(`rail-${rail}`, (r) => window.__playroom.useUi.getState().pickRail(r), rail)
    await at('masks', () => window.__playroom.useUi.getState().setMasksWin({ open: true }))
    await at('settings', () => window.__playroom.useLibrary.getState().setDialog('preferences'))
  } finally {
    await app.close().catch(() => undefined)
    fs.rmSync(profile, { recursive: true, force: true })
  }
  return found
}

const report = {}
for (const theme of THEMES)
  for (const lang of LANGS) {
    process.stdout.write(`${theme} ${lang}… `)
    report[`${theme}/${lang}`] = await sweep(theme, lang)
    const n = Object.values(report[`${theme}/${lang}`]).reduce((k, v) => k + v.length, 0)
    console.log(`${n} overflowing`)
  }
fs.writeFileSync(path.join(OUT, 'overflow.json'), JSON.stringify(report, null, 2))
console.log('screenshots and overflow.json in', OUT)
