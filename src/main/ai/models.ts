/**
 * The AI models: which ones exist (the engine's roster, `@xuckless/pixl-
 * models`), which are on this machine, and getting and removing them.
 *
 * None ships with the app. Each is downloaded when first wanted from
 * `models.pixlfoundation.com/<id>/<version>/<file>` (a mirror of the
 * engine's published model packages, uploaded by `scripts/publish-models.mjs`)
 * into `userData/models/<id>/<version>/`, and checked against the roster's
 * SHA-256 and size before it is used. A download resumes where it stopped.
 * `PLAYROOM_MODELS_URL` points somewhere else (an `https://` mirror, or a
 * `file://` folder in the same layout) for development.
 *
 * What runs a model is the engine's bundled ONNX Runtime, on the machine's
 * accelerator (CoreML on a Mac, DirectML on Windows) unless the performance
 * test found the CPU faster, or the accelerator refused.
 */
import { BrowserWindow } from 'electron'
import log from 'electron-log/main'
import { createHash } from 'crypto'
import { createReadStream, createWriteStream } from 'fs'
import { mkdir, rename, rm, stat } from 'fs/promises'
import { fileURLToPath } from 'url'
import { join } from 'path'
import { pipeline } from 'stream/promises'
import { Readable, Transform } from 'stream'
import type { ExecutionProvider, SessionSpec } from '../../shared/engine-types'
import { IPC, type EngineStatus, type ModelInfo, type ProviderInfo } from '../../shared/ipc'
import type { EngineClient } from '../engine/client'
import type { IndexClient } from '../indexer/client'
import { paths } from '../paths'
import { BACKGROUND_THREADS } from '../source'
import { ENHANCE_MODEL, FIRST_GUESS_MS_PER_MP, type EnhanceStepKind } from '../../shared/enhance'
import { modelSpeed, referenceOf, testFactor, type ModelSpeed } from '../../shared/modelSpeed'
import { DENOISE_RATE_KEY, ENHANCE_RATE_KEY } from './rates'
import { LEGACY_MODELS, fillRef, legacyInstalledDir, legacyModel } from './legacymodels'
import { carryOver } from './carryover'

import * as pixlModels from '@xuckless/pixl-models'
import type { ModelEntry as RosterEntry, ModelFile as RosterFile } from '@xuckless/pixl-models'

export type { RosterEntry }

const BASE = (process.env.PLAYROOM_MODELS_URL ?? 'https://models.pixlfoundation.com').replace(
  /\/+$/,
  ''
)

/** The models server (or its stand-in): the lens catalogue is served beside the models. */
export const MODELS_BASE = BASE

/** Which provider the performance test chose: the accelerator unless the CPU won. */
const PROVIDER_KEY = 'ai.provider'
/** What the performance test measured, per provider. */
const MEASURED_KEY = 'ai.providerTimes'
/** How long the models' speeds are kept before the remembered rates are read again. */
const SPEED_CACHE_MS = 5000

/** A model's name alone: the roster's title less what it is for ("U²-Netp: salient…"). */
export function modelName(e: Pick<RosterEntry, 'title'>): string {
  return e.title.split(':')[0].trim()
}

export class ModelMissing extends Error {
  code = 'ModelNotInstalled'
  constructor(readonly entry: RosterEntry) {
    super(`${modelName(entry)} is not downloaded yet: Settings → AI models`)
  }
}

export class ModelStore {
  private downloads = new Map<string, { abort: AbortController; done: number; total: number }>()
  private failed = new Map<string, string>()
  private installedCache = new Map<string, boolean>()
  /** Where each installed legacy model (see `legacymodels.ts`) is on this machine. */
  private legacyDirs = new Map<string, string>()

  constructor(
    private readonly settings: IndexClient,
    private readonly engineStatus: () => EngineStatus
  ) {}

  /** Every model the app can use (the roster's shipped ones). */
  roster(): RosterEntry[] {
    return pixlModels.manifest().filter((m) => m.ship)
  }

  entry(id: string): RosterEntry {
    const e = this.roster().find((m) => m.id === id)
    if (!e) throw new Error(`no model "${id}"`)
    return e
  }

  /**
   * A model engine 0.17 retired that this release still honours (U²-Net,
   * FBCNN at a quality): not in the roster, so `entry()` cannot name it.
   */
  private legacy(id: string): ReturnType<typeof legacyModel> {
    return this.roster().some((m) => m.id === id) ? undefined : legacyModel(id)
  }

