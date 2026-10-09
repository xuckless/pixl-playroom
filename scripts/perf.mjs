#!/usr/bin/env node
/**
 * Playroom's UI profiled on the built app (TODO Pass 116): the same
 * scenarios every time, so a change, a pass or an engine update can be
 * compared against the last run.
 *
 *   PLAYROOM_PROFILE_BUILD=1 npx electron-vite build --outDir out-verify
 *   echo '{"name":"pixl-playroom","main":"./main/index.js"}' > out-verify/package.json
 *   node scripts/perf.mjs --app out-verify --photos <folder> --out <dir> [--full-hdr] [--only a,b]
 *
 * `--photos` is a folder of a few hundred photos: never committed (the
 * owner's photos stay on the owner's machines). Each run starts from a
 * fresh profile inside `--out`, so first-open numbers compare.
 *
 * Per scenario it writes:
 * - `<scenario>.renderer.cpuprofile` and `<scenario>.main.cpuprofile`:
 *   flame graphs (Chrome DevTools → Performance → Load profile, or
 *   speedscope.app). A profiling build keeps the renderer's names.
 * - the wall time, frame times (requestAnimationFrame), long tasks, the
 *   IPC calls (round trips, time, bytes each way; `PLAYROOM_IPC_TRACE`) and
 *   the messages main sent, and the functions with the most self time.
 *
 * Then `summary.json` and `summary.md` in `--out`.
 */
import { _electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const APP = resolve(arg('app', 'out-verify'))
const PHOTOS = arg('photos')
const OUT = resolve(arg('out', 'perf-out'))
const ONLY = arg('only')?.split(',')
/** `--full-hdr`: the Full HDR toggle on (drafts as F16 HDR frames), as the owner edits. */
const FULL_HDR = process.argv.includes('--full-hdr')
if (!PHOTOS) {
  console.error('usage: node scripts/perf.mjs --app out-verify --photos <folder> --out <dir>')
  process.exit(2)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pct = (xs, p) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]
}
const round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d

/** The functions with the most self time in a .cpuprofile. */
function topSelf(profile, n = 12) {
  const byId = new Map(profile.nodes.map((nd) => [nd.id, nd]))
  const self = new Map()
  for (let i = 0; i < profile.samples.length; i++) {
    const nd = byId.get(profile.samples[i])
    const dt = (profile.timeDeltas[i] ?? 0) / 1000
    const cf = nd.callFrame
    if (cf.functionName === '(idle)') continue
    const where = cf.url ? `${basename(cf.url)}:${cf.lineNumber + 1}` : ''
    const key = `${cf.functionName || '(anonymous)'} ${where}`.trim()
    self.set(key, (self.get(key) ?? 0) + dt)
  }
  const total = [...self.values()].reduce((a, b) => a + b, 0)
  return {
    busyMs: round(total),
    top: [...self.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([fn, ms]) => ({ fn, ms: round(ms) }))
  }
}

const profileDir = join(OUT, 'profile')
rmSync(profileDir, { recursive: true, force: true })
mkdirSync(profileDir, { recursive: true })

const app = await _electron.launch({
  args: [APP],
  cwd: resolve('.'),
  env: {
    ...process.env,
    PLAYROOM_USER_DATA: profileDir,
    PLAYROOM_IPC_TRACE: '1',
    // A launched window can't be made the active app on macOS: shown counts
    // as in use (rest.ts), so the scenarios measure Playroom in use.
    PLAYROOM_ASSUME_FOCUSED: '1',
    // Background work (Gemma's names, the cull signals) held off: the
    // scenarios measure the UI, not what idle time does.
    PLAYROOM_NAMING_IDLE_S: '1000000',
    PLAYROOM_CULL_IDLE_S: '1000000'
  }
})
const win = await app.firstWindow()
await win.waitForLoadState('domcontentloaded')
await sleep(2500)
await win
  .getByRole('button', { name: "Don't send" })
  .click({ timeout: 2000 })
  .catch(() => {})
