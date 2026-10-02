import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'os'
import { join } from 'path'
import { Store } from '../src/main/db'
import { KEYFRAME_EVERY } from '../src/main/historytable'
import {
  amendLog,
  appendToLog,
  applyPatch,
  dependents,
  diffRecipe,
  patchSummary,
  prerequisites,
  replay,
  type Step
} from '../src/shared/history'
import {
  applyGroups,
  changedGroups,
  defaultRecipe,
  GROUP_LABELS,
  isEdited,
  newLocalLayer,
  type Recipe,
  type RangeComponent
} from '../src/shared/recipe'

const range = (): RangeComponent => ({
  id: 'r1',
  kind: 'range',
  mode: 'Add',
  opacity: 100,
  invert: false,
  feather: 0,
  hue: null,
  saturation: null,
  luma: { centre: 0.5, width: 0.4, softness: 0.1 },
  smoothness: 0
})

/** Build steps the way the index does: each a diff against the one before. */
function stepsFrom(base: Recipe, edits: [string, (r: Recipe) => void][]): Step[] {
  let cur = base
  return edits.map(([label, edit], i) => {
    const next = structuredClone(cur)
    edit(next)
    const step: Step = { seq: i + 2, label, at: '', patch: diffRecipe(cur, next), hidden: false }
    cur = next
    return step
  })
}

const hide = (steps: Step[], ...seqs: number[]): Step[] =>
  steps.map((s) => (seqs.includes(s.seq) ? { ...s, hidden: true } : s))

test('a diff applied to its source gives the target, masks included', () => {
  const a = defaultRecipe(false)
  const b = structuredClone(a)
  b.basic.exposure = 0.7
  b.toneCurve.rgb = [
    { x: 0, y: 0 },
    { x: 0.5, y: 0.6 },
    { x: 1, y: 1 }
  ]
  const layer = newLocalLayer('Sky')
  layer.components.push(range())
  b.layers.push(layer)
  assert.deepEqual(applyPatch(a, diffRecipe(a, b)), b)
  assert.deepEqual(diffRecipe(a, a), [])
})

test('masks are patched by id, and a reorder survives', () => {
  const a = defaultRecipe(false)
  const one = newLocalLayer('One')
  const two = newLocalLayer('Two')
  a.layers.push(one, two)
  const b = structuredClone(a)
  b.layers.reverse()
  b.layers[0].settings.basic.exposure = 1
  assert.deepEqual(applyPatch(a, diffRecipe(a, b)), b)
})

test('hiding a later step reveals the earlier value of the same field', () => {
  const base = defaultRecipe(false)
  const steps = stepsFrom(base, [
    ['Exposure', (r) => (r.basic.exposure = 0.5)],
    ['Contrast', (r) => (r.basic.contrast = 20)],
    ['Exposure', (r) => (r.basic.exposure = 1.2)]
  ])
  assert.equal(replay(base, steps).basic.exposure, 1.2)
  const hidden = replay(base, hide(steps, 4))
  assert.equal(hidden.basic.exposure, 0.5)
  assert.equal(hidden.basic.contrast, 20)
  // Hiding a middle step keeps the ones after it.
  const middle = replay(base, hide(steps, 3))
  assert.equal(middle.basic.contrast, base.basic.contrast)
  assert.equal(middle.basic.exposure, 1.2)
})

