/**
 * Gemma, the local assistant (engine 0.19's pixl-auto): its files and the
 * llama.cpp server that runs it, fetched from the pins in pixl-auto's
 * `brains.json` (Hugging Face at a commit, a GitHub release) and checked by
 * their SHA-256, never re-hosted; started on demand with a key of its own,
 * random per launch, bound to 127.0.0.1; stopped when idle, when Playroom
 * rests and when AI is switched off.
 *
 * Off until the user turns it on, and turning it on takes a sustained-load
 * benchmark (shared/heavy.ts): five naming runs of the same picture back to
 * back, timed, with the server's memory watched.
 *
 * What it does for the user: it names a photo's things (`name`), the
 * guide's corrected call (§1a, 2026-10-09), and nothing else; it never
 * judges a mask and never plans an edit.
 */
import { t } from '../../shared/i18n'
import { app, BrowserWindow } from 'electron'
import log from 'electron-log/main'
import { execFile } from 'child_process'
import { randomBytes } from 'crypto'
import { mkdir, readdir, rm, stat } from 'fs/promises'
import { createServer } from 'net'
import { cpus, totalmem } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import {
  pixlAuto,
  type LocalServer,
  type LocalServerBrain,
  type Pin,
  type PixlAuto
} from './pixlauto'
import { IPC, type BrainStatus } from '../../shared/ipc'
import {
  gemmaInBuild,
  judgeSustained,
  type HeavyBenchmark,
  type SustainedRun
} from '../../shared/heavy'
import {
  NAME_MAX_TOKENS,
  NAME_PROMPT,
  namesFromPlan,
  namingSystem,
  type PhotoNames
} from '../../shared/naming'
import { encodePng8 } from '../pngio'
import { paths } from '../paths'
import { BRAINS_DIR } from './carryover'
import type { ModelStore } from './models'
import type { AiSwitchStore } from './switches'

const run = promisify(execFile)

export const BRAIN_ID = 'gemma-4-e2b-it'

/** Gemma answered, but nothing usable: the photo is not asked again by itself. */
export class NamingAnswerError extends Error {}
const RUNTIME_ID = 'llama-server'
/** A server nothing asked of for this long is stopped. */
const IDLE_MS = 5 * 60_000
/** The benchmark's runs: the same picture, back to back (about a minute on an M2 Pro). */
const BENCH_RUNS = 5

/** pixl-auto, where it is installed (not in 0.4.0-beta: ai/pixlauto.ts). */
const AUTO = pixlAuto()
const NO_PIN: Pin = { name: '', bytes: 0, sha256: '' }
/** Where pixl-auto isn't installed: pins that name nothing (Gemma reads as unsupported). */
const NO_BRAIN = {
  id: BRAIN_ID,
  licence: '',
  source: { repo: '', commit: '' },
  files: { model: NO_PIN, mmproj: NO_PIN }
}
const NO_RUNTIME = {
  id: RUNTIME_ID,
  licence: '',
  source: { repo: '', tag: '' },
  binary: {} as Record<string, string>,
  platforms: {} as Record<string, Pin>
}

/** pixl-auto, where Gemma is used (only once `key` says this build has it). */
function auto(): PixlAuto {
  if (!AUTO) throw new Error(t('Gemma isn’t part of this version of Playroom'))
  return AUTO
}

/** pixl-auto's internals the guide's naming call uses until `brain.name()` exists (0.20). */
interface BrainInternals {
  _system: string
  _messages(text: string, image: Buffer, mime: string): unknown[]
  _chat(method: string, body: Record<string, unknown>): Promise<{ message: { content: string } }>
}

/** brains.json's archive for this computer: Metal on Apple silicon, Vulkan on Windows; none where Gemma isn't in this build. */
function platformKey(): string | null {
  if (!AUTO || !gemmaInBuild(app.isPackaged)) return null
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64'
  if (process.platform === 'win32' && process.arch === 'x64') return 'win32-x64-vulkan'
  if (process.platform === 'linux' && process.arch === 'x64') return 'linux-x64'
  return null
}

/** Layers on the GPU: all of them where llama.cpp has one here (Metal, Vulkan), none otherwise. */
function gpuLayers(key: string): number {
  return key === 'darwin-arm64' || key.endsWith('vulkan') ? 99 : 0
}

/** A free port on 127.0.0.1. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.unref()
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const a = s.address()
      s.close(() => (a && typeof a === 'object' ? resolve(a.port) : reject(new Error('no port'))))
    })
  })
}

/** A process's resident memory, MB, or null. */
async function rssMb(pid: number): Promise<number | null> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await run('powershell', [
        '-NoProfile',
        '-Command',
        `(Get-Process -Id ${pid}).WorkingSet64`
      ])
      return Math.round(parseInt(stdout, 10) / 1048576)
    }
    const { stdout } = await run('ps', ['-o', 'rss=', '-p', String(pid)])
    return Math.round(parseInt(stdout, 10) / 1024)
  } catch {
    return null
  }
}

