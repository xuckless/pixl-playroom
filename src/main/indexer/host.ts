/**
 * The index host: the SQLite index and every sidecar read and write, in an
 * Electron utilityProcess (as VS Code keeps its shared process), so a big
 * folder scan or a batch edit never holds up the main process's IPC. The
 * main-process side is `client.ts`; the work itself is `service.ts`.
 *
 * `--user-data <dir>` says where the index lives; `--prune` (first start
 * only) clears painted planes nothing refers to before any request.
 */
import type { HostToMain, MainToHost } from './protocol'
import { IndexService } from './service'

function send(msg: HostToMain): void {
  process.parentPort.postMessage(msg)
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const userData = arg('--user-data')
if (!userData) throw new Error('index host: --user-data is required')

const service = new IndexService({
  userData,
  emit: (event) => send({ kind: 'event', ...event })
})

if (process.argv.includes('--prune')) {
  try {
    const removed = service.prunePlanes()
    if (removed > 0) console.log(`pruned ${removed} unused painted planes`)
  } catch (err) {
    console.warn('pruning planes failed', err)
  }
}

send({ kind: 'hello' })

process.parentPort.on('message', (e) => {
  const msg = e.data as MainToHost
  if (!msg || msg.kind !== 'request') return
  const { id, method, args } = msg
  const fn = (service as unknown as Record<string, unknown>)[method]
  if (typeof fn !== 'function' || method === 'constructor') {
    send({
      kind: 'response',
      id,
      ok: false,
      error: { message: `unknown index method ${method}`, code: 'BadRequest' }
    })
    return
  }
  // Sync methods finish here, before the next message is read: that order
  // is what the main process relies on.
  let result: unknown
  try {
    result = (fn as (...a: unknown[]) => unknown).apply(service, args)
  } catch (err) {
    send({ kind: 'response', id, ok: false, error: errorShape(err) })
    return
  }
  if (method === 'close') {
    send({ kind: 'response', id, ok: true, result: null })
    setImmediate(() => process.exit(0))
    return
  }
  if (result instanceof Promise) {
    result.then(
      (value) => send({ kind: 'response', id, ok: true, result: value }),
      (err) => send({ kind: 'response', id, ok: false, error: errorShape(err) })
    )
  } else {
    send({ kind: 'response', id, ok: true, result })
  }
})

function errorShape(err: unknown): { message: string; code: string } {
  return {
    message: err instanceof Error ? err.message : String(err),
    code:
      (err as { code?: unknown })?.code === undefined
        ? 'Error'
        : String((err as { code: unknown }).code)
  }
}
