/**
 * The engine host. Runs inside an Electron utilityProcess so that a crash in
 * the native addon (or a library beside it: LibRaw parses untrusted files)
 * kills this process, not the app. The main-process side is `client.ts`.
 *
 * Playroom has no placeholder engine: every pixel on screen is the engine's.
 */
import { createRequire } from 'module'
import type { MessagePortMain } from 'electron'
import type {
  EngineErrorShape,
  EngineHelloMessage,
  EngineMethod,
  GpuFrame,
  GpuOp,
  GpuResult,
  GpuSession,
  HeldMeasurements,
  HeldRef,
  HostToMain,
  MainToHost,
  ModelSession,
  NativeRefs,
  PixlEngineModule,
  PreviewFrame,
  PromptEmbedding,
  SamOp,
  SamResult
} from '../../shared/engine-types'
import { pickBySize } from '../../shared/concepts'
import { toRgba } from '../../shared/gpudrag'
import { sdrCompanion } from '../../shared/sdrcompanion'
import { progressOf } from './progress'
import { withRequiredFields } from './required'

const ENGINE_PACKAGE = '@xuckless/pixl-engine'
/** What Playroom cannot run without. The rest (lens, upright, AI…) are looked up per call. */
const METHODS: EngineMethod[] = ['engineVersion', 'probe', 'convert', 'analyze', 'suggestEncode']

function send(msg: HostToMain): void {
  process.parentPort.postMessage(msg)
}

/** Every message in an error's `cause` chain, outermost first. */
function causeChain(err: unknown, depth = 0): string[] {
  if (!(err instanceof Error) || depth > 6) return []
  const { cause } = err as Error & { cause?: unknown }
  const causes = Array.isArray(cause) ? cause : cause === undefined ? [] : [cause]
  return causes.flatMap((c) => {
    const message = c instanceof Error ? c.message : String(c)
    return [message, ...causeChain(c, depth + 1)]
  })
}

function loadNative(): { engine: PixlEngineModule } | { reason: string; code?: string } {
  try {
    const require = createRequire(__filename)
    const mod = require(ENGINE_PACKAGE) as Partial<PixlEngineModule>
    const missing = METHODS.filter((m) => typeof mod[m] !== 'function')
    if (missing.length > 0) {
      return { reason: `${ENGINE_PACKAGE} loaded but lacks: ${missing.join(', ')}` }
    }
    if (typeof mod.hasEnhance !== 'function') mod.hasEnhance = () => false
    if (typeof mod.bindingVersion !== 'function') mod.bindingVersion = mod.engineVersion
    return { engine: mod as PixlEngineModule }
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    const where = `${process.platform}-${process.arch}`
    if (e.code === 'MODULE_NOT_FOUND') {
      return { reason: `${ENGINE_PACKAGE} is not installed for ${where}` }
    }
    // The binding refuses an addon that is not its own release (a stale local
    // build, a platform package from another version); its message names both.
    if (e.code === 'VersionMismatch') {
      return { reason: `version mismatch on ${where}: ${e.message}`, code: e.code }
    }
    const detail = causeChain(e)
    return {
      reason:
        `${ENGINE_PACKAGE} failed to load on ${where}: ${e.message}` +
        (detail.length > 0 ? ` (${detail.join('; ')})` : '')
    }
  }
}

function toErrorShape(err: unknown): EngineErrorShape {
  if (err && typeof err === 'object') {
    const e = err as { message?: unknown; code?: unknown; detail?: unknown }
    return {
      message: typeof e.message === 'string' ? e.message : String(err),
      code: typeof e.code === 'string' ? e.code : 'Unknown',
      detail:
        e.detail && typeof e.detail === 'object'
          ? (e.detail as EngineErrorShape['detail'])
          : undefined
    }
  }
  return { message: String(err), code: 'Unknown' }
}

/** The ONNX Runtime shipped beside the addon, if this build carries one. */
function bundledRuntime(e: PixlEngineModule): EngineHelloMessage['runtime'] {
  try {
    return typeof e.bundledRuntime === 'function' ? e.bundledRuntime() : undefined
  } catch {
    return undefined
  }
}

