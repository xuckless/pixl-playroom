// The cull signals (shared/cull.ts) and their keeping in the index.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DatabaseSync } from 'node:sqlite'
import type { ImageStats } from '../src/shared/engine-types'

test('the picture hash: bits apart, and the same picture grouped', async () => {
  const { phashDistance, phashGroups, SAME_PHOTO_BITS } = await import('../src/shared/cull')
  assert.equal(phashDistance('0000000000000000', '0000000000000000'), 0)
  assert.equal(phashDistance('0000000000000000', 'ffffffffffffffff'), 64)
  assert.equal(phashDistance('00000000000000ff', '0000000000000000'), 8)
  assert.equal(phashDistance(null, '0000000000000000'), null)
  assert.equal(phashDistance('xyz', '0000000000000000'), null)
  const p = (id: string, phash: string | null): { id: string; phash: string | null } => ({
    id,
    phash
  })
  const groups = phashGroups([
    p('a', '0000000000000000'),
    p('b', '00000000000003ff'), // 10 bits from a: the same
    p('c', '0000000000000fff'), // 12 from a, 2 from b: joined through b
    p('d', 'ffffffff00000000'), // far from all
    p('e', null)
  ])
  assert.deepEqual(
    groups.map((g) => g.map((x) => x.id)),
    [['a', 'b', 'c']]
  )
  assert.equal(SAME_PHOTO_BITS, 10)
})

test('exposure from analyze: percentiles and the worst channel’s clipping, in 0..1', async () => {
  const { exposureOf } = await import('../src/shared/cull')
  const stats = {
    range_max: 1,
    luma_mean: 0.42,
    luma_percentiles: [
      { percentile: 1, value: 0.01 },
      { percentile: 5, value: 0.05 },
      { percentile: 50, value: 0.4 },
      { percentile: 95, value: 0.9 },
      { percentile: 99, value: 0.98 }
    ],
    clipped_low: [0.001, 0.002, 0.004],
    clipped_high: [0.03, 0.01, 0.0]
  } as unknown as ImageStats
  const e = exposureOf(stats)
  assert.equal(e.mean, 0.42)
  assert.equal(e.p50, 0.4)
  assert.equal(e.p99, 0.98)
  assert.equal(e.clipLow, 0.004)
  assert.equal(e.clipHigh, 0.03)
})

test('blink is read from the blendshapes, or none', async () => {
  const { blinkOf } = await import('../src/shared/cull')
  assert.deepEqual(
    blinkOf([
      { name: 'jawOpen', score: 0.1 },
      { name: 'eyeBlinkLeft', score: 0.91 },
      { name: 'eyeBlinkRight', score: 0.88 }
    ]),
    { blinkLeft: 0.91, blinkRight: 0.88 }
  )
  assert.deepEqual(blinkOf(null), { blinkLeft: null, blinkRight: null })
})

test('signals are kept per file version: a changed file, or a newer measure, is measured again', async () => {
  const { Store } = await import('../src/main/db')
  const { cullKey, readCull, CULL_VERSION } = await import('../src/shared/cull')
  const dir = mkdtempSync(join(tmpdir(), 'playroom-cull-'))
  try {
    const file = join(dir, 'playroom.db')
    Store.open(file).close()
    const db = new DatabaseSync(file)
    const add = db.prepare(
      `INSERT INTO photos (path, folder, name, ext, size, mtime, is_raw, added) VALUES (?, '/a', ?, 'jpg', ?, 5, 0, ?)`
    )
    add.run('/a/one.jpg', 'one.jpg', 100, 1)
    add.run('/a/two.jpg', 'two.jpg', 200, 2)
    db.close()
    const store = Store.open(file)
    const one = store.photoByPath('/a/one.jpg')!.id
    const two = store.photoByPath('/a/two.jpg')!.id
    const all = { subject: true, faces: true }
    const stale = (models = all): number[] =>
      store
        .cullState()
        .filter((r) => r.cull_key !== cullKey(r.mtime, r.size, models))
        .map((r) => r.id)
    assert.deepEqual(stale(), [two, one], 'newest first')
    const json = JSON.stringify({ v: CULL_VERSION, exposure: {}, focus: {} })
    store.setCull(one, json, cullKey(5, 100, all))
    assert.deepEqual(stale(), [two])
    // The file changed size: measured again.
    store.setCull(two, json, cullKey(5, 999, all))
    assert.deepEqual(stale(), [two])
    // Measured without the subject model, which has arrived since: again.
    store.setCull(two, json, cullKey(5, 200, { subject: false, faces: true }))
    assert.deepEqual(stale(), [two])
    assert.deepEqual(stale({ subject: false, faces: true }), [one], 'and one, measured with it')
    assert.equal(store.culls([one])[0].cull, json)
    assert.notEqual(readCull(json), null)
    assert.equal(readCull('{"v":0}'), null)
    assert.equal(readCull('nope'), null)
    store.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
