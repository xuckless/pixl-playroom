/**
 * pixl-auto (engine 0.19's orchestrator), where it is installed. It is not a
 * dependency of this release: until the engine publishes it, it comes from
 * the private engine repo (`pnpm add github:xuckless/pixl-engine#v0.19.1&path:/bindings/auto`),
 * which CI can't read, and Gemma, its one user here, is held out of
 * 0.4.0-beta. Without it Gemma reads as not part of this version.
 *
 * The few parts Playroom uses, typed here (the package isn't there to type
 * them against).
 */
import { createRequire } from 'module'
import log from 'electron-log/main'

export type Pin = { name: string; bytes: number; sha256: string }

export interface Pins {
  brains: {
    id: string
    licence: string
    source: { repo: string; commit: string }
    files: { model: Pin; mmproj: Pin }
  }[]
  runtimes: {
    id: string
    licence: string
    source: { repo: string; tag: string }
    binary: Record<string, string>
    platforms: Record<string, Pin>
  }[]
}

export interface LocalServer {
  url: string
  pid: number
  close(): Promise<unknown>
}

/** The assistant over its server (the naming call reaches past it: brain.ts). */
export type LocalServerBrain = object

export interface PixlAuto {
  pins: Pins
  brainUrl(brain: string, file: 'model' | 'mmproj'): string
  runtimeUrl(runtime: string, platform: string): string
  startLocalServer(options: Record<string, unknown>): Promise<LocalServer>
  LocalServerBrain: new (options: Record<string, unknown>) => LocalServerBrain
  workersForPrompt(): string
  planSchema(options: { auto: boolean }): unknown
  checkPlan(plan: unknown): unknown
  /** The system text (from `brain/local-server`: the package's root doesn't export it in 0.19). */
  SYSTEM: string
}

let loaded: PixlAuto | null | undefined

/** pixl-auto, or null where it isn't installed. */
export function pixlAuto(): PixlAuto | null {
  if (loaded !== undefined) return loaded
  try {
    const req = createRequire(__filename)
    const root = req('@xuckless/pixl-auto') as Omit<PixlAuto, 'SYSTEM'>
    const { SYSTEM } = req('@xuckless/pixl-auto/brain/local-server') as { SYSTEM: string }
    loaded = { ...root, SYSTEM }
  } catch {
    log.info('pixl-auto is not installed: Gemma is not part of this build')
    loaded = null
  }
  return loaded
}