/** Whether the addon has the GPU grade path (0.19.2; built for macOS and Windows only). */
function hasGpu(e: PixlEngineModule): boolean {
  try {
    return (
      typeof e.hasGpu === 'function' &&
      typeof e.openGpuSession === 'function' &&
      typeof e.uploadGpuFrame === 'function' &&
      e.hasGpu() === true
    )
  } catch {
    return false
  }
}

const loaded = loadNative()
const engine = 'engine' in loaded ? loaded.engine : undefined

if (engine) {
  send({
    kind: 'hello',
    status: 'ready',
    version: engine.engineVersion(),
    enhance: engine.hasEnhance(),
    runtime: bundledRuntime(engine),
    prompt: typeof engine.segmentPrompt === 'function',
    gpu: hasGpu(engine)
  })
} else {
  send({
    kind: 'hello',
    status: 'unavailable',
    reason: 'reason' in loaded ? loaded.reason : '',
    code: 'code' in loaded ? loaded.code : undefined
  })
}

/**
 * A report's held measurements (0.19.2, Phase A §4.4) are a native handle
 * that can't cross to main: only their `fields` are sent on. A drag asks
 * for them to be kept here (`keepHeld`), named by main, so its next frame
 * reuses the measurement instead of redoing it; a render given `held`
 * returns that same object, which stays where it is. Any other is closed.
 */
function stripHeld(result: unknown, native?: NativeRefs): void {
  const r = result as { held?: HeldMeasurements | HeldRef | null } | null
  if (!r || typeof r !== 'object' || !r.held || !('close' in r.held)) return
  const made = r.held as HeldMeasurements
  const fields = Array.isArray(made.fields) ? [...made.fields] : []
  const given = native?.held ? helds.get(native.held) : undefined
  let id: string | undefined
  if (native?.keepHeld) {
    const had = helds.get(native.keepHeld)
    if (had && had !== made) had.close()
    helds.set(native.keepHeld, made)
    id = native.keepHeld
  } else if (given === made) {
    id = native?.held
  } else {
    made.close()
  }
  r.held = id ? { fields, id } : { fields }
}

/** The calls that may still be stopped, by request id. */
const aborts = new Map<number, AbortController>()

// ── SAM 2.1: native objects kept here, named by main ─────────────────────────
// A loaded model, an embedding and a decode's logits live in this process's
// memory (V8 does not see them: closed as soon as they are let go).

/** Loaded models, by main's name for them, with the ref each was loaded from. */
const samSessions = new Map<string, { ref: string; obj: ModelSession }>()
/** Embeddings, oldest first (a decode moves its own to the end). */
const embeddings = new Map<string, PromptEmbedding>()
/** How many embeddings are kept (each tens of megabytes). */
const KEEP_EMBEDDINGS = 3
/** Each selection's last answer, fed to its next decode. */
const lanes = new Map<string, Float32Array>()
/** SAM 3's embedding of the last frame a phrase was found on (one: each is large). */
let concept: { key: string; emb: PromptEmbedding } | null = null

/** An object main named that is not here (this host started after it was made). */
function stale(what: string): Error & { code: string } {
  return Object.assign(new Error(`${what} is not loaded in this engine`), { code: 'Stale' })
}

function session(name: string): ModelSession {
  const s = samSessions.get(name)
  if (!s || s.obj.closed) throw stale(`model ${name}`)
  return s.obj
}