/**
 * The benchmark's picture: drawn, never a photo (a sky, a field, a house
 * with a red roof, the sun), 768 × 512: the same tokens every run, so the
 * runs' times compare.
 */
function benchPicture(): Buffer {
  const w = 768
  const h = 512
  const px = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      let r: number, g: number, b: number
      if (y < h * 0.62) {
        const k = y / (h * 0.62)
        r = 90 + 80 * k
        g = 150 + 60 * k
        b = 230 - 20 * k
      } else {
        r = 60
        g = 140 - (y - h * 0.62) * 0.2
        b = 50
      }
      // The sun.
      if ((x - 620) ** 2 + (y - 90) ** 2 < 40 ** 2) [r, g, b] = [250, 220, 90]
      // The house, and its roof.
      if (x > 250 && x < 430 && y > 250 && y < 360) [r, g, b] = [200, 180, 150]
      if (y > 170 && y <= 250 && Math.abs(x - 340) < (y - 170) * 1.2) [r, g, b] = [180, 40, 35]
      if (x > 320 && x < 360 && y > 300 && y < 360) [r, g, b] = [90, 60, 40]
      px[i] = r
      px[i + 1] = g
      px[i + 2] = b
      px[i + 3] = 255
    }
  return encodePng8(px, w, h, 6)
}

export class BrainStore {
  private readonly brain = AUTO?.pins.brains.find((b) => b.id === BRAIN_ID) ?? NO_BRAIN
  private readonly runtime = AUTO?.pins.runtimes.find((r) => r.id === RUNTIME_ID) ?? NO_RUNTIME
  private readonly key = platformKey()
  private download_: { abort: AbortController; done: number; total: number } | null = null
  private failed: string | null = null
  private server: LocalServer | null = null
  private starting: Promise<LocalServerBrain> | null = null
  private brainObj: LocalServerBrain | null = null
  private idle: NodeJS.Timeout | undefined
  private benching = false
  /** Naming calls in flight. */
  private busy = 0

  constructor(
    private readonly models: ModelStore,
    private readonly switches: AiSwitchStore
  ) {
    // AI switched off, or Gemma: the server goes at once.
    switches.onChange((s) => {
      if (!s.enabled || !s.heavy.gemma.on) void this.stop()
    })
  }

  private dir(): string {
    return join(paths.models(), BRAINS_DIR, BRAIN_ID, this.brain.source.commit.slice(0, 12))
  }

  private runtimeDir(): string {
    return join(paths.models(), BRAINS_DIR, RUNTIME_ID, this.runtime.source.tag)
  }

  private files(): { pin: Pin; url: string; dest: string }[] {
    if (!this.key) return []
    const archive = this.runtime.platforms[this.key]
    return [
      {
        pin: this.brain.files.model,
        url: auto().brainUrl(BRAIN_ID, 'model'),
        dest: join(this.dir(), this.brain.files.model.name)
      },
      {
        pin: this.brain.files.mmproj,
        url: auto().brainUrl(BRAIN_ID, 'mmproj'),
        dest: join(this.dir(), this.brain.files.mmproj.name)
      },
      {
        pin: archive,
        url: auto().runtimeUrl(RUNTIME_ID, this.key),
        dest: join(this.runtimeDir(), archive.name)
      }
    ]
  }

