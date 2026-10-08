// The heavy models' gate and the killswitch (shared/heavy.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { HeavyBenchmark } from '../src/shared/heavy'

const runs = (...ms: number[]): { ms: number }[] => ms.map((m) => ({ ms: m }))
const GB = 1024

test('a steady, quick run on enough memory passes', async () => {
  const { judgeSustained } = await import('../src/shared/heavy')
  // The M2 Pro, measured: 14–17 s a photo on Metal, 4.0 GB of 16.
  const r = judgeSustained('gemma', runs(17400, 14300, 12100, 13600, 15200), 4003, 16 * GB)
  assert.equal(r.passed, true)
  assert.match(r.reasons[0], /14\.5 s a photo named/)
})

test('too slow, slowing down, too little memory: each said', async () => {
  const { judgeSustained } = await import('../src/shared/heavy')
  const slow = judgeSustained('gemma', runs(60000, 58000, 61000), 4000, 16 * GB)
  assert.equal(slow.passed, false)
  assert.match(slow.reasons.join(' '), /took 59\.7 s on average/)
  // The first run warms up: the slowdown is read from the second.
  const hot = judgeSustained('gemma', runs(30000, 15000, 18000, 21000), 4000, 16 * GB)
  assert.equal(hot.passed, false)
  assert.match(hot.reasons.join(' '), /slowed down by 40 %/)
  const tight = judgeSustained('gemma', runs(15000, 15000, 15000), 4500, 7 * GB)
  assert.equal(tight.passed, false)
  assert.equal(tight.reasons.length, 2, 'too little memory, and too much of it used')
  // An 8 GB computer holds Gemma (4 GB is half): it passes on memory.
  assert.equal(judgeSustained('gemma', runs(20000, 20000, 20000), 4000, 8 * GB).passed, true)
  // SAM 3's 5.1 GB is past 60 % of 8 GB.
  assert.equal(judgeSustained('sam3', runs(18000, 18000, 18000), 5145, 8 * GB).passed, false)
  assert.equal(judgeSustained('gemma', runs(15000), 4000, 16 * GB).passed, false, 'unfinished')
})

test('off unless turned on, and on only with a passing benchmark from this computer', async () => {
  const { readSwitches, heavyAllowed, DEFAULT_SWITCHES, machineKey } =
    await import('../src/shared/heavy')
  assert.deepEqual(readSwitches(null), DEFAULT_SWITCHES)
  assert.equal(DEFAULT_SWITCHES.enabled, true, 'AI models are on unless switched off')
  const here = machineKey('Apple M2 Pro', 16 * GB)
  const b: HeavyBenchmark = {
    model: 'gemma',
    at: '2026-10-08T00:00:00Z',
    machine: here,
    readyMs: 2000,
    runs: runs(15000, 15000, 15000),
    peakMb: 4000,
    totalMb: 16 * GB,
    passed: true,
    reasons: []
  }
  const s = readSwitches({ enabled: true, heavy: { gemma: { on: true, benchmark: b } } })
  assert.equal(heavyAllowed(s, 'gemma', here), true)
  assert.equal(heavyAllowed(s, 'sam3', here), false, 'SAM 3 is off')
  assert.equal(heavyAllowed(s, 'gemma', machineKey('Apple M1', 8 * GB)), false, 'another computer')
  assert.equal(heavyAllowed({ ...s, enabled: false }, 'gemma', here), false, 'the killswitch')
  // Saved as on with a failed benchmark (or none): read back off.
  const failed = readSwitches({
    heavy: { gemma: { on: true, benchmark: { ...b, passed: false } } }
  })
  assert.equal(failed.heavy.gemma.on, false)
  assert.equal(readSwitches({ heavy: { gemma: { on: true } } }).heavy.gemma.on, false)
  assert.equal(readSwitches({ enabled: false }).enabled, false)
})

test('with AI off, smart looks say so for everything a model does; ranges and gradients stay', async () => {
  const { smartReadiness, whyNot } = await import('../src/shared/looks/smart')
  const r = smartReadiness({
    models: true,
    subjectModel: true,
    drunetModel: true,
    enhance: true,
    off: true,
    engine: { sky: true, people: true, sam2: true, detector: false, nafnet: false }
  })
  assert.equal(r.range, 'ready')
  assert.equal(r.radial, 'ready')
  assert.equal(r.subject, 'off')
  assert.equal(r.sky, 'off')
  assert.equal(r.drunet, 'off')
  assert.match(whyNot('off'), /Settings → AI models/)
})