async function sam(e: PixlEngineModule, call: SamOp, signal?: AbortSignal): Promise<SamResult> {
  switch (call.op) {
    case 'load': {
      const ref = JSON.stringify(call.ref)
      const had = samSessions.get(call.session)
      if (had && had.ref === ref && !had.obj.closed) return { op: 'load', loadMs: 0 }
      had?.obj.close()
      samSessions.delete(call.session)
      // 0.21.0 (OBS-5): a load still queued, or between its steps, stops
      // with the job; a CoreML compile under way runs to its end first.
      const obj = await e.loadModelSession(call.ref, signal ? { signal } : undefined)
      samSessions.set(call.session, { ref, obj })
      // OBS-4: whether the compile was made before (the cache) or just now.
      if (obj.coremlCache)
        console.log(
          `CoreML ${obj.coremlCache.existed ? 'cache used' : 'compiled and cached'} for ${call.session}`,
          `(hashed in ${obj.coremlCache.hash_ms} ms)`
        )
      return { op: 'load', loadMs: obj.loadMs }
    }
    case 'embed': {
      const s = session(call.session)
      // The session's own ref, so the engine's exact match holds.
      const request = { ...call.request, encoder: { ...call.request.encoder, model: s.model } }
      const made = await e.promptEmbedding(request, { sessions: [s], signal })
      embeddings.get(call.id)?.close()
      embeddings.delete(call.id)
      embeddings.set(call.id, made)
      while (embeddings.size > KEEP_EMBEDDINGS) {
        const [id, old] = embeddings.entries().next().value as [string, PromptEmbedding]
        old.close()
        embeddings.delete(id)
      }
      const report = (made as PromptEmbedding & { report?: { model_ms?: number } | null }).report
      return { op: 'embed', provenance: made.provenance, modelMs: report?.model_ms ?? null }
    }
    case 'decode': {
      const emb = embeddings.get(call.embedding)
      if (!emb || emb.closed) throw stale(`embedding ${call.embedding}`)
      embeddings.delete(call.embedding)
      embeddings.set(call.embedding, emb)
      const s = session(call.session)
      const maskInput = call.maskInput ? lanes.get(call.lane) : undefined
      const request = { ...call.request, decoder: { ...call.request.decoder, model: s.model } }
      const r = await e.segmentPrompt(request, {
        embedding: emb,
        sessions: [s],
        signal,
        ...(maskInput ? { maskInput } : {})
      })
      // A class's answer chosen by size; else the decoder's own choice.
      const i = call.pick
        ? pickBySize(
            call.pick,
            r.planes.map((p) => p.coverage),
            r.planes.map((p) => p.predicted_iou)
          )
        : 0
      const kept = i >= 0 && r.planes[i] ? [r.planes[i]] : []
      if (call.keep && kept[0]) lanes.set(call.lane, kept[0].logits)
      return {
        op: 'decode',
        planes: (call.pick ? kept : r.planes).map((p) => ({
          png: p.png,
          predicted_iou: p.predicted_iou,
          coverage: p.coverage,
          bounds: p.bounds
        })),
        plane_width: r.plane_width,
        plane_height: r.plane_height,
        model_ms: r.model_ms
      }
    }
    case 'concept': {
      if (typeof e.segmentConcept !== 'function')
        throw Object.assign(new Error('this engine has no phrase segmentation'), {
          code: 'EngineUnavailable'
        })
      let reused = true
      let embedMs = 0
      if (!concept || concept.key !== call.key || concept.emb.closed) {
        concept?.emb.close()
        concept = null
        reused = false
        const t0 = Date.now()
        // No session: the image encoder is loaded for this call and let go
        // after it, before the text encoder loads (SAM 3's float32 compute).
        const emb = await e.promptEmbedding(call.embed, { signal })
        embedMs = Date.now() - t0
        concept = { key: call.key, emb }
      }
      const t1 = Date.now()
      const r = await e.segmentConcept(call.request, { embedding: concept.emb, signal })
      return {
        op: 'concept',
        instances: r.instances.map((i) => ({
          png: i.png,
          score: i.score,
          coverage: i.coverage,
          rect: i.rect
        })),
        presence: r.presence,
        reused,
        embedMs,
        conceptMs: Date.now() - t1
      }
    }
    case 'release': {
      for (const id of call.embeddings ?? []) {
        embeddings.get(id)?.close()
        embeddings.delete(id)
      }
      for (const id of call.lanes ?? []) lanes.delete(id)
      for (const name of call.sessions ?? []) {
        samSessions.get(name)?.obj.close()
        samSessions.delete(name)
      }
      if (call.embeddings?.includes('concept')) {
        concept?.emb.close()
        concept = null
      }
      return { op: 'release' }
    }
  }
}

// ── The GPU drag path: native objects kept here, named by main ──────────────
// Phase A §4.3: one GPU session per app, a frame per open photo, and §4.4's
// held measurements. None can cross IPC, so they live in this process (as
// SAM's sessions do) and main names them by id. A host that dies takes them
// with it; main hears the new host (`onSpawn`) and starts over.

/** The app's GPU session, once opened. */
let gpu: GpuSession | null = null
/** Each open photo's uploaded grade input, by main's id for it. */
const frames = new Map<string, GpuFrame>()
/** Held measurements a drag asked to keep, by main's id for them. */
const helds = new Map<string, HeldMeasurements>()