  /** Where a model's files live on this machine. */
  dir(id: string): string {
    const l = this.legacy(id)
    if (l) return this.legacyDirs.get(id) ?? join(paths.models(), l.id, l.version)
    const e = this.entry(id)
    return join(paths.models(), e.id, e.version)
  }

  /** Every file of the model is here at its roster size (checked once per run, then on changes). */
  async installed(id: string): Promise<boolean> {
    const cached = this.installedCache.get(id)
    if (cached !== undefined) return cached
    const l = this.legacy(id)
    if (l) {
      const dir = await legacyInstalledDir(paths.models(), l)
      if (dir) this.legacyDirs.set(id, dir)
      this.installedCache.set(id, dir !== null)
      return dir !== null
    }
    const e = this.entry(id)
    let ok = true
    for (const f of e.files) {
      const s = await stat(join(this.dir(id), f.name)).catch(() => null)
      if (!s || s.size !== f.bytes) ok = false
    }
    // The same files under the version an earlier release knew: moved, not downloaded again.
    if (!ok && (await carryOver(paths.models(), e).catch(() => false))) {
      ok = true
      log.info('model carried over from an earlier version', id, e.version)
    }
    this.installedCache.set(id, ok)
    return ok
  }

  async list(): Promise<ModelInfo[]> {
    const speeds = await this.speeds()
    // The retired ones people already have: listed to be removed, never offered.
    const retiring: ModelInfo[] = []
    for (const l of LEGACY_MODELS) {
      if (this.legacy(l.id) && (await this.installed(l.id)))
        retiring.push({
          speed: null,
          id: l.id,
          title: l.title,
          role: l.role,
          bytes: l.files.reduce((s, f) => s + f.bytes, 0),
          licence: l.licence.spdx,
          holder: l.licence.holder,
          caveat: l.caveat,
          installed: true,
          progress: null,
          retiring: true,
          replacedBy: l.replacedBy
        })
    }
    const shipped = await Promise.all(
      this.roster().map(async (e) => {
        const d = this.downloads.get(e.id)
        return {
          speed: speeds.get(e.id) ?? null,
          id: e.id,
          title: e.title,
          role: e.role,
          bytes: e.files.reduce((s, f) => s + f.bytes, 0),
          licence: e.licence.spdx,
          holder: e.licence.holder,
          caveat: e.caveat,
          installed: await this.installed(e.id),
          progress: d ? d.done / Math.max(1, d.total) : null,
          error: this.failed.get(e.id)
        }
      })
    )
    return [...shipped, ...retiring]
  }

  private speedCache: { at: number; speeds: Map<string, ModelSpeed | null> } | null = null

  /**
   * How long each model takes here, for one photo: from earlier runs, else
   * its reference time scaled by the speed test, else the reference alone.
   * Read again at most every few seconds (a download's progress lists the
   * models many times a second).
   */
  private async speeds(): Promise<Map<string, ModelSpeed | null>> {
    if (this.speedCache && Date.now() - this.speedCache.at < SPEED_CACHE_MS)
      return this.speedCache.speeds
    const read = async (key: string): Promise<Record<string, number>> => {
      const v: unknown = await this.settings.getSetting(key).catch(() => null)
      return v && typeof v === 'object' ? (v as Record<string, number>) : {}
    }
    const [denoise, enhance, info] = await Promise.all([
      read(DENOISE_RATE_KEY),
      read(ENHANCE_RATE_KEY),
      this.providerInfo()
    ])
    const m = info.measured
    const tested = m?.model ? this.roster().find((e) => e.id === m.model) : undefined
    const testMs = m ? (info.choice === 'cpu' ? m.cpuMs : (m.acceleratedMs ?? m.cpuMs)) : null
    const factor = tested ? testFactor(testMs, referenceOf(tested.measured)) : null
    const kindOf = new Map<string, EnhanceStepKind>(
      Object.entries(ENHANCE_MODEL).map(([k, id]) => [id, k as EnhanceStepKind])
    )
    const speeds = new Map<string, ModelSpeed | null>()
    for (const e of this.roster()) {
      const kind = kindOf.get(e.id)
      speeds.set(
        e.id,
        modelSpeed({
          reference: referenceOf(e.measured),
          learnedMsPerMp: denoise[e.id] ?? (kind ? enhance[kind] : null),
          guessMsPerMp: kind ? FIRST_GUESS_MS_PER_MP[kind] : null,
          factor
        })
      )
    }
    this.speedCache = { at: Date.now(), speeds }
    return speeds
  }

