/**
 * The AI switches as main keeps them (shared/heavy.ts): the killswitch and
 * the heavy models' switches, each heavy one on only with a passing
 * benchmark made on this computer. Kept in the index's settings.
 */
import { t } from '../../shared/i18n'
import { BrowserWindow } from 'electron'
import { cpus, totalmem } from 'os'
import type { IndexClient } from '../indexer/client'
import { IPC } from '../../shared/ipc'
import {
  benchmarkHolds,
  heavyAllowed,
  machineKey,
  readSwitches,
  type AiSwitches,
  type HeavyBenchmark,
  type HeavyModel
} from '../../shared/heavy'

const KEY = 'ai.switches'

let current: AiSwitchStore | null = null

/** Whether a heavy model may run (for code that doesn't hold the store); false before it is up. */
export async function heavyAllowedNow(model: HeavyModel): Promise<boolean> {
  return current ? current.allowed(model) : false
}

/** The store `heavyAllowedNow` reads (app.ts, once it is made). */
export function setSwitchStore(s: AiSwitchStore): void {
  current = s
}

export class AiSwitchStore {
  private cached: AiSwitches | null = null
  private readonly listeners = new Set<(s: AiSwitches) => void>()
  /** This computer, as a benchmark names it. */
  readonly machine = machineKey(cpus()[0]?.model ?? 'unknown', totalmem() / 1048576)

  constructor(private readonly settings: IndexClient) {}

  async get(): Promise<AiSwitches> {
    if (this.cached) return this.cached
    const v: unknown = await this.settings.getSetting(KEY).catch(() => null)
    this.cached = readSwitches(v)
    return this.cached
  }

  /** AI models may run (the killswitch is not thrown). */
  async enabled(): Promise<boolean> {
    return (await this.get()).enabled
  }

  /** A heavy model may run now. */
  async allowed(model: HeavyModel): Promise<boolean> {
    return heavyAllowed(await this.get(), model, this.machine)
  }

  async setEnabled(on: boolean): Promise<AiSwitches> {
    return this.save({ ...(await this.get()), enabled: on })
  }

  /** Turn a heavy model on (only with a passing benchmark from this computer) or off. */
  async setHeavy(model: HeavyModel, on: boolean): Promise<AiSwitches> {
    const s = await this.get()
    const h = s.heavy[model]
    if (on && !benchmarkHolds(h.benchmark, this.machine))
      throw new Error(t('Run the benchmark first: it has to pass on this computer'))
    return this.save({ ...s, heavy: { ...s.heavy, [model]: { ...h, on } } })
  }

  /** A benchmark's result kept; one that failed turns the model off. */
  async recordBenchmark(b: HeavyBenchmark): Promise<AiSwitches> {
    const s = await this.get()
    const h = s.heavy[b.model]
    return this.save({
      ...s,
      heavy: { ...s.heavy, [b.model]: { on: b.passed ? h.on : false, benchmark: b } }
    })
  }

  onChange(fn: (s: AiSwitches) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private async save(s: AiSwitches): Promise<AiSwitches> {
    this.cached = s
    await this.settings.setSetting(KEY, s)
    for (const l of this.listeners) l(s)
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.ai.switchesEvent, s)
    return s
  }
}
