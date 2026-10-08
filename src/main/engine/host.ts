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
  HostToMain,
  MainToHost,
  ModelSession,
  PixlEngineModule,
  PreviewFrame,
  PromptEmbedding,
  SamOp,
  SamResult
} from '../../shared/engine-types'
import { pickBySize } from '../../shared/concepts'

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

const loaded = loadNative()
const engine = 'engine' in loaded ? loaded.engine : undefined

if (engine) {
  send({
    kind: 'hello',
    status: 'ready',
    version: engine.engineVersion(),
    enhance: engine.hasEnhance(),
    runtime: bundledRuntime(engine),
    prompt: typeof engine.segmentPrompt === 'function'
  })
} else {
  send({
    kind: 'hello',
    status: 'unavailable',
    reason: 'reason' in loaded ? loaded.reason : '',
    code: 'code' in loaded ? loaded.code : undefined
  })
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
      const obj = await e.loadModelSession(call.ref)
      samSessions.set(call.session, { ref, obj })
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
      return { op: 'release' }
    }
  }
}

/** The window's end of the preview channel: frames go to it, not through main. */
let previews: MessagePortMain | undefined

/**
 * A preview frame's bytes sent to the window, and taken out of the report
 * main gets. Without a port (none yet, the window reloading) the report
 * keeps them and main relays them.
 */
function deliver(frame: string, result: unknown): void {
  const r = result as {
    output?: Uint8Array | null
    width: number
    height: number
    companion?: { width: number; height: number; data: Uint8Array } | null
  } | null
  if (!previews || !r?.output) return
  // Four bytes a pixel is RGBA U8; eight is RGBA half floats (Full HDR).
  const f16 = r.output.byteLength === r.width * r.height * 8
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
  // A signal goes after the request; the engine checks it between stages.
  let callArgs = args
  if (msg.cancellable) {
    const abort = new AbortController()
    aborts.set(id, abort)
    callArgs = [...args, { signal: abort.signal }]
  }
  const frame = msg.frame
  Promise.resolve()
    .then(() => fn.apply(engine, callArgs))
    .then(
      (result) => {
        if (frame) deliver(frame, result)
        send({ kind: 'response', id, ok: true, result })
      },
      (err) => send({ kind: 'response', id, ok: false, error: toErrorShape(err) })
    )
    .finally(() => aborts.delete(id))
})