if (FULL_HDR) await win.evaluate(() => window.__playroom.useUi.getState().setFullHdr(true))
const fullHdr = await win.evaluate(() => window.__playroom.useUi.getState().fullHdr)
const cdp = await win.context().newCDPSession(win)
await cdp.send('Profiler.enable')
await cdp.send('Profiler.setSamplingInterval', { interval: 250 })

// Main's own profiler, through its inspector.
await app.evaluate(() => {
  const inspector = process.getBuiltinModule('node:inspector')
  const s = new inspector.Session()
  s.connect()
  globalThis.__perf = {
    session: s,
    post: (m, p) => new Promise((ok, no) => s.post(m, p ?? {}, (e, r) => (e ? no(e) : ok(r))))
  }
  return globalThis.__perf.post('Profiler.enable')
})
// What main sends the renderer, counted.
await app.evaluate(({ BrowserWindow }) => {
  globalThis.__perfSends = []
  for (const w of BrowserWindow.getAllWindows()) {
    const send = w.webContents.send.bind(w.webContents)
    w.webContents.send = (channel, ...args) => {
      let bytes = 0
      try {
        bytes = JSON.stringify(args)?.length ?? 0
      } catch {
        bytes = -1
      }
      globalThis.__perfSends.push({ channel, bytes })
      return send(channel, ...args)
    }
  }
})

/** Playroom the active app: the safe-shutdown rest starts after 120 s behind, and would skew a scenario. */
const focus = () =>
  app.evaluate(({ app: a, BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    if (w?.isMinimized()) w.restore()
    w?.show()
    w?.focus()
    a.focus({ steal: true })
  })

async function begin() {
  await focus()
  await win.evaluate(() => {
    window.__perfFrames = []
    window.__perfLong = []
    let last = performance.now()
    const tick = (t) => {
      window.__perfFrames.push(t - last)
      last = t
      if (window.__perfOn) requestAnimationFrame(tick)
    }
    window.__perfOn = true
    requestAnimationFrame(tick)
    window.__perfObs?.disconnect()
    window.__perfObs = new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__perfLong.push(e.duration)
    })
    window.__perfObs.observe({ type: 'longtask', buffered: false })
    // Long animation frames (Chrome 123+): a frame held past 50 ms, and by what.
    window.__perfLoaf = []
    window.__perfLoafObs?.disconnect()
    window.__perfLoafObs = new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__perfLoaf.push(e.duration)
    })
    try {
      window.__perfLoafObs.observe({ type: 'long-animation-frame', buffered: false })
    } catch {
      // Not in this Chromium.
    }
  })
  await app.evaluate(() => {
    globalThis.__playroomIpcTrace = []
    globalThis.__perfSends = []
    return globalThis.__perf.post('Profiler.start')
  })
  await cdp.send('Profiler.start')
  return performance.now()
}

