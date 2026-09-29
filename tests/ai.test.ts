import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estimate, overallProgress, runOrder, stageStates, type AiStage } from '../src/shared/ai'

const stages: AiStage[] = [
  { id: 'model', label: 'Model', weight: 0.2 },
  { id: 'analyse', label: 'Analyse', weight: 0.6 },
  { id: 'refine', label: 'Refine', weight: 0.2 }
]

test("a job's progress is its stages' shares, done and under way", () => {
  assert.equal(overallProgress(stages, 'model', 0), 0)
  assert.ok(Math.abs(overallProgress(stages, 'analyse', 0.5) - 0.5) < 1e-9)
  assert.equal(overallProgress(stages, 'refine', 1), 1)
  assert.equal(overallProgress(stages, 'refine', 7), 1, 'clamped')
  assert.equal(overallProgress([], 'x', 0.5), 0)
})

test('an estimate moves on, slows near the expected end, and never claims done', () => {
  let last = -1
  for (let t = 0; t <= 60_000; t += 500) {
    const e = estimate(t, 10_000)
    assert.ok(e >= last, 'monotonic')
    assert.ok(e < 0.95 + 1e-12, 'short of done')
    last = e
  }
  assert.ok(estimate(10_000, 10_000) > 0.8)
  assert.equal(estimate(1000, 0), 0)
})

test('stages read done / now / to come; jobs run the running one first, then oldest', () => {
  assert.deepEqual(stageStates(stages, 'analyse', 'running'), ['done', 'now', 'todo'])
  assert.deepEqual(stageStates(stages, 'model', 'queued'), ['todo', 'todo', 'todo'])
  assert.deepEqual(stageStates(stages, 'refine', 'done'), ['done', 'done', 'done'])
  const order = runOrder([
    { id: 'c', phase: 'queued' as const, at: 3 },
    { id: 'x', phase: 'done' as const, at: 0 },
    { id: 'b', phase: 'running' as const, at: 2 },
    { id: 'a', phase: 'queued' as const, at: 1 }
  ]).map((j) => j.id)
  assert.deepEqual(order, ['b', 'a', 'c'])
})
