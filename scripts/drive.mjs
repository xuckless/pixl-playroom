// REPL driver for Pixl Playroom: launches the built app (out/) with a hidden
// window and a throwaway profile, and takes commands on stdin.
//   node scripts/drive.mjs            then: launch, folder <path>, open <n>, ss <name>, eval <js>, quit
//   (also click, click-text, hover-text, drag-grip, press, stroke, drag, tap, wheel, panel, settle, wait)
import { _electron as electron } from 'playwright-core'
import * as readline from 'node:readline'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { createRequire } from 'node:module'

const APP_DIR = path.resolve(import.meta.dirname, '..')
const SHOT_DIR = process.env.SCREENSHOT_DIR || path.join(os.tmpdir(), 'playroom-shots')
const PROFILE =
  process.env.PLAYROOM_USER_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'playroom-profile-'))
fs.mkdirSync(SHOT_DIR, { recursive: true })

let app = null
let page = null
// The electron package exports its binary's path for this platform.
const bin = createRequire(import.meta.url)('electron')
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
      if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.text())
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
  /** hover-text <text> — the real pointer onto the rail row (or button) showing <text>; `-` moves it away. */
  async 'hover-text'(t) {
    if (t === '-') {
      await page.mouse.move(800, 500, { steps: 4 })
      return console.log('away')
    }
    const box = await page.evaluate((t) => {
      const el = [...document.querySelectorAll('.rail-item, button')].find((e) =>
        e.textContent?.includes(t)
      )
      const r = el?.getBoundingClientRect()
      return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null
    }, t)
    if (!box) return console.log('NOT_FOUND')
    await page.mouse.move(box.x, box.y, { steps: 4 })
    console.log('hovering', t)
  },
  /** drag-grip <from>|<to> — drag the rail row showing <from> by its grip onto the row showing <to>. */
  async 'drag-grip'(arg) {
    const [from, to] = arg.split('|')
    const pts = await page.evaluate(
      ([from, to]) => {
        const rows = [...document.querySelectorAll('.rail-item')]
        const a = rows.find((e) => e.textContent?.includes(from))?.querySelector('.rail-grip')
        const b = rows.find((e) => e.textContent?.includes(to))
        if (!a || !b) return null
        const ra = a.getBoundingClientRect()
        const rb = b.getBoundingClientRect()
        return [ra.x + ra.width / 2, ra.y + ra.height / 2, rb.y + rb.height / 2]
      },
      [from, to]
    )
    if (!pts) return console.log('NOT_FOUND')
    const [x, y, ty] = pts
    await page.mouse.move(x, y)
    await page.mouse.down()
    for (let k = 1; k <= 16; k++) await page.mouse.move(x, y + ((ty - y) * k) / 16)
    await sleep(100)
    await page.mouse.up()
    console.log('dragged', from, 'to', to)
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
  /**
   * drag x1,y1 x2,y2 [--render] — a pointer drag across the crop frame (or the
   * picture), in fractions of it. --render forces full engine renders while
   * the pointer is held, to prove a drag survives them.
   */
  async drag(arg) {
    const render = arg.includes('--render')
    const pts = arg
      .replace('--render', '')
      .trim()
      .split(/\s+/)
      .map((p) => p.split(',').map(Number))
    const box = await page.evaluate(() => {
      const el = document.querySelector('.crop-layer') ?? document.querySelector('.picture')
      const r = el?.getBoundingClientRect()
      return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null
    })
    if (!box) return console.log('nothing to drag on')
    const at = ([x, y]) => [box.x + x * box.w, box.y + y * box.h]
    const [ax, ay] = at(pts[0])
    const [bx, by] = at(pts[1])
    await page.mouse.move(ax, ay)
    await page.mouse.down()
    for (let k = 1; k <= 24; k++) {
      await page.mouse.move(ax + ((bx - ax) * k) / 24, ay + ((by - ay) * k) / 24)
      if (render && k % 6 === 0) {
        await page.evaluate(() => {
          const d = window.__playroom.useDevelop.getState()
          d.edit((r) => (r.basic.exposure = Math.round((r.basic.exposure + 0.05) * 100) / 100))
          d.commit('driver render')
        })
        await sleep(250)
      }
    }
    const during = await page.evaluate(() => {
      const b = document.querySelector('.crop-box')?.getBoundingClientRect()
      return b
        ? [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]
        : null
    })
    await page.mouse.up()
    console.log(
      'box before release:',
      JSON.stringify(during),
      'pointer at',
      Math.round(bx),
      Math.round(by)
    )
  },
  /** mdrag <selector> <dx> [--alt] — a real drag across an element, from its centre, dx pixels. */
  async mdrag(arg) {
    const alt = arg.includes('--alt')
    const [sel, dxs] = arg
      .replace('--alt', '')
      .trim()
      .split(/\s+(?=-?\d+$)/)
    const r = await page.evaluate((s) => {
      const b = document.querySelector(s)?.getBoundingClientRect()
      return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null
    }, sel)
    if (!r) return console.log('NOT_FOUND')
    const dx = Number(dxs)
    if (alt) await page.keyboard.down('Alt')
    await page.mouse.move(r.x, r.y)
    await page.mouse.down()
    for (let k = 1; k <= 12; k++) await page.mouse.move(r.x + (dx * k) / 12, r.y)
    await page.mouse.up()
    if (alt) await page.keyboard.up('Alt')
    console.log('dragged', sel, dx)
  },
  /** mclick <selector> [--dbl] — a real click at an element's centre. */
  async mclick(arg) {
    const dbl = arg.includes('--dbl')
    const sel = arg.replace('--dbl', '').trim()
    const r = await page.evaluate((s) => {
      const b = document.querySelector(s)?.getBoundingClientRect()
      return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null
    }, sel)
    if (!r) return console.log('NOT_FOUND')
    if (dbl) await page.mouse.dblclick(r.x, r.y)
    else await page.mouse.click(r.x, r.y)
    console.log('clicked', sel)
  },
  /** mhover <selector> — move the mouse over an element's centre. */
  async mhover(sel) {
    const r = await page.evaluate((s) => {
      const b = document.querySelector(s)?.getBoundingClientRect()
      return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null
    }, sel)
    if (!r) return console.log('NOT_FOUND')
    await page.mouse.move(r.x, r.y)
    console.log('hovering', sel)
  },
  /** tap x,y [x,y …] [--dbl] — real mouse clicks at fractions of the picture (--dbl double-clicks the last). */
  async tap(arg) {
    const dbl = arg.includes('--dbl')
    const pts = arg
      .replace('--dbl', '')
      .trim()
      .split(/\s+/)
      .map((p) => p.split(',').map(Number))
    const box = await page.evaluate(() => {
      const r = document.querySelector('.picture')?.getBoundingClientRect()
      return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null
    })
    if (!box) return console.log('no picture')
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = pts[i]
      const px = box.x + x * box.w
      const py = box.y + y * box.h
      if (dbl && i === pts.length - 1) await page.mouse.dblclick(px, py)
      else await page.mouse.click(px, py)
      await sleep(60)
    }
  },
  /** reduced on|off — emulate the reduced-motion preference. */
  async reduced(arg) {
    await page.emulateMedia({ reducedMotion: arg === 'off' ? 'no-preference' : 'reduce' })
  },
  /** wheel <selector> <deltaY> — a mouse-wheel turn over an element. */
  async wheel(arg) {
    const [sel, dy] = arg.split(/\s+/)
    const box = await page.evaluate((s) => {
      const r = document.querySelector(s)?.getBoundingClientRect()
      return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null
    }, sel)
    if (!box) return console.log('NOT_FOUND')
    await page.mouse.move(box.x, box.y)
    await page.mouse.wheel(0, Number(dy) || 100)
  },
  /** panel <id> — show a tool on the thumb-wheel. */
  async panel(id) {
    await page.evaluate((id) => window.__playroom.useUi.getState().setPanel(id), id)
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