test('steps on a mask depend on the step that made it, transitively', () => {
  const base = defaultRecipe(false)
  const layer = newLocalLayer('Sky')
  const steps = stepsFrom(base, [
    ['New mask', (r) => r.layers.push(structuredClone(layer))],
    ['Exposure', (r) => (r.basic.exposure = 0.3)],
    ['Sky: exposure', (r) => (r.layers[0].settings.basic.exposure = -1)],
    ['Add range', (r) => r.layers[0].components.push(range())],
    ['Range feather', (r) => (r.layers[0].components[0].feather = 40)]
  ])
  assert.deepEqual(dependents(steps, 2), [4, 5, 6])
  assert.deepEqual(dependents(steps, 5), [6])
  assert.deepEqual(dependents(steps, 3), [])
  // Only among visible steps, for a hide.
  assert.deepEqual(
    dependents(hide(steps, 4), 2, (s) => !s.hidden),
    [5, 6]
  )
  // Showing the feather needs the range and the mask back.
  assert.deepEqual(prerequisites(hide(steps, 2, 5, 6), 6), [2, 5])
  assert.deepEqual(prerequisites(steps, 6), [])
  // A replay without the mask's maker skips what reaches into it.
  const r = replay(base, hide(steps, 2))
  assert.equal(r.layers.length, 0)
  assert.equal(r.basic.exposure, 0.3)
})

test('the summary names the groups a step changed', () => {
  const a = defaultRecipe(false)
  const b = structuredClone(a)
  b.basic.exposure = 1
  b.detail.sharpenAmount = 50
  b.geometry.quarterTurns = 1
  assert.deepEqual(patchSummary(diffRecipe(a, b)), [
    GROUP_LABELS.basicTone,
    GROUP_LABELS.detailSharpen,
    GROUP_LABELS.orientation
  ])
  const c = structuredClone(a)
  c.geometry.upright.vertical = 20
  assert.deepEqual(patchSummary(diffRecipe(a, c)), [GROUP_LABELS.upright])
})

test('an Upright-only edit is an edit, in its own group', () => {
  const plain = defaultRecipe(true)
  const r = structuredClone(plain)
  r.geometry.upright.vertical = 20
  assert.equal(isEdited(r, true), true)
  assert.deepEqual(changedGroups(r, plain), ['upright'])
  assert.deepEqual(applyGroups(plain, r, ['upright']).geometry.upright, r.geometry.upright)
  assert.deepEqual(applyGroups(plain, r, ['crop']).geometry.upright, plain.geometry.upright)
})

