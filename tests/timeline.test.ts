import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  controlKey,
  diffRecipe,
  groupTimeline,
  recipeAt,
  replay,
  type Step
} from '../src/shared/history'
import { defaultRecipe, type Recipe } from '../src/shared/recipe'
import type { HistoryLog } from '../src/shared/ipc'

const T0 = Date.parse('2026-10-14T10:00:00Z')
const at = (min: number): string => new Date(T0 + min * 60_000).toISOString()

/** A history made of edits, each `[label, minutes after T0, change]`, optionally some undone. */
function historyOf(
  edits: [string, number, (r: Recipe) => void][],
  undone: number[] = []
): HistoryLog {
  const base = defaultRecipe(false)
  let r = base
  const steps: Step[] = edits.map(([label, min, change], i) => {
    const next = structuredClone(r)
    change(next)
    const step: Step = {
      seq: i + 2,
      label,
      at: at(min),
      patch: diffRecipe(r, next),
      hidden: undone.includes(i + 2),
      ...(undone.includes(i + 2) ? { undone: true as const } : {})
    }
    if (!step.hidden) r = next
    return step
  })
  return { base: { seq: 1, label: 'Opened', at: at(0), recipe: base }, steps }
}

test('drags of one slider merge into one row, from the first value to the last', () => {
  const log = historyOf([
    ['Exposure', 1, (r) => (r.basic.exposure = 0.2)],
    ['Exposure', 2, (r) => (r.basic.exposure = 0.4)],
    ['Exposure', 3, (r) => (r.basic.exposure = 0.6)],
    ['Contrast', 4, (r) => (r.basic.contrast = 12)]
  ])
  const [session] = groupTimeline(log)
  assert.equal(session.opened, true)
  assert.deepEqual(
    session.rows.map((r) => [r.label, r.seqs.length, r.from, r.to]),
    [
      ['Exposure', 3, 0, 0.6],
      ['Contrast', 1, 0, 12]
    ]
  )
})

test('another control between them, or a long wait, starts a new row', () => {
  const log = historyOf([
    ['Exposure', 1, (r) => (r.basic.exposure = 0.2)],
    ['Contrast', 2, (r) => (r.basic.contrast = 10)],
    ['Exposure', 3, (r) => (r.basic.exposure = 0.4)],
    ['Exposure', 20, (r) => (r.basic.exposure = 0.5)]
  ])
  const [session] = groupTimeline(log)
  assert.deepEqual(
    session.rows.map((r) => r.seqs),
    [[2], [3], [4], [5]]
  )
})

test('a long pause starts a new session; undone steps are left out', () => {
  const log = historyOf(
    [
      ['Exposure', 1, (r) => (r.basic.exposure = 0.2)],
      ['Contrast', 2, (r) => (r.basic.contrast = 10)],
      ['Whites', 120, (r) => (r.basic.whites = 5)]
    ],
    [3]
  )
  const sessions = groupTimeline(log)
  assert.equal(sessions.length, 2)
  assert.deepEqual(
    sessions[0].rows.map((r) => r.label),
    ['Exposure']
  )
  assert.deepEqual(
    sessions[1].rows.map((r) => r.label),
    ['Whites']
  )
  assert.equal(sessions[1].opened, false)
})

test('the recipe at a moment is the history replayed up to it', () => {
  const log = historyOf([
    ['Exposure', 1, (r) => (r.basic.exposure = 0.2)],
    ['Contrast', 2, (r) => (r.basic.contrast = 10)]
  ])
  assert.equal(recipeAt(log, 2)!.basic.exposure, 0.2)
  assert.equal(recipeAt(log, 2)!.basic.contrast, 0)
  assert.deepEqual(recipeAt(log, 3), replay(log.base!.recipe, log.steps))
})

test('a control is named by its paths, entities by id', () => {
  assert.equal(
    controlKey([
      { path: ['basic', 'exposure'], value: 1 },
      { path: ['layers', { id: 'm1' }, 'amount'], value: 50 }
    ]),
    'basic.exposure|layers.#m1.amount'
  )
})