  private emit(): void {
    void this.list().then((models) => {
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.models.event, models)
    })
  }

  /** Download a model's files, resuming what an earlier try left, and check each. */
  async download(id: string): Promise<void> {
    // A retired model is kept for who has it, never fetched again.
    if (this.legacy(id)) return
    if (this.downloads.has(id) || (await this.installed(id))) return
    const e = this.entry(id)
    const dir = this.dir(id)
    await mkdir(dir, { recursive: true })
    const abort = new AbortController()
    const state = { abort, done: 0, total: e.files.reduce((s, f) => s + f.bytes, 0) }
    this.downloads.set(id, state)
    this.failed.delete(id)
    this.emit()
    let last = 0
    const tick = (): void => {
      const now = Date.now()
      if (now - last > 200) {
        last = now
        this.emit()
      }
    }
    try {
      for (const f of e.files) {
        const dest = join(dir, f.name)
        const have = await stat(dest).catch(() => null)
        if (have?.size === f.bytes && (await sha256(dest)) === f.sha256) {
          state.done += f.bytes
          continue
        }
        const before = state.done
        const onBytes = (n: number): void => {
          state.done += n
          tick()
        }
        const mirror = `${BASE}/${e.id}/${e.version}/${f.name}`
        try {
          await this.fetchFile(mirror, dest, f, abort.signal, onBytes)
        } catch (err) {
          if (abort.signal.aborted) throw err
          // The mirror is down or lacks the file: the roster's upstream copy
          // (Hugging Face, a GitHub release), checked the same way, stands in.
          const upstream = f.url
          if (!upstream) throw new Error(explain(err, mirror, f.name, true))
          log.info('model mirror unavailable, using upstream', f.name, explain(err, mirror, f.name))
          state.done = before
          try {
            await this.fetchFile(upstream, dest, f, abort.signal, onBytes)
          } catch (err2) {
            if (abort.signal.aborted) throw err2
            throw new Error(explain(err2, upstream, f.name))
          }
        }
      }
      this.installedCache.set(id, true)
      log.info('model installed', id)
    } catch (err) {
      if (!abort.signal.aborted) {
        const message = (err as Error).message
        this.failed.set(id, message)
        log.warn('model download failed', id, message)
      }
    } finally {
      this.downloads.delete(id)
      this.emit()
    }
  }

  cancel(id: string): void {
    this.downloads.get(id)?.abort.abort()
  }

  async remove(id: string): Promise<void> {
    this.cancel(id)
    await rm(join(paths.models(), id), { recursive: true, force: true })
    this.legacyDirs.delete(id)
    this.installedCache.set(id, false)
    this.failed.delete(id)
    this.emit()
  }

  /**
   * One file: into `<dest>.part` (appending to what an earlier try left),
   * then checked against the roster and moved into place.
   */
  private async fetchFile(
    url: string,
    dest: string,
    f: RosterFile,
    signal: AbortSignal,
    onBytes: (n: number) => void
  ): Promise<void> {
    const part = `${dest}.part`
    let from = (await stat(part).catch(() => null))?.size ?? 0
    if (from > f.bytes) {
      await rm(part, { force: true })
      from = 0
    }
    onBytes(from)
    const counter = new Transform({
      transform(chunk: Buffer, _enc, done) {
        onBytes(chunk.length)
        done(null, chunk)
      }
    })
    if (from === f.bytes) {
      // All of it came before (a quit during the check): checked below, not asked for again
      // (a range past the end is HTTP 416, every time).
    } else if (url.startsWith('file:')) {
      await pipeline(
        createReadStream(fileURLToPath(url), { start: from }),
        counter,
        createWriteStream(part, { flags: from ? 'a' : 'w' }),
        { signal }
      )
    } else {
      const res = await fetch(url, {
        headers: from ? { Range: `bytes=${from}-` } : {},
        signal
      })
      if (res.status === 416 && from > 0) {
        // What was kept is not a start of this file (it changed): from the beginning.
        await res.body?.cancel()
        await rm(part, { force: true })
        onBytes(-from)
        return this.fetchFile(url, dest, f, signal, onBytes)
      }
      if (!res.ok || !res.body) throw new Error(`${f.name}: HTTP ${res.status}`)
      // A server that ignores the range sends the whole file again.
      const append = from > 0 && res.status === 206
      if (from > 0 && !append) onBytes(-from)
      await pipeline(
        Readable.fromWeb(res.body as import('stream/web').ReadableStream),
        counter,
        createWriteStream(part, { flags: append ? 'a' : 'w' }),
        { signal }
      )
    }
    const got = await sha256(part)
    if (got !== f.sha256) {
      await rm(part, { force: true })
      throw new Error(`${f.name} arrived damaged (checksum mismatch); try again`)
    }
    await rename(part, dest)
  }

  // ── Running a model ────────────────────────────────────────────────────────

  /** The accelerator the bundled runtime offers, if any. */
  private accelerated(): ExecutionProvider | null {
    const providers = this.engineStatus().runtime?.providers ?? []
    if (providers.includes('coreml'))
      return {
        CoreMl: {
          units: 'All',
          format: 'MlProgram',
          static_shapes: false,
          low_precision_gpu: false
        }
      }
    if (providers.includes('directml')) return { DirectMl: { device: 0 } }
    return null
  }

  /** The provider models run on: the accelerator, unless the performance test chose the CPU. */
  async provider(): Promise<ExecutionProvider> {
    const choice: unknown = await this.settings.getSetting(PROVIDER_KEY).catch(() => null)
    return choice === 'cpu' ? 'Cpu' : (this.accelerated() ?? 'Cpu')
  }

  async setProvider(choice: 'cpu' | 'accelerated'): Promise<void> {
    await this.settings.setSetting(PROVIDER_KEY, choice)
  }

  /** The provider choice, the accelerator on offer and the last test's numbers. */
  async providerInfo(): Promise<ProviderInfo> {
    const choice: unknown = await this.settings.getSetting(PROVIDER_KEY).catch(() => null)
    const measured: unknown = await this.settings.getSetting(MEASURED_KEY).catch(() => null)
    const providers = this.engineStatus().runtime?.providers ?? []
    return {
      choice: choice === 'cpu' ? 'cpu' : 'accelerated',
      accelerator: providers.find((p) => p !== 'cpu') ?? null,
      ...(measured && typeof measured === 'object'
        ? { measured: measured as ProviderInfo['measured'] }
        : {})
    }
  }

  /**
   * Time the smallest downloaded model on the CPU and on the accelerator
   * (the engine's `benchmark`), and keep the faster: an accelerator that
   * will not load the model, or is slower, gives way to the CPU.
   */
  async benchmark(engine: EngineClient): Promise<ProviderInfo> {
    const order = ['u2netp', 'realesr-general-x4v3', 'real-esrgan-x2plus', 'u2net']
    let id: string | null = null
    for (const m of order) if (await this.installed(m)) id = id ?? m
    if (!id) throw new Error('Download a model first: U²-Netp is the smallest')
    if (engine.getStatus().status === 'starting') {
      engine.start()
      await engine.whenStarted()
    }
    const base = (await this.ref(id, 'Cpu')) as { model: Record<string, unknown>; input: unknown }
    const size = (legacyModel(id) ?? this.entry(id)).kind === 'segmenter' ? 320 : 256
    const feed = { Image: { input: base.input, width: size, height: size, conditioning: [] } }
    const accel = this.accelerated()
    const cases = [{ name: 'cpu', model: base.model, feed }]
    if (accel) cases.push({ name: 'accelerated', model: { ...base.model, provider: accel }, feed })
    const r = (await engine.benchmark({
      cases,
      repeats: 3,
      budgets: { max_load_ms: 120_000, max_run_ms: 120_000, max_memory_mb: 16_384 }
    })) as { cases: { name: string; error?: string | null; median_run_ms?: number | null }[] }
    const ms = (name: string): number | null => {
      const c = r.cases.find((x) => x.name === name)
      return c && !c.error && typeof c.median_run_ms === 'number' ? c.median_run_ms : null
    }
    const measured = { cpuMs: ms('cpu'), acceleratedMs: ms('accelerated'), model: id }
    this.speedCache = null
    const choice =
      measured.acceleratedMs !== null &&
      (measured.cpuMs === null || measured.acceleratedMs <= measured.cpuMs)
        ? 'accelerated'
        : 'cpu'
    await this.setProvider(choice)
    await this.settings.setSetting(MEASURED_KEY, measured)
    log.info('model providers timed', id, measured, choice)
    return this.providerInfo()
  }

  /** What `ref()` needs from the host besides the model's own numbers. */
  async host(
    provider?: ExecutionProvider,
    extra: Record<string, unknown> = {}
  ): Promise<Record<string, unknown>> {
    const runtime = this.engineStatus().runtime
    if (!runtime) throw new Error('this build of the engine ships no ONNX Runtime')
    const session: SessionSpec = {
      threads: BACKGROUND_THREADS * 2,
      optimisation: 'All',
      deterministic: false
    }
    return {
      runtime_library: runtime.library,
      provider: provider ?? (await this.provider()),
      session,
      ...extra
    }
  }

  /** A model's engine request type, its files and the host's values filled in. */
  async ref(
    id: string,
    provider?: ExecutionProvider,
    extra: Record<string, unknown> = {}
  ): Promise<Record<string, unknown>> {
    const l = this.legacy(id)
    if (l) {
      if (!(await this.installed(id))) throw new Error(`${l.title} is not downloaded`)
      return fillRef(l.ref, this.dir(id), await this.host(provider, extra))
    }
    const e = this.entry(id)
    if (!(await this.installed(id))) throw new ModelMissing(e)
    return pixlModels.ref(id, await this.host(provider, extra), { dir: this.dir(id) }) as Record<
      string,
      unknown
    >
  }

  /** Models the accelerator would not load this session: they run on the CPU. */
  private readonly cpuOnly = new Set<string>()

  /**
   * Run `make` with each of `ids` on the chosen provider, moving a model to
   * the CPU when the accelerator cannot load it (SCUNet and FBCNN under
   * CoreML: ONNX Runtime refuses them) — the one the error names, or all of
   * them when it names none (a provider that cannot be registered). Never
   * silently: each move is logged, and the model stays on the CPU for the
   * session. `make` is told which models to put on the CPU.
   */
  async withCpuFallback<T>(
    ids: string[],
    make: (onCpu: ReadonlySet<string>) => Promise<T>,
    signal: AbortSignal
  ): Promise<T> {
    const onCpu = new Set(
      (await this.provider()) === 'Cpu' ? ids : ids.filter((id) => this.cpuOnly.has(id))
    )
    for (;;) {
      try {
        return await make(onCpu)
      } catch (err) {
        const message = String((err as Error)?.message)
        if (signal.aborted || !/load-model|provider/i.test(message)) throw err
        const left = ids.filter((id) => !onCpu.has(id))
        if (left.length === 0) throw err
        const named = left.filter((id) => message.includes(`${id}/`))
        const moved = named.length > 0 ? named : left
        log.warn('models would not run on the accelerator; using the CPU', moved, message)
        for (const id of moved) {
          onCpu.add(id)
          this.cpuOnly.add(id)
        }
      }
    }
  }

  /** The licence texts shipped with the roster (for the notices). */
  licencesDir(): string {
    return join(pixlModels.dir, 'licences')
  }
}

/**
 * A failed download in words: no connection, a server that would not
 * answer, one without the file, or a damaged file. `only` when the model
 * has no other source than the mirror.
 */
function explain(err: unknown, url: string, file: string, only = false): string {
  const e = err as Error & { cause?: { code?: string } }
  const host = (() => {
    try {
      return new URL(url).host || 'the model folder'
    } catch {
      return url
    }
  })()
  const code = e.cause?.code ?? (e as { code?: string }).code
  let why: string
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') why = `${host} could not be found`
  else if (
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'UND_ERR_CONNECT_TIMEOUT'
  )
    why = `${host} did not answer`
  else if (code === 'ENOENT') why = `${file} is not in ${url.replace(/[^/]*$/, '')}`
  else if (/HTTP 40[34]/.test(e.message)) why = `${host} does not have ${file} yet`
  else why = e.message
  return only ? `${why} — this model is only on Playroom's model server` : why
}

async function sha256(file: string): Promise<string> {
  const h = createHash('sha256')
  await pipeline(createReadStream(file), h)
  return h.digest('hex')
}
