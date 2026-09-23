/**
 * The engine host. Runs inside an Electron utilityProcess so that a panic in
 * the native addon (rawler is known to panic on odd sensor layouts) kills
 * this process, not the app. The main-process side is `client.ts`.
 *
 * Playroom has no placeholder engine: every pixel on screen is the engine's.
 */
import { createRequire } from 'module'
import type {
  EngineErrorShape,
  EngineMethod,
  HostToMain,
  MainToHost,
  PixlEngineModule
} from '../../shared/engine-types'

const ENGINE_PACKAGE = '@xuckless/pixl-engine'
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

function loadNative(): { engine: PixlEngineModule } | { reason: string } {
  try {
    const require = createRequire(__filename)
    const mod = require(ENGINE_PACKAGE) as Partial<PixlEngineModule>
    const missing = METHODS.filter((m) => typeof mod[m] !== 'function')
    if (missing.length > 0) {
      return { reason: `${ENGINE_PACKAGE} loaded but lacks: ${missing.join(', ')}` }
    }
    if (typeof mod.hasEnhance !== 'function') mod.hasEnhance = () => false
    return { engine: mod as PixlEngineModule }
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    const where = `${process.platform}-${process.arch}`
    if (e.code === 'MODULE_NOT_FOUND') {
      return { reason: `${ENGINE_PACKAGE} is not installed for ${where}` }
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

const loaded = loadNative()
const engine = 'engine' in loaded ? loaded.engine : undefined

if (engine) {
  send({
    kind: 'hello',
    status: 'ready',
    version: engine.engineVersion(),
    enhance: engine.hasEnhance()
  })
} else {
  send({ kind: 'hello', status: 'unavailable', reason: 'reason' in loaded ? loaded.reason : '' })
}

process.parentPort.on('message', (e) => {
  const msg = e.data as MainToHost
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
  Promise.resolve()
    .then(() => fn.apply(engine, args))
    .then(
      (result) => send({ kind: 'response', id, ok: true, result }),
      (err) => send({ kind: 'response', id, ok: false, error: toErrorShape(err) })
    )
})
