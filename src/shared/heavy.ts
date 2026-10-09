/**
 * The heavy models (the owner, 2026-10-08): Gemma, the local assistant, and
 * SAM 3, the best Find by name. Each is off until the user turns it on, and
 * turning it on runs a sustained-load benchmark first: the same work back
 * to back for about a minute on this computer. A computer that can't keep
 * it up (too slow a run, a run that slows as it heats, too little memory
 * for the model beside everything else) isn't let turn it on.
 *
 * The killswitch ("Use AI models", on unless turned off) is separate: off,
 * no AI model runs at all, the heavy ones included; a RAW's develop keeps
 * its models (DemosaicNet, PMRID), which aren't a tool the user runs.
 *
 * Pure, for tests/heavy.test.ts.
 */

import { t, tk } from './i18n'

/**
 * Gemma (and the llama.cpp server it runs in) is not shipped in 0.4.0-beta
 * (the owner, 2026-10-09): a packaged build offers no download, no switch,
 * no naming. An unpackaged build (development) has all of it, so the work
 * goes on. SAM 3 is held the same way (shared/ai.ts `SAM3_PHRASE`).
 */
export const GEMMA_SHIPS = false

/** Whether this build may fetch and run Gemma: shipped, or a development build. */
export function gemmaInBuild(packaged: boolean): boolean {
  return GEMMA_SHIPS || !packaged
}

export type HeavyModel = 'gemma' | 'sam3'
export const HEAVY_MODELS: HeavyModel[] = ['gemma', 'sam3']

export const HEAVY_LABEL: Record<HeavyModel, string> = {
  gemma: tk('Gemma, the local assistant'),
  sam3: tk('SAM 3, Find by name at its best')
}

/** One run of the benchmark's repeated work. */
export interface SustainedRun {
  ms: number
}

export interface HeavyBenchmark {
  model: HeavyModel
  /** ISO time it ran. */
  at: string
  /** What it ran on: a different computer (or a memory change) runs it again. */
  machine: string
  /** Until the model answered its first request (loading it). */
  readyMs: number
  runs: SustainedRun[]
  /** The model's process at its largest, MB. */
  peakMb: number
  /** The computer's memory, MB. */
  totalMb: number
  passed: boolean
  /** Why it didn't pass, in the user's words; or what held, when it did. */
  reasons: string[]
}

/** The bars a run must clear, per model. */
export const HEAVY_BARS: Record<
  HeavyModel,
  {
    /** The mean run, ms, at most. */
    meanMs: number
    /** The last run against the first, at most (1.0: no slower). */
    slowdown: number
    /** The model's memory against the computer's, at most. */
    memoryShare: number
    /** The computer's memory, MB, at least. */
    minTotalMb: number
    /** What one run is, for the reasons. */
    unit: string
  }
> = {
  // Gemma names a photo in 11–17 s on an M2 Pro's GPU and 26–32 s on its CPU
  // (2026-10-08); a minute a photo is past what background naming can keep.
  gemma: {
    meanMs: 45_000,
    slowdown: 1.35,
    memoryShare: 0.6,
    minTotalMb: 8192,
    unit: tk('photo named')
  },
  // SAM 3: 17.7 s an embedding on the M2 Pro's CPU, 5.1 GB at its peak.
  sam3: {
    meanMs: 40_000,
    slowdown: 1.35,
    memoryShare: 0.6,
    minTotalMb: 8192,
    unit: tk('photo read')
  }
}

const secs = (ms: number): string => `${(ms / 1000).toFixed(1)} s`
const gb = (mb: number): string => `${(mb / 1024).toFixed(1)} GB`