function noGpu(): Error & { code: string } {
  return Object.assign(new Error('this engine has no GPU grade path'), {
    code: 'EngineUnavailable'
  })
}

function closeFrame(id: string): void {
  const f = frames.get(id)
  if (f && !f.closed) f.close()
  frames.delete(id)
}

async function gpuCall(e: PixlEngineModule, call: GpuOp, signal?: AbortSignal): Promise<GpuResult> {
  switch (call.op) {
    case 'open': {
      if (gpu && !gpu.closed) return { op: 'open', ms: 0 }
      if (!hasGpu(e)) throw noGpu()
      const t0 = Date.now()
      gpu = await e.openGpuSession!(call.spec)
      return { op: 'open', ms: Date.now() - t0 }
    }
    case 'upload': {
      if (!gpu || gpu.closed) throw stale('the GPU session')
      // The 8 GB M1: one frame open at a time (131–175 MB each, freed on close).
      if (call.only) for (const id of [...frames.keys()]) if (id !== call.id) closeFrame(id)
      const t0 = Date.now()
      const input = await e.convert({ ...call.request, grade_device: 'Cpu' }, { signal })
      const renderMs = Date.now() - t0
      const bytes = input.output
      if (!bytes)
        throw Object.assign(new Error('the grade input came back empty'), { code: 'Invariant' })
      // `report.pixels` says what the bytes are (§4.3); the report's own size otherwise.
      const width = input.pixels?.width ?? input.width
      const height = input.pixels?.height ?? input.height
      const alpha = (input.pixels?.channels ?? input.channels) === 4
      const t1 = Date.now()
      const frame = await e.uploadGpuFrame!(gpu, { width, height, sample: 'F16', alpha }, bytes)
      // Only once the new one is up: a failed upload leaves the photo's old frame.
      closeFrame(call.id)
      frames.set(call.id, frame)
      return { op: 'upload', width, height, alpha, renderMs, uploadMs: Date.now() - t1 }
    }
    case 'release': {
      for (const id of call.frames ?? []) closeFrame(id)
      for (const id of call.held ?? []) {
        const h = helds.get(id)
        if (h && !h.closed) h.close()
        helds.delete(id)
      }
      if (call.session) {
        for (const id of [...frames.keys()]) closeFrame(id)
        if (gpu && !gpu.closed) gpu.close()
        gpu = null
      }
      return { op: 'release' }
    }
  }
}

/**
 * A call's native options from main's names for them: the GPU session and
 * the photo's frame for a GPU drag, the held measurements for a drag or
 * `regionReach`. One that is not here (closed, or this host is newer than
 * the name) is `Stale`, which main reads as "upload again" or "measure
 * again", never as the user's error.
 */
function nativeOptions(native: NativeRefs | undefined): Record<string, unknown> {
  if (!native) return {}
  const out: Record<string, unknown> = {}
  if (native.frame) {
    const frame = frames.get(native.frame)
    if (!gpu || gpu.closed || !frame || frame.closed) throw stale(`GPU frame ${native.frame}`)
    out['gpu'] = gpu
    out['frame'] = frame
  }
  if (native.held) {
    const held = helds.get(native.held)
    if (!held || held.closed) throw stale(`held measurements ${native.held}`)
    out['held'] = held
  }
  return out
}

/** The window's end of the preview channel: frames go to it, not through main. */
let previews: MessagePortMain | undefined

/**
 * A preview frame's bytes sent to the window, and taken out of the report
 * main gets. Without a port (none yet, the window reloading) the report
 * keeps them and main relays them.
 */
function deliver(frame: string, result: unknown, companionEdge?: number): void {
  const r = result as {
    output?: Uint8Array | null
    width: number
    height: number
    companion?: { width: number; height: number; data: Uint8Array } | null
  } | null
  if (!r?.output) return
  // A GPU drag of an opaque photo is RGB (it names no channels): RGBA, as
  // the window and main's relay both take a frame.
  r.output = toRgba(r.output, r.width, r.height)
  if (r.companion)
    r.companion.data = toRgba(r.companion.data, r.companion.width, r.companion.height)
  // Four bytes a pixel is RGBA U8; eight is RGBA half floats (Full HDR, or an SDR picture in float).
  const f16 = r.output.byteLength === r.width * r.height * 8
  // An SDR picture in float: its companion made here (main's relay takes it too).
  if (f16 && !r.companion && companionEdge)
    r.companion = sdrCompanion(r.output, r.width, r.height, companionEdge)
  if (!previews) return
  const msg: PreviewFrame = {
    frame,
    width: r.width,
    height: r.height,
    data: r.output,
    sample: f16 ? 'F16' : 'U8',
    ...(r.companion
      ? {
          companion: {
            width: r.companion.width,
            height: r.companion.height,
            data: r.companion.data
          }
        }
      : {})
  }
  previews.postMessage(msg)
  r.output = null
}