async function end(name, t0, extra = {}) {
  const wall = performance.now() - t0
  const { profile: renderer } = await cdp.send('Profiler.stop')
  const main = await app.evaluate(async () => {
    const { profile } = await globalThis.__perf.post('Profiler.stop')
    return {
      profile: JSON.stringify(profile),
      ipc: globalThis.__playroomIpcTrace ?? [],
      sends: globalThis.__perfSends ?? []
    }
  })
  const page = await win.evaluate(() => {
    window.__perfOn = false
    return {
      frames: window.__perfFrames.slice(1),
      long: window.__perfLong,
      loaf: window.__perfLoaf ?? []
    }
  })
  writeFileSync(join(OUT, `${name}.renderer.cpuprofile`), JSON.stringify(renderer))
  writeFileSync(join(OUT, `${name}.main.cpuprofile`), main.profile)
  const ipc = {}
  for (const r of main.ipc) {
    const c = (ipc[r.channel] ??= { calls: 0, ms: [], inBytes: 0, outBytes: 0 })
    c.calls++
    c.ms.push(r.ms)
    c.inBytes += r.inBytes
    c.outBytes += r.outBytes
  }
  const sends = {}
  for (const s of main.sends) {
    const c = (sends[s.channel] ??= { count: 0, bytes: 0 })
    c.count++
    c.bytes += s.bytes
  }
  const f = page.frames
  return {
    name,
    wallMs: round(wall),
    ...extra,
    frames: {
      count: f.length,
      p50: round(pct(f, 50)),
      p95: round(pct(f, 95)),
      max: round(Math.max(0, ...f)),
      over33: f.filter((x) => x > 33.4).length
    },
    longTasks: { count: page.long.length, totalMs: round(page.long.reduce((a, b) => a + b, 0)) },
    longFrames: {
      count: page.loaf.length,
      maxMs: round(Math.max(0, ...page.loaf)),
      totalMs: round(page.loaf.reduce((a, b) => a + b, 0))
    },
    ipc: Object.entries(ipc)
      .map(([channel, c]) => ({
        channel,
        calls: c.calls,
        p50Ms: round(pct(c.ms, 50)),
        maxMs: round(Math.max(...c.ms)),
        inKB: round(c.inBytes / 1024),
        outKB: round(c.outBytes / 1024)
      }))
      .sort((a, b) => b.calls * b.p50Ms - a.calls * a.p50Ms),
    sends: Object.entries(sends)
      .map(([channel, c]) => ({ channel, count: c.count, KB: round(c.bytes / 1024) }))
      .sort((a, b) => b.count - a.count),
    renderer: topSelf(renderer),
    main: topSelf(JSON.parse(main.profile))
  }
}

const store = (fn, a) => win.evaluate(fn, a)
const state = () =>
  store(() => {
    const L = window.__playroom.useLibrary.getState()
    return {
      items: L.items.length,
      // An unreadable file gets no thumbnail: it is done all the same.
      thumbs: L.items.filter((i) => i.thumbUrl || i.unreadable).length,
      view: L.view
    }
  })

const results = []
const run = async (name, fn) => {
  if (ONLY && !ONLY.includes(name)) return
  process.stdout.write(`${name}… `)
  const t0 = await begin()
  let extra = {}
  try {
    extra = (await fn()) ?? {}
  } catch (err) {
    extra = { error: err.message }
  }
  const r = await end(name, t0, extra)
  results.push(r)
  console.log(`${r.wallMs} ms, frames p95 ${r.frames.p95} ms, ${r.longTasks.count} long tasks`)
}

await run('open-folder', async () => {
  const t0 = performance.now()
  await store(async (f) => window.__playroom.useLibrary.getState().openFolder(f), PHOTOS)
  const listed = performance.now() - t0
  let s = await state()
  let first = null
  while (performance.now() - t0 < 900_000) {
    s = await state()
    if (first === null && s.thumbs >= Math.min(24, s.items)) first = performance.now() - t0
    if (s.thumbs >= s.items) break
    await sleep(250)
  }
  return {
    photos: s.items,
    listedMs: round(listed),
    first24ThumbsMs: round(first ?? -1),
    allThumbsMs: round(performance.now() - t0),
    thumbsDone: s.thumbs
  }
})

await run('scroll-grid', async () => {
  const grid = win.locator('.grid')
  await grid.hover()
  for (let i = 0; i < 40; i++) {
    await win.mouse.wheel(0, 400)
    await sleep(40)
  }
  for (let i = 0; i < 40; i++) {
    await win.mouse.wheel(0, -400)
    await sleep(40)
  }
})

