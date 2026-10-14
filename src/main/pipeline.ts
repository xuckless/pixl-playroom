/**
 * What today's pipeline has on this computer (shared/rebuild.ts `Pipeline`):
 * the PIXL demosaic offered and switched on, PIXL Enhance offered (a
 * development kit's roster). Set once the model store and the switches are
 * up (app.ts); before that, and in a build without them, neither.
 */
import type { Pipeline } from '../shared/rebuild'

let read: () => Promise<Pipeline> = async () => ({ pixlDemosaic: false, pixlEnhance: false })

export function setPipeline(fn: () => Promise<Pipeline>): void {
  read = fn
}

export function pipeline(): Promise<Pipeline> {
  return read().catch(() => ({ pixlDemosaic: false, pixlEnhance: false }))
}