process.parentPort.on('message', (e) => {
  const msg = e.data as MainToHost
  if (msg?.kind === 'port') {
    previews?.close()
    previews = e.ports[0]
    previews?.start()
    return
  }
  if (msg?.kind === 'cancel') {
    aborts.get(msg.id)?.abort()
    return
  }
  if (msg?.kind === 'sam') {
    const { id } = msg
    if (!engine || typeof engine.segmentPrompt !== 'function') {
      send({
        kind: 'response',
        id,
        ok: false,
        error: { message: 'this engine has no prompted segmentation', code: 'EngineUnavailable' }
      })
      return
    }
    let signal: AbortSignal | undefined
    if (msg.cancellable) {
      const abort = new AbortController()
      aborts.set(id, abort)
      signal = abort.signal
    }
    sam(engine, msg.call, signal)
      .then(
        (result) => send({ kind: 'response', id, ok: true, result }),
        (err) => send({ kind: 'response', id, ok: false, error: toErrorShape(err) })
      )
      .finally(() => aborts.delete(id))
    return
  }
  if (msg?.kind === 'gpu') {
    const { id } = msg
    if (!engine) {
      send({
        kind: 'response',
        id,
        ok: false,
        error: { message: 'engine unavailable', code: 'EngineUnavailable' }
      })
      return
    }
    let signal: AbortSignal | undefined
    if (msg.cancellable) {
      const abort = new AbortController()
      aborts.set(id, abort)
      signal = abort.signal
    }
    gpuCall(engine, msg.call, signal)
      .then(
        (result) => send({ kind: 'response', id, ok: true, result }),
        (err) => send({ kind: 'response', id, ok: false, error: toErrorShape(err) })
      )
      .finally(() => aborts.delete(id))
    return
  }
  if (!msg || msg.kind !== 'request') return
  const { id, method, args } = msg
  if (!engine) {
    send({
      kind: 'response',
      id,
      ok: false,
      error: { message: 'engine unavailable', code: 'EngineUnavailable' }
    })
    return
  }
  const fn = engine[method] as ((...a: unknown[]) => unknown) | undefined
  if (typeof fn !== 'function') {
    send({
      kind: 'response',
      id,
      ok: false,
      error: { message: `unknown engine method ${String(method)}`, code: 'BadRequest' }
    })
    return
  }
  // A signal goes after the request (the engine checks it between stages),
  // in one options object with any native objects main named (`NativeRefs`).
  const callArgs = withRequiredFields(method, args)
  const { native } = msg
  let options: Record<string, unknown> = {}
  if (msg.cancellable) {
    const abort = new AbortController()
    aborts.set(id, abort)
    options = { signal: abort.signal }
  }
  // With both, aborting the signal cancels the token too.
  const counting = msg.progress ? progressOf(engine, id, send) : null
  if (counting) options = { ...options, token: counting.token }
  const frame = msg.frame
  Promise.resolve()
    .then(() => {
      options = { ...options, ...nativeOptions(native) }
      const all = Object.keys(options).length > 0 ? [...callArgs, options] : callArgs
      return fn.apply(engine, all)
    })
    .then(
      (result) => {
        // A render made only for its measurements: its pixels stay here.
        if (native?.discardOutput && result && typeof result === 'object')
          (result as { output?: unknown }).output = null
        else if (frame) deliver(frame, result, native?.sdrCompanion)
        stripHeld(result, native)
        send({ kind: 'response', id, ok: true, result })
      },
      (err) => send({ kind: 'response', id, ok: false, error: toErrorShape(err) })
    )
    .finally(() => {
      counting?.stop()
      aborts.delete(id)
    })
})