await run('open-photo', async () => {
  const t0 = performance.now()
  await win.locator('.thumb').first().dblclick()
  await win.waitForFunction(() => window.__playroom.useLibrary.getState().view === 'develop')
  await win.waitForFunction(() => window.__playroom.useDevelop.getState().picture !== null, null, {
    timeout: 60_000
  })
  const firstMs = performance.now() - t0
  await win.waitForFunction(
    () => window.__playroom.useDevelop.getState().picture?.kind === 'full',
    null,
    { timeout: 60_000 }
  )
  return { firstPictureMs: round(firstMs), settledMs: round(performance.now() - t0) }
})

await run('drag-slider', async () => {
  const slider = win.getByRole('slider', { name: 'Exposure', exact: true }).first()
  await slider.scrollIntoViewIfNeeded()
  const box = await slider.boundingBox()
  const y = box.y + box.height / 2
  await win.mouse.move(box.x + box.width * 0.5, y)
  await win.mouse.down()
  // Two seconds back and forth, a move every 16 ms.
  for (let i = 0; i <= 120; i++) {
    const t = i / 120
    const x = box.x + box.width * (0.5 + 0.3 * Math.sin(t * Math.PI * 2))
    await win.mouse.move(x, y)
    await sleep(16)
  }
  await win.mouse.up()
  const t0 = performance.now()
  await win.waitForFunction(() => !window.__playroom.useDevelop.getState().rendering, null, {
    timeout: 30_000
  })
  return { settleAfterReleaseMs: round(performance.now() - t0) }
})

await run('loupe-pan', async () => {
  await win.locator('.loupe').first().hover()
  await win.keyboard.press('z')
  await sleep(1500)
  const box = await win.locator('.loupe').first().boundingBox()
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await win.mouse.move(cx, cy)
  await win.mouse.down()
  for (let i = 0; i <= 90; i++) {
    const t = i / 90
    await win.mouse.move(cx + 250 * Math.sin(t * Math.PI * 2), cy + 120 * Math.cos(t * Math.PI * 2))
    await sleep(16)
  }
  await win.mouse.up()
  await sleep(1500)
  await win.keyboard.press('z')
  await sleep(800)
})

await run('masks', async () => {
  await store(() => window.__playroom.useUi.getState().setMasksWin({ open: true }))
  await sleep(500)
  await win.getByRole('button', { name: 'New', exact: true }).click()
  await win.locator('.tp-tool', { hasText: 'Radial gradient' }).click()
  const box = await win.locator('.loupe').first().boundingBox()
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await win.mouse.move(cx, cy)
  await win.mouse.down()
  for (let i = 0; i <= 40; i++) {
    await win.mouse.move(cx + i * 5, cy + i * 3)
    await sleep(16)
  }
  await win.mouse.up()
  await win.waitForFunction(() => !window.__playroom.useDevelop.getState().rendering, null, {
    timeout: 30_000
  })
  const layers = await store(() => window.__playroom.useDevelop.getState().recipe?.layers.length)
  return { layers }
})

await run('filmstrip', async () => {
  await store(() => window.__playroom.useUi.setState({ filmstrip: true }))
  await sleep(800)
  await win.locator('.filmstrip').hover()
  for (let i = 0; i < 40; i++) {
    await win.mouse.wheel(0, 300)
    await sleep(40)
  }
  for (let i = 0; i < 40; i++) {
    await win.mouse.wheel(0, -300)
    await sleep(40)
  }
})

await run('export', async () => {
  const settings = JSON.parse(
    execFileSync(
      process.execPath,
      [
        '--import',
        './tests/register.mjs',
        '--experimental-strip-types',
        '--no-warnings',
        '--input-type=module',
        '-e',
        "const { defaultExportSettings } = await import('./src/shared/export.ts'); process.stdout.write(JSON.stringify(defaultExportSettings()))"
      ],
      { encoding: 'utf8' }
    )
  )
  const dest = join(OUT, 'export')
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  settings.folder = dest
  const key = await store(() => window.__playroom.useDevelop.getState().session.key)
  const t0 = performance.now()
  await store(
    async ([k, s]) =>
      new Promise((ok) => {
        const off = window.playroom.export.onProgress((p) => {
          if (p.finished) {
            off()
            ok(p)
          }
        })
        void window.playroom.export.start([k], s)
      }),
    [key, settings]
  )
  return { exportMs: round(performance.now() - t0) }
})