  /** The server's binary, once the archive is unpacked. */
  private async binary(): Promise<string | null> {
    if (!this.key) return null
    const name = this.runtime.binary[process.platform]
    const walk = async (d: string, depth: number): Promise<string | null> => {
      for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
        if (e.isFile() && e.name === name) return join(d, e.name)
        if (e.isDirectory() && depth < 3) {
          const found = await walk(join(d, e.name), depth + 1)
          if (found) return found
        }
      }
      return null
    }
    return walk(this.runtimeDir(), 0)
  }

  async installed(): Promise<boolean> {
    for (const f of this.files()) {
      const s = await stat(f.dest).catch(() => null)
      if (!s || s.size !== f.pin.bytes) return false
    }
    return this.files().length > 0 && (await this.binary()) !== null
  }

  async status(): Promise<BrainStatus> {
    const s = await this.switches.get()
    const total = this.files().reduce((n, f) => n + f.pin.bytes, 0)
    return {
      id: BRAIN_ID,
      supported: this.key !== null,
      bytes: total,
      licence: `${this.brain.licence} (model) · ${this.runtime.licence} (llama.cpp)`,
      installed: await this.installed(),
      progress: this.download_ ? this.download_.done / Math.max(1, this.download_.total) : null,
      error: this.failed,
      running: this.server !== null,
      benchmarking: this.benching,
      on: s.heavy.gemma.on,
      benchmark: s.heavy.gemma.benchmark,
      machine: this.switches.machine
    }
  }

  private emit(): void {
    void this.status().then((st) => {
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.brain.event, st)
    })
  }

  async download(): Promise<void> {
    if (this.download_ || !this.key || (await this.installed())) return
    const abort = new AbortController()
    const files = this.files()
    const state = { abort, done: 0, total: files.reduce((n, f) => n + f.pin.bytes, 0) }
    this.download_ = state
    this.failed = null
    this.emit()
    let last = 0
    try {
      for (const f of files) {
        await mkdir(join(f.dest, '..'), { recursive: true })
        const have = await stat(f.dest).catch(() => null)
        if (have?.size === f.pin.bytes) {
          state.done += f.pin.bytes
          continue
        }
        await this.models.fetchFile(f.url, f.dest, f.pin, abort.signal, (n) => {
          state.done += n
          if (Date.now() - last > 250) {
            last = Date.now()
            this.emit()
          }
        })
      }
      // The server's archive unpacked beside it (tar reads a zip on Windows 10 and later too).
      const archive = files[2].dest
      await run('tar', ['-xf', archive, '-C', this.runtimeDir()])
      if (!(await this.binary())) throw new Error('the llama.cpp archive held no server')
      log.info('brain installed', BRAIN_ID, this.runtime.source.tag)
    } catch (err) {
      if (!abort.signal.aborted) {
        this.failed = (err as Error).message
        log.warn('brain download failed', this.failed)
      }
    } finally {
      this.download_ = null
      this.emit()
    }
  }

  cancel(): void {
    this.download_?.abort.abort()
  }

  async remove(): Promise<void> {
    this.cancel()
    await this.stop()
    await this.switches.setHeavy('gemma', false).catch(() => undefined)
    await rm(join(paths.models(), BRAINS_DIR), { recursive: true, force: true })
    this.emit()
  }

  /**
   * The assistant, its server started if it isn't (Gemma on, AI on). `bench`
   * starts it for the benchmark, before it may be on.
   */
  async open(bench = false): Promise<LocalServerBrain> {
    if (!this.key) throw new Error(t('Gemma isn’t part of this version of Playroom'))
    if (!bench && !(await this.switches.allowed('gemma')))
      throw new Error(t('Gemma is off: turn it on in Settings → AI models'))
    if (!(await this.switches.enabled())) throw new Error(t('AI models are off in Settings'))
    this.touch()
    if (this.brainObj && this.server) return this.brainObj
    this.starting ??= this.launch().finally(() => (this.starting = null))
    return this.starting
  }

  private async launch(): Promise<LocalServerBrain> {
    const binary = await this.binary()
    if (!binary || !(await this.installed())) throw new Error(t('Gemma is not downloaded yet'))
    const api_key = randomBytes(32).toString('hex')
    const port = await freePort()
    const t0 = Date.now()
    this.server = await auto().startLocalServer({
      binary,
      model: join(this.dir(), this.brain.files.model.name),
      mmproj: join(this.dir(), this.brain.files.mmproj.name),
      host: '127.0.0.1',
      port,
      threads: Math.max(2, Math.min(8, cpus().length - 2)),
      context: 8192,
      gpu_layers: gpuLayers(this.key!),
      ready_timeout_ms: 180_000,
      log: null,
      api_key
    })
    log.info('brain started', BRAIN_ID, `${Date.now() - t0} ms`, `port ${port}`)
    this.brainObj = new (auto().LocalServerBrain)({
      url: this.server.url,
      brain: BRAIN_ID,
      seed: 1,
      // Gemma pretty-prints its JSON: under 3000 a plan is cut off (the guide).
      max_tokens: { plan: 3000, rephrase: 40, describe: 300 },
      timeout_ms: 180_000,
      workers: auto().workersForPrompt(),
      api_key
    })
    // Naming only: the first line of its system text and the finders, no workers.
    const inner = this.brainObj as unknown as BrainInternals
    inner._system = namingSystem(auto().SYSTEM, auto().workersForPrompt())
    this.emit()
    return this.brainObj
  }

  /** Something asked of it: its idle time starts again. */
  private touch(): void {
    clearTimeout(this.idle)
    this.idle = setTimeout(() => void this.stop(), IDLE_MS)
    this.idle.unref()
  }

  /**
   * The server killed now, synchronously: Playroom quitting can't wait for
   * a polite close, and a server left behind would hold its gigabytes.
   */
  killNow(): void {
    clearTimeout(this.idle)
    const s = this.server
    this.server = null
    this.brainObj = null
    if (s) {
      try {
        process.kill(s.pid)
      } catch {
        // Gone already.
      }
    }
  }

  async stop(): Promise<void> {
    clearTimeout(this.idle)
    const s = this.server
    this.server = null
    this.brainObj = null
    if (s) {
      await s.close().catch(() => undefined)
      log.info('brain stopped')
      this.emit()
    }
  }

  /** Naming only: the plan's schema with no edits (the guide §1a). */
  private namingSchema(): Record<string, unknown> {
    const schema = auto().planSchema({ auto: true }) as {
      properties: { edits: Record<string, unknown> }
    }
    schema.properties.edits = { ...schema.properties.edits, maxItems: 0 }
    return schema as unknown as Record<string, unknown>
  }

  /** One naming call on an open brain: Gemma's answer, as names (flagged targets dropped). */
  private async ask(brain: LocalServerBrain, image: Buffer, mime: string): Promise<PhotoNames> {
    const inner = brain as unknown as BrainInternals
    const choice = await inner._chat('plan', {
      messages: inner._messages(NAME_PROMPT, image, mime),
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'plan', schema: this.namingSchema(), strict: true }
      },
      max_tokens: NAME_MAX_TOKENS
    })
    let plan: unknown
    try {
      plan = JSON.parse(choice.message.content)
    } catch {
      throw new NamingAnswerError('Gemma’s answer was not JSON')
    }
    const problems = auto().checkPlan(plan) as { path: string }[]
    return namesFromPlan(plan as object, problems, BRAIN_ID, new Date().toISOString())
  }

  /** What is in this picture, named by Gemma (on, AI on): its server started if it isn't. */
  async name(image: Buffer, mime: string): Promise<PhotoNames> {
    const brain = await this.open()
    this.busy++
    try {
      return await this.ask(brain, image, mime)
    } finally {
      this.busy--
      this.touch()
    }
  }

  /** Naming now (Playroom's rest leaves the server up until it is done). */
  isBusy(): boolean {
    return this.busy > 0 || this.benching
  }

  /**
   * The sustained-load benchmark: the server started (its load timed), then
   * the same naming run five times back to back, the server's memory
   * sampled each second. Judged by shared/heavy.ts and kept; the server
   * stops after unless Gemma was already on and running.
   */
  async benchmark(progress: (p: number, note: string) => void): Promise<HeavyBenchmark> {
    if (this.benching) throw new Error(t('The benchmark is already running'))
    if (!(await this.installed())) throw new Error(t('Download Gemma first'))
    this.benching = true
    this.emit()
    const wasRunning = this.server !== null
    let peak = 0
    let sampler: NodeJS.Timeout | undefined
    const runs: SustainedRun[] = []
    let readyMs = 0
    try {
      progress(0, t('Starting Gemma'))
      const t0 = Date.now()
      const brain = await this.open(true)
      readyMs = Date.now() - t0
      const sample = async (): Promise<void> => {
        const m = this.server ? await rssMb(this.server.pid) : null
        if (m && m > peak) peak = m
      }
      await sample()
      sampler = setInterval(() => void sample(), 1000)
      const image = benchPicture()
      for (let i = 0; i < BENCH_RUNS; i++) {
        progress(
          (i + 0.5) / BENCH_RUNS,
          t('Run {{run}} of {{runs}}', { run: i + 1, runs: BENCH_RUNS })
        )
        const t0 = Date.now()
        await this.ask(brain, image, 'image/png')
        runs.push({ ms: Date.now() - t0 })
        this.touch()
      }
      await sample()
    } catch (err) {
      log.warn('brain benchmark stopped', (err as Error).message)
      runs.length = Math.min(runs.length, 1)
    } finally {
      clearInterval(sampler)
      this.benching = false
      if (!wasRunning) await this.stop()
    }
    const totalMb = Math.round(totalmem() / 1048576)
    const judged = judgeSustained('gemma', runs, peak, totalMb)
    const b: HeavyBenchmark = {
      model: 'gemma',
      at: new Date().toISOString(),
      machine: this.switches.machine,
      readyMs,
      runs,
      peakMb: peak,
      totalMb,
      ...judged
    }
    log.info('brain benchmark', JSON.stringify(b))
    await this.switches.recordBenchmark(b)
    progress(1, b.passed ? t('Passed') : t('Did not pass'))
    this.emit()
    return b
  }
}
