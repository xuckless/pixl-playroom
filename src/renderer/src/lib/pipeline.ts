/**
 * What today's pipeline has on this computer (shared/rebuild.ts `Pipeline`),
 * as main says it: read once, and again when the AI switches change (the
 * PIXL demosaic's is one). The library's "Older develop" badge and the
 * rebuild prompt read it.
 */
import { create } from 'zustand'
import type { Pipeline } from '../../../shared/rebuild'
import { api } from './api'

export const usePipeline = create<Pipeline>(() => ({ pixlDemosaic: false, pixlEnhance: false }))

function read(): void {
  void api.ai.pipeline().then(
    (p) => usePipeline.setState(p),
    () => undefined
  )
}

/** Start reading it (App's mount): now, and as the switches change. */
export function watchPipeline(): () => void {
  read()
  return api.ai.onSwitches(() => read())
}

/** Rebuild these photos with the latest develop (main/rebuild.ts), as background jobs. */
export async function rebuild(keys: string[]): Promise<void> {
  for (const key of keys) await api.ai.start({ task: 'rebuild', key })
}