function withStore(fn: (store: Store, file: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'playroom-history-'))
  const file = join(dir, 'index.db')
  const store = Store.open(file)
  try {
    fn(store, file)
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

test('the store records steps, skips no-ops, hides and deletes', () => {
  withStore((store) => {
    const base = defaultRecipe(false)
    assert.ok(store.appendHistory('k', 'Opened', base).base)
    let log = store.history('k')
    assert.equal(log.steps.length, 0)
    const a = structuredClone(base)
    a.basic.exposure = 0.5
    store.appendHistory('k', 'Exposure', a)
    const b = structuredClone(a)
    b.basic.contrast = 10
    store.appendHistory('k', 'Contrast', b)
    log = store.history('k')
    assert.equal(log.steps.length, 2)
    // The same recipe again records nothing.
    assert.equal(store.appendHistory('k', 'Nothing', b).step, null)
    assert.equal(store.history('k').steps.length, 2)
    const [exposure, contrast] = log.steps
    log = store.setHistoryHidden('k', [exposure.seq], true)
    assert.deepEqual(
      log.steps.map((s) => s.hidden),
      [true, false]
    )
    assert.equal(replay(log.base!.recipe, log.steps).basic.exposure, base.basic.exposure)
    // A new edit diffs against what is shown, not against the hidden step.
    const c = replay(log.base!.recipe, log.steps)
    c.basic.whites = 5
    log = appendToLog(log, store.appendHistory('k', 'Whites', c))
    assert.deepEqual(
      log.steps.at(-1)!.patch.map((op) => op.path),
      [['basic', 'whites']]
    )
    log = store.deleteHistory('k', [contrast.seq, log.base!.seq])
    assert.equal(log.steps.length, 2, 'the base is never deleted')
    assert.equal(replay(log.base!.recipe, log.steps).basic.contrast, base.basic.contrast)
  })
})

test('past the limit the oldest steps fold into the base', () => {
  withStore((store) => {
    let r = defaultRecipe(false)
    store.appendHistory('k', 'Opened', r)
    for (let i = 1; i <= 205; i++) {
      r = structuredClone(r)
      r.basic.exposure = i / 100
      store.appendHistory('k', `Exposure ${i}`, r)
    }
    const log = store.history('k')
    assert.equal(log.steps.length + 1, 200)
    assert.equal(log.base!.recipe.basic.exposure, 0.06)
    assert.equal(replay(log.base!.recipe, log.steps).basic.exposure, 2.05)
  })
})

test('every KEYFRAME_EVERY steps a row keeps the whole recipe, and the head comes from it', () => {
  withStore((store, file) => {
    let r = defaultRecipe(false)
    store.appendHistory('k', 'Opened', r)
    for (let i = 1; i <= 60; i++) {
      r = structuredClone(r)
      r.basic.exposure = i / 100
      store.appendHistory('k', `Exposure ${i}`, r)
    }
    const keyed = (): number[] => {
      const db = new DatabaseSync(file, { readOnly: true })
      try {
        return (
          db
            .prepare(
              "SELECT seq FROM history WHERE item_key = 'k' AND patch IS NOT NULL AND recipe <> '' ORDER BY seq"
            )
            .all() as { seq: number }[]
        ).map((x) => x.seq)
      } finally {
        db.close()
      }
    }
    // Seqs count from the base (1): step n is seq n + 1.
    assert.deepEqual(keyed(), [KEYFRAME_EVERY + 1, 2 * KEYFRAME_EVERY + 1])
    const log = store.history('k')
    assert.equal(log.head?.basic.exposure, 0.6)
    assert.deepEqual(log.head, replay(log.base!.recipe, log.steps))

    // Hiding step 10 clears the keyframes after it and rebuilds them as they are now.
    const hidden = store.setHistoryHidden('k', [log.steps[59].seq, log.steps[9].seq], true)
    assert.deepEqual(keyed(), [KEYFRAME_EVERY + 1, 2 * KEYFRAME_EVERY + 1])
    assert.equal(hidden.head?.basic.exposure, 0.59)
    assert.deepEqual(hidden.head, replay(hidden.base!.recipe, hidden.steps))
    // A new edit diffs against the rebuilt head.
    const next = structuredClone(hidden.head!)
    next.basic.contrast = 12
    const added = store.appendHistory('k', 'Contrast', next)
    assert.deepEqual(
      added.step!.patch.map((op) => op.path),
      [['basic', 'contrast']]
    )
  })
})

test('appends laid on a log, folds included, match the stored history', () => {
  withStore((store) => {
    let r = defaultRecipe(false)
    let log = appendToLog({ base: null, steps: [] }, store.appendHistory('k', 'Opened', r))
    for (let i = 1; i <= 230; i++) {
      r = structuredClone(r)
      r.basic.exposure = i / 100
      log = appendToLog(log, store.appendHistory('k', `Exposure ${i}`, r))
    }
    const stored = store.history('k')
    assert.deepEqual(log, { base: stored.base, steps: stored.steps })
    assert.equal(stored.head?.basic.exposure, 2.3)
  })
})

test('whole-recipe rows from before steps are converted when read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'playroom-history-'))
  const file = join(dir, 'index.db')
  try {
    const old = new DatabaseSync(file)
    old.exec(`CREATE TABLE history (
      item_key TEXT NOT NULL, seq INTEGER NOT NULL, label TEXT NOT NULL,
      at TEXT NOT NULL, recipe TEXT NOT NULL, PRIMARY KEY (item_key, seq))`)
    const r1 = defaultRecipe(true)
    const r2 = structuredClone(r1)
    r2.basic.exposure = 0.4
    const r3 = structuredClone(r2)
    r3.layers.push(newLocalLayer('Mask 1'))
    const ins = old.prepare('INSERT INTO history VALUES (?, ?, ?, ?, ?)')
    ins.run('k', 1, 'Opened', 't1', JSON.stringify(r1))
    ins.run('k', 2, 'Exposure', 't2', JSON.stringify(r2))
    ins.run('k', 3, 'New mask', 't3', JSON.stringify(r3))
    old.close()
    const store = Store.open(file)
    try {
      const log = store.history('k')
      assert.deepEqual(log.base!.recipe, r1)
      assert.deepEqual(
        log.steps.map((s) => s.label),
        ['Exposure', 'New mask']
      )
      assert.deepEqual(replay(log.base!.recipe, log.steps), r3)
      // Read again: already converted, same answer.
      assert.deepEqual(store.history('k'), log)
    } finally {
      store.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the newest step is amended in place, refused once it is not the newest', () => {
  withStore((store, file) => {
    const base = defaultRecipe(false)
    let log = appendToLog({ base: null, steps: [] }, store.appendHistory('k', 'Opened', base))
    const a = structuredClone(base)
    a.basic.exposure = 0.5
    log = appendToLog(log, store.appendHistory('k', 'Exposure', a))
    const look = structuredClone(a)
    look.basic.contrast = 30
    look.presence.saturation = -20
    log = appendToLog(log, store.appendHistory('k', 'Look: A', look))
    const seq = log.steps.at(-1)!.seq

    // Half the look: the same step, now holding half of each, under a new label.
    const half = structuredClone(a)
    half.basic.contrast = 15
    half.presence.saturation = -10
    const amended = store.amendHistory('k', seq, 'Look: A · 50%', half)!
    assert.equal(amended.seq, seq)
    assert.equal(amended.step!.label, 'Look: A · 50%')
    log = amendLog(log, amended)
    const stored = store.history('k')
    assert.deepEqual(
      { base: log.base, steps: log.steps },
      { base: stored.base, steps: stored.steps }
    )
    assert.equal(stored.steps.length, 2)
    assert.equal(stored.head!.basic.contrast, 15)
    assert.equal(stored.head!.basic.exposure, 0.5, 'the step before is untouched')

    // Back to nothing: the step goes.
    const gone = store.amendHistory('k', seq, 'Look: A · 0%', a)!
    assert.equal(gone.step, null)
    log = amendLog(log, gone)
    assert.equal(store.history('k').steps.length, 1)
    assert.equal(log.steps.length, 1)

    // Not the newest (or hidden, or gone): refused, nothing written.
    log = appendToLog(log, store.appendHistory('k', 'Look: B', look))
    const b = log.steps.at(-1)!.seq
    log = appendToLog(
      log,
      store.appendHistory('k', 'Whites', { ...look, basic: { ...look.basic, whites: 5 } })
    )
    assert.equal(store.amendHistory('k', b, 'Look: B · 50%', half), null)
    assert.equal(store.amendHistory('k', seq, 'Look: A', half), null)
    const last = log.steps.at(-1)!.seq
    store.setHistoryHidden('k', [last], true)
    assert.equal(store.amendHistory('k', last, 'Whites', look), null)
    assert.equal(store.history('k').steps.length, 3)
    void file
  })
})

test('an amended keyframe step keeps its keyframe, of the step as it is now', () => {
  withStore((store) => {
    let r = defaultRecipe(false)
    store.appendHistory('k', 'Opened', r)
    for (let i = 1; i <= KEYFRAME_EVERY; i++) {
      r = structuredClone(r)
      r.basic.exposure = i / 100
      store.appendHistory('k', `Exposure ${i}`, r)
    }
    const seq = store.history('k').steps.at(-1)!.seq
    const next = structuredClone(r)
    next.basic.contrast = 22
    assert.ok(store.amendHistory('k', seq, 'Look', next))
    const log = store.history('k')
    assert.equal(log.head!.basic.contrast, 22)
    assert.deepEqual(log.head, replay(log.base!.recipe, log.steps))
  })
})
