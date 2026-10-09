// The engine's safe-shutdown advisory: when Playroom's hosts are let go.
import { test } from 'node:test'
import assert from 'node:assert/strict'

test('hidden rests after 60 s, inactive after 120 s, in use never', async () => {
  const { restDelay, HIDDEN_REST_MS, INACTIVE_REST_MS } = await import('../src/shared/rest')
  assert.equal(HIDDEN_REST_MS, 60_000)
  assert.equal(INACTIVE_REST_MS, 120_000)
  assert.equal(restDelay({ visible: false, focused: false }), HIDDEN_REST_MS)
  assert.equal(restDelay({ visible: true, focused: false }), INACTIVE_REST_MS)
  assert.equal(restDelay({ visible: true, focused: true }), null)
})

test('HR-0.19-2: an engine temp names its pid; anything else is left alone', async () => {
  const { engineTempPid } = await import('../src/shared/rest')
  assert.equal(engineTempPid('.view-ab-3.jpg.pixl-4242-7.tmp'), 4242)
  assert.equal(engineTempPid('view-ab-3.jpg'), null)
  assert.equal(engineTempPid('.view.jpg.pixl-x-7.tmp'), null)
  assert.equal(engineTempPid('view.jpg.pixl-12-7.tmp'), null)
})
