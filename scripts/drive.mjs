// REPL driver for Pixl Playroom: launches the built app (out/) with a hidden
// window and a throwaway profile, and takes commands on stdin.
//   node scripts/drive.mjs            then: launch, folder <path>, open <n>, ss <name>, eval <js>, quit
import { _electron as electron } from 'playwright-core'
import * as readline from 'node:readline'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

const APP_DIR = path.resolve(import.meta.dirname, '..')
const SHOT_DIR = process.env.SCREENSHOT_DIR || path.join(os.tmpdir(), 'playroom-shots')
const PROFILE =
  process.env.PLAYROOM_USER_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'playroom-profile-'))
fs.mkdirSync(SHOT_DIR, { recursive: true })

let app = null
let page = null
const bin = path.join(APP_DIR, 'node_modules/electron/dist/electron')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const COMMANDS = {
  async launch() {
    app = await electron.launch({
      executablePath: bin,
      args: [APP_DIR],
      env: {
        ...process.env,
        PLAYROOM_HIDDEN: process.env.PLAYROOM_HIDDEN ?? '1',
        PLAYROOM_USER_DATA: PROFILE
      },
      timeout: 30_000
    })
    page = await app.firstWindow()
    await page.setViewportSize({ width: 1600, height: 1000 }).catch(() => {})
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setContentSize(1600, 1000)
    )
    page.on('console', (m) => {
      if (m.type() === 'error') console.log('[console]', m.text())
    })
    await page.waitForSelector('.app', { timeout: 20_000 })
    console.log('launched. profile:', PROFILE)
  },
  async ss(name) {
    const f = path.join(SHOT_DIR, (name || `ss-${Date.now()}`) + '.png')
    // capturePage works on a hidden window, where Playwright's screenshot waits for frames forever.
    const b64 = await app.evaluate(async ({ BrowserWindow }) => {
      const img = await BrowserWindow.getAllWindows()[0].webContents.capturePage()
      return img.toPNG().toString('base64')
    })
    fs.writeFileSync(f, Buffer.from(b64, 'base64'))
    console.log('screenshot:', f)
  },
  async folder(p) {
    await page.evaluate((p) => window.__playroom.useLibrary.getState().openFolder(p), p)
    console.log(
      'items:',
      await page.evaluate(() =>
        window.__playroom.useLibrary
          .getState()
          .items.map((i) => i.name)
          .join(', ')
      )
    )
  },
  async open(n) {
    const key = await page.evaluate((n) => {
      const lib = window.__playroom.useLibrary.getState()
      const item = lib.visible().find((i) => i.name === n) ?? lib.visible()[Number(n) || 0]
      lib.setFocus(item.key)
      lib.setView('develop')
      void window.__playroom.useDevelop.getState().open(item.key)
      return item.key + ' ' + item.name
    }, n)
    console.log('opening', key)
    await COMMANDS.settle()
  },
  /** Wait until the develop view has a full render and nothing in flight. */
  async settle(ms) {
    const until = Date.now() + (Number(ms) || 60_000)
    while (Date.now() < until) {
      const s = await page.evaluate(() => {
        const d = window.__playroom.useDevelop.getState()
        return { loading: d.loading, rendering: d.rendering, kind: d.picture?.kind, error: d.error }
      })
      if (s.error) return console.log('error:', s.error)
      if (!s.loading && !s.rendering && s.kind === 'full') return console.log('settled')
      await sleep(200)
    }
    console.log('TIMEOUT waiting for render')
  },
  async edit(js) {
    // e.g. edit r.basic.exposure = 1
    await page.evaluate((js) => {
      const d = window.__playroom.useDevelop.getState()
      d.edit(new Function('r', js))
      d.commit('driver edit')
    }, js)
    await sleep(300)
    await COMMANDS.settle()
  },
  async eval(expr) {
    try {
      console.log(JSON.stringify(await page.evaluate(expr), null, 1)?.slice(0, 4000))
    } catch (e) {
      console.log('ERROR:', e.message)
    }
  },
  async click(sel) {
    console.log(
      await page.evaluate((s) => {
        const el = document.querySelector(s)
        if (!el) return 'NOT_FOUND'
        el.click()
        return 'OK'
      }, sel)
    )
  },
  async 'click-text'(t) {
    console.log(
      await page.evaluate((t) => {
        const els = [
          ...document.querySelectorAll(
            'button, [role="button"], .preset, .layer-row, .section > header'
          )
        ]
        const el =
          els.find((e) => e.textContent?.trim() === t) ??
          els.find((e) => e.textContent?.includes(t))
        if (!el) return 'NOT_FOUND'
        el.click()
        return 'OK'
      }, t)
    )
  },
  async press(k) {
    await page.keyboard.press(k)
  },
  /** stroke x1,y1 x2,y2 ... — a mouse drag through points given as fractions of the loupe picture. */
  async stroke(arg) {
    const pts = arg.split(/\s+/).map((p) => p.split(',').map(Number))
    const box = await page.evaluate(() => {
      const r = document.querySelector('.picture')?.getBoundingClientRect()
      return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null
    })
    if (!box) return console.log('no picture')
    const at = ([x, y]) => [box.x + x * box.w, box.y + y * box.h]
    await page.mouse.move(...at(pts[0]))
    await page.mouse.down()
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = at(pts[i - 1])
      const [bx, by] = at(pts[i])
      for (let k = 1; k <= 12; k++)
        await page.mouse.move(ax + ((bx - ax) * k) / 12, ay + ((by - ay) * k) / 12)
    }
    await page.mouse.up()
    console.log('stroked', pts.length, 'points')
  },
  async wait(ms) {
    await sleep(Number(ms) || 1000)
  },
  async quit() {
    if (app) await app.close().catch(() => {})
    process.exit(0)
  },
  help() {
    console.log(Object.keys(COMMANDS).join(', '))
  }
}

const stdin = fs.createReadStream(null, { fd: fs.openSync('/dev/stdin', 'r') })
const rl = readline.createInterface({ input: stdin, output: process.stdout, prompt: 'driver> ' })
let chain = Promise.resolve()
rl.on('line', (line) => {
  chain = chain.then(async () => {
    const [cmd, ...rest] = line.trim().split(/\s+/)
    if (!cmd) return
    const fn = COMMANDS[cmd]
    if (!fn) return console.log('unknown:', cmd)
    try {
      await fn(rest.join(' '))
    } catch (e) {
      console.log('ERROR:', e.message)
    }
    console.log(`done: ${cmd}`)
  })
})
console.log('playroom driver ready')
