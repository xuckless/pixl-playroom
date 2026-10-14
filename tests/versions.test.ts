import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Snapshot } from '../src/shared/ipc'
import { defaultRecipe } from '../src/shared/recipe'
import {
  AUTO_DAYS,
  AUTO_KEEP,
  AUTO_MAX,
  isNamed,
  pruneVersions,
  withVersion
} from '../src/shared/versions'

const DAY = 86_400_000
const NOW = Date.parse('2026-10-14T12:00:00Z')

function version(id: string, ago: number, kind?: 'auto', exposure = 0): Snapshot {
  const recipe = defaultRecipe(false)
  recipe.basic.exposure = exposure
  return {
    id,
    name: id,
    at: new Date(NOW - ago).toISOString(),
    recipe,
    ...(kind ? { kind, reason: 'session' as const } : {})
  }
}

test('a snapshot from before Versions is a named version', () => {
  assert.equal(isNamed(version('old', 0)), true)
  assert.equal(isNamed(version('auto', 0, 'auto')), false)
})

test('automatic versions are thinned; named ones never are', () => {
  const named = Array.from({ length: 50 }, (_, i) => version(`n${i}`, i * 30 * DAY))
  // One automatic version every 2 days, for 200 days.
  const autos = Array.from({ length: 100 }, (_, i) => version(`a${i}`, i * 2 * DAY, 'auto', i))
  const kept = pruneVersions([...named, ...autos], NOW)
  assert.equal(kept.filter(isNamed).length, 50)
  const keptAutos = kept.filter((v) => !isNamed(v)).map((v) => v.id)
  // The newest AUTO_KEEP, and nothing older beyond them past AUTO_DAYS.
  assert.deepEqual(
    keptAutos,
    autos.slice(0, Math.max(AUTO_KEEP, Math.ceil(AUTO_DAYS / 2))).map((v) => v.id)
  )
})

test('many recent automatic versions stop at AUTO_MAX, the newest kept', () => {
  const autos = Array.from({ length: 60 }, (_, i) => version(`a${i}`, i * 60_000, 'auto', i))
  const kept = pruneVersions(autos, NOW)
  assert.equal(kept.length, AUTO_MAX)
  assert.deepEqual(
    kept.map((v) => v.id),
    autos.slice(0, AUTO_MAX).map((v) => v.id)
  )
})

test('an automatic version of nothing new is not added; a named one always is', () => {
  const list = [version('a', DAY, 'auto', 0.5)]
  const same = version('b', 0, 'auto', 0.5)
  assert.equal(withVersion(list, same, NOW), list)
  assert.equal(withVersion(list, version('c', 0, 'auto', 0.7), NOW).length, 2)
  assert.equal(withVersion(list, version('d', 0, undefined, 0.5), NOW).length, 2)
})
