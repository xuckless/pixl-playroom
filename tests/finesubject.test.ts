// The Fine subject (BiRefNet lite, engine 0.18's on-demand models).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { normaliseComponent } from '../src/shared/recipe'
import { FINE_SUBJECT_MODEL } from '../src/shared/ai'

const pixlModels = createRequire(import.meta.url)('@xuckless/pixl-models') as {
  onDemand(): { id: string; files: { url?: string; bytes: number }[]; licence: { spdx: string } }[]
  ref(id: string, host: Record<string, unknown>, where: { dir: string }): Record<string, unknown>
}

test('a fine cut-out keeps saying so in the recipe; a quick one says nothing', () => {
  const fine = normaliseComponent({
    kind: 'brush',
    png: '',
    source: { kind: 'segment', target: 'subject', fine: true }
  })
  assert.deepEqual(fine?.kind === 'brush' && fine.source, {
    kind: 'segment',
    target: 'subject',
    fine: true
  })
  const quick = normaliseComponent({
    kind: 'brush',
    png: '',
    source: { kind: 'segment', target: 'subject', fine: 'yes' }
  })
  assert.deepEqual(quick?.kind === 'brush' && quick.source, { kind: 'segment', target: 'subject' })
})

test('BiRefNet lite is on demand, MIT, with a public upstream, and resolves from a folder', () => {
  const e = pixlModels.onDemand().find((m) => m.id === FINE_SUBJECT_MODEL)
  assert.ok(e)
  assert.equal(e!.licence.spdx, 'MIT')
  assert.ok(e!.files.every((f) => typeof f.url === 'string' && f.url.startsWith('https://')))
  const host = { runtime_library: '/rt', provider: 'Cpu', session: { threads: 4 } }
  const ref = pixlModels.ref(FINE_SUBJECT_MODEL, host, { dir: '/models/birefnet-lite/1.0.0' })
  assert.match(JSON.stringify(ref), /birefnet_lite\.onnx/)
  assert.match(JSON.stringify(ref), /"quantity":"Coverage"/)
})