/**
 * The safe-shutdown rest (Pass 106, rest.ts): minimised, the engine hosts
 * must go about 60 s after their queued work ends, and the app sit idle;
 * shown again, the interactive engine comes back. Electron's own process
 * metrics: the hosts are utility processes named pixl-engine-*.
 */
const metrics = () =>
  app.evaluate(({ app: a }) => {
    const m = a.getAppMetrics()
    const hosts = m.filter((p) => p.type === 'Utility' && /pixl-engine/.test(p.name ?? ''))
    return {
      hosts: hosts.length,
      hostMb: Math.round(hosts.reduce((t, p) => t + p.memory.workingSetSize, 0) / 1024),
      appMb: Math.round(m.reduce((t, p) => t + p.memory.workingSetSize, 0) / 1024),
      // By process: what still holds memory once the hosts are gone.
      byProcess: Object.fromEntries(
        Object.entries(
          m.reduce((acc, p) => {
            const k = p.type === 'Utility' ? (p.name ?? 'utility').replace(/^pixl-/, '') : p.type
            acc[k] = (acc[k] ?? 0) + p.memory.workingSetSize
            return acc
          }, {})
        ).map(([k, v]) => [k, Math.round(v / 1024)])
      ),
      cpu: Math.round(m.reduce((t, p) => t + p.cpu.percentCPUUsage, 0) * 10) / 10
    }
  })
const llama = () => {
  try {
    return execFileSync('pgrep', ['-f', 'llama-server'], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean).length
  } catch {
    return 0
  }
}
if (!ONLY || ONLY.includes('rest')) {
  process.stdout.write('rest… ')
  const before = await metrics()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize())
  const t0 = performance.now()
  const samples = []
  let goneAt = null
  while (performance.now() - t0 < 180_000) {
    await sleep(5000)
    const m = await metrics()
    // What the top bar says: "Engine offline", yellow, once the interactive host rests.
    const pill = await win.evaluate(() => {
      const el = document.querySelector('.engine-status')
      return el
        ? `${el.textContent?.trim()} (${[...el.classList].filter((c) => c !== 'engine-status' && c !== 'micro').join(' ')})`
        : null
    })
    samples.push({ s: Math.round((performance.now() - t0) / 1000), ...m, pill })
    if (goneAt === null && m.hosts === 0) goneAt = samples.at(-1).s
    // Gone, and a quiet half-minute after: enough said.
    if (goneAt !== null && samples.at(-1).s - goneAt >= 30) break
  }
  const after = samples.at(-1)
  const idle = samples.filter((x) => goneAt !== null && x.s > goneAt)
  const w0 = performance.now()
  await focus()
  await win
    .waitForFunction(
      () => window.__playroom.useLibrary.getState().engine?.status === 'ready',
      null,
      { timeout: 60_000 }
    )
    .catch(() => {})
  const woke = await metrics()
  const r = {
    name: 'rest',
    hostsBefore: before.hosts,
    hostMbBefore: before.hostMb,
    appMbBefore: before.appMb,
    hostsGoneAfterS: goneAt,
    appMbResting: after?.appMb,
    restingByProcess: after?.byProcess,
    idleCpuPct: idle.length
      ? Math.round((idle.reduce((t, x) => t + x.cpu, 0) / idle.length) * 10) / 10
      : null,
    llamaServers: llama(),
    wakeMs: Math.round(performance.now() - w0),
    hostsAwake: woke.hosts,
    samples
  }
  results.push(r)
  writeFileSync(join(OUT, 'rest.json'), JSON.stringify(r, null, 2))
  console.log(
    `hosts ${r.hostsBefore} → 0 after ${goneAt ?? 'never'} s, resting ${r.appMbResting} MB at ${r.idleCpuPct}% CPU, woke in ${r.wakeMs} ms`
  )
}