/** Whether the runs clear the model's bars, and why not. */
export function judgeSustained(
  model: HeavyModel,
  runs: SustainedRun[],
  peakMb: number,
  totalMb: number
): { passed: boolean; reasons: string[] } {
  const bar = HEAVY_BARS[model]
  const fails: string[] = []
  if (runs.length < 2) return { passed: false, reasons: [t('The benchmark did not finish')] }
  const mean = runs.reduce((s, r) => s + r.ms, 0) / runs.length
  // The first run warms caches: its slowdown is read from the second.
  const first = runs[1]?.ms ?? runs[0].ms
  const last = runs[runs.length - 1].ms
  const slowdown = last / Math.max(1, first)
  if (totalMb < bar.minTotalMb)
    fails.push(
      t('This computer has {{memory}} of memory; it needs {{needed}} or more', {
        memory: gb(totalMb),
        needed: gb(bar.minTotalMb)
      })
    )
  if (peakMb > bar.memoryShare * totalMb)
    fails.push(
      t('It used {{peak}}, more than {{share}} % of this computer’s {{memory}}', {
        peak: gb(peakMb),
        share: Math.round(bar.memoryShare * 100),
        memory: gb(totalMb)
      })
    )
  if (mean > bar.meanMs)
    fails.push(
      t('Each {{unit}} took {{mean}} on average; it has to be under {{bar}}', {
        unit: t(bar.unit),
        mean: secs(mean),
        bar: secs(bar.meanMs)
      })
    )
  if (slowdown > bar.slowdown)
    fails.push(
      t('It slowed down by {{share}} % as it kept working (too hot, or too little room)', {
        share: Math.round((slowdown - 1) * 100)
      })
    )
  if (fails.length) return { passed: false, reasons: fails }
  return {
    passed: true,
    reasons: [
      t('{{mean}} a {{unit}}, {{pace}}, {{peak}} of {{memory}}', {
        mean: secs(mean),
        unit: t(bar.unit),
        pace:
          slowdown <= 1.05
            ? t('steady')
            : t('{{share}} % slower by the end', { share: Math.round((slowdown - 1) * 100) }),
        peak: gb(peakMb),
        memory: gb(totalMb)
      })
    ]
  }
}

/** What a benchmark is valid for: this computer's processor and memory. */
export function machineKey(cpu: string, totalMb: number): string {
  return `${cpu.trim()} · ${Math.round(totalMb / 1024)} GB`
}

/** Whether a kept benchmark still lets the model be on, here. */
export function benchmarkHolds(b: HeavyBenchmark | null | undefined, machine: string): boolean {
  return !!b && b.passed && b.machine === machine
}

/** The settings as kept: the killswitch and each heavy model's switch, with its last benchmark. */
export interface AiSwitches {
  /** "Use AI models": false is the killswitch. */
  enabled: boolean
  heavy: Record<HeavyModel, { on: boolean; benchmark: HeavyBenchmark | null }>
}

export const DEFAULT_SWITCHES: AiSwitches = {
  enabled: true,
  heavy: { gemma: { on: false, benchmark: null }, sam3: { on: false, benchmark: null } }
}

/** The switches read back from settings: anything missing or odd is the default. */
export function readSwitches(v: unknown): AiSwitches {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  const heavy = (o.heavy && typeof o.heavy === 'object' ? o.heavy : {}) as Record<string, unknown>
  const one = (k: HeavyModel): AiSwitches['heavy'][HeavyModel] => {
    const h = (heavy[k] && typeof heavy[k] === 'object' ? heavy[k] : {}) as Record<string, unknown>
    const b = h.benchmark as HeavyBenchmark | null | undefined
    const valid =
      !!b &&
      typeof b === 'object' &&
      b.model === k &&
      Array.isArray(b.runs) &&
      typeof b.passed === 'boolean'
    return { on: h.on === true && valid && b.passed, benchmark: valid ? b : null }
  }
  return { enabled: o.enabled !== false, heavy: { gemma: one('gemma'), sam3: one('sam3') } }
}

/** Whether a heavy model may run now: AI on, the model on, its benchmark this computer's. */
export function heavyAllowed(s: AiSwitches, model: HeavyModel, machine: string): boolean {
  return s.enabled && s.heavy[model].on && benchmarkHolds(s.heavy[model].benchmark, machine)
}
