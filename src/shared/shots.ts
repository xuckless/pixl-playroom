/**
 * Shots that belong together, read-only (pure, for tests/culling.test.ts):
 * the Library's Survey of one photo (N) shows its burst, or else the
 * pictures that look nearly the same. Auto stack (indexer/service.ts) makes
 * stacks of the same bursts; the duplicates source finds near groups the
 * same way, after hashing files that share a size, which this never does.
 */
import { groupNear } from './dupes'

/** The longest gap inside a burst, seconds (Auto stack's default). */
export const BURST_SECONDS = 3

/** How many bits two picture hashes may differ in and still look the same (the duplicates' default). */
export const NEAR_BITS = 6

export interface TimedShot<T = string> {
  key: T
  /** Capture time, ms since the epoch. */
  t: number
  /** The file's name: shots taken in the same second keep the camera's order. */
  name: string
}

/**
 * Runs of shots with no more than `seconds` between one capture and the
 * next, two or more long, each in capture order (by name within a second).
 * Shots without a time are left out by the caller.
 */
export function bursts<T>(shots: readonly TimedShot<T>[], seconds = BURST_SECONDS): T[][] {
  const timed = shots
    .filter((s) => Number.isFinite(s.t))
    .sort((a, b) => a.t - b.t || a.name.localeCompare(b.name))
  const runs: T[][] = []
  let run: T[] = []
  let last = -Infinity
  for (const s of timed) {
    if (s.t - last > seconds * 1000 && run.length > 0) {
      runs.push(run)
      run = []
    }
    run.push(s.key)
    last = s.t
  }
  if (run.length > 0) runs.push(run)
  return runs.filter((r) => r.length >= 2)
}

/** Pictures whose hashes are within `bits` of another's (joined transitively), as groups of keys. */
export function nearGroups(
  hashed: readonly { key: string; hash: string }[],
  bits = NEAR_BITS
): string[][] {
  return groupNear([...hashed], bits).map((g) => g.keys)
}

export type ShotGroupKind = 'burst' | 'near'

/**
 * The group a shot belongs to: its burst when it was taken in one, else the
 * pictures that look nearly the same as it. Null when it is on its own.
 */
export function groupAround(
  key: string,
  burstRuns: readonly (readonly string[])[],
  near: readonly (readonly string[])[]
): { kind: ShotGroupKind; keys: string[] } | null {
  const burst = burstRuns.find((r) => r.includes(key))
  if (burst && burst.length >= 2) return { kind: 'burst', keys: [...burst] }
  const alike = near.find((g) => g.includes(key))
  if (alike && alike.length >= 2) return { kind: 'near', keys: [...alike] }
  return null
}