await app.close()
rmSync(profileDir, { recursive: true, force: true })

writeFileSync(join(OUT, 'summary.json'), JSON.stringify(results, null, 2))
const md = [
  `# Playroom UI profile (${new Date().toISOString()})`,
  '',
  `${PHOTOS}${fullHdr ? ', Full HDR on' : ''}.`,
  '',
  '| Scenario | Wall | Scenario numbers | Frames p50 / p95 / max (> 33 ms) | Long tasks | Long frames (max) | IPC calls | Renderer busy | Main busy |',
  '|---|---|---|---|---|---|---|---|---|',
  ...results
    .filter((r) => r.frames)
    .map((r) => {
      const own = Object.entries(r)
        .filter(
          ([k]) =>
            ![
              'name',
              'wallMs',
              'frames',
              'longTasks',
              'longFrames',
              'ipc',
              'sends',
              'renderer',
              'main'
            ].includes(k)
        )
        .map(([k, v]) => `${k} ${v}`)
        .join(', ')
      return `| ${r.name} | ${r.wallMs} ms | ${own} | ${r.frames.p50} / ${r.frames.p95} / ${r.frames.max} (${r.frames.over33}) | ${r.longTasks.count}, ${r.longTasks.totalMs} ms | ${r.longFrames.count} (${r.longFrames.maxMs} ms) | ${r.ipc.reduce((a, c) => a + c.calls, 0)} | ${r.renderer.busyMs} ms | ${r.main.busyMs} ms |`
    }),
  '',
  ...results
    .filter((r) => r.name === 'rest')
    .flatMap((r) => [
      '## rest (minimised)',
      '',
      `Engine hosts ${r.hostsBefore} (${r.hostMbBefore} MB; app ${r.appMbBefore} MB) → none after ${r.hostsGoneAfterS ?? 'never'} s. Resting: app ${r.appMbResting} MB, ${r.idleCpuPct}% CPU. llama-server processes: ${r.llamaServers}. Shown again: ready in ${r.wakeMs} ms, ${r.hostsAwake} host(s).`,
      '',
      `Resting, by process (MB): ${Object.entries(r.restingByProcess ?? {})
        .map(([k, v]) => `${k} ${v}`)
        .join(', ')}.`,
      '',
      '| s | hosts | hosts MB | app MB | CPU % | top bar |',
      '|---|---|---|---|---|---|',
      ...r.samples.map(
        (x) => `| ${x.s} | ${x.hosts} | ${x.hostMb} | ${x.appMb} | ${x.cpu} | ${x.pill ?? ''} |`
      ),
      ''
    ]),
  ...results
    .filter((r) => r.frames)
    .flatMap((r) => [
      `## ${r.name}`,
      '',
      'Renderer self time: ' +
        r.renderer.top
          .slice(0, 8)
          .map((t) => `${t.fn} ${t.ms} ms`)
          .join('; '),
      '',
      'Main self time: ' +
        r.main.top
          .slice(0, 8)
          .map((t) => `${t.fn} ${t.ms} ms`)
          .join('; '),
      '',
      'IPC: ' +
        r.ipc
          .slice(0, 8)
          .map((c) => `${c.channel} ×${c.calls} p50 ${c.p50Ms} ms (${c.outKB} KB out)`)
          .join('; '),
      '',
      'Sent to the renderer: ' +
        r.sends
          .slice(0, 8)
          .map((c) => `${c.channel} ×${c.count} (${c.KB} KB)`)
          .join('; '),
      ''
    ])
].join('\n')
writeFileSync(join(OUT, 'summary.md'), md)
console.log(`\n${join(OUT, 'summary.md')}`)
