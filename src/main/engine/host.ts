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
  PixlEngineModule,
  PreviewFrame
} from '../../shared/engine-types'

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
    runtime: bundledRuntime(engine)
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

/** The window's end of the preview channel: frames go to it, not through main. */
let previews: MessagePortMain | undefined

/**
 * A preview frame's bytes sent to the window, and taken out of the report
 * main gets. Without a port (none yet, the window reloading) the report
 * keeps them and main relays them.
 */
function deliver(frame: string, result: unknown): void {
  const r = result as { output?: Uint8Array | null; width: number; height: number } | null
  if (!previews || !r?.output) return
  const msg: PreviewFrame = { frame, width: r.width, height: r.height, data: r.output }
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
