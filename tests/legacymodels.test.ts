import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  LEGACY_MODELS,
  fillRef,
  legacyInstalledDir,
  legacyModel
} from '../src/main/ai/legacymodels'

const tiny = { id: 'x', version: '1.0.0', files: [{ name: 'x.onnx', bytes: 5 }] }
function root(): string {
  return mkdtempSync(join(tmpdir(), 'legacy-models-'))
}

test('the two retired models are vendored with the roster’s sizes', () => {
  assert.equal(legacyModel('u2net')?.files[0].bytes, 175997641)
  assert.equal(legacyModel('u2net')?.replacedBy, 'u2netp')
  assert.equal(legacyModel('fbcnn-color-qf')?.files[0].bytes, 143923497)
  assert.equal(legacyModel('fbcnn-color-qf')?.replacedBy, 'fbcnn-color-blind')
  assert.equal(legacyModel('u2netp'), undefined)
  assert.equal(new Set(LEGACY_MODELS.map((m) => m.id)).size, LEGACY_MODELS.length)
})

test('an installed legacy model is found at the roster’s version, or under another folder', async () => {
  const r = root()
  assert.equal(await legacyInstalledDir(r, tiny), null)
  mkdirSync(join(r, 'x', '1.0.0'), { recursive: true })
  writeFileSync(join(r, 'x', '1.0.0', 'x.onnx'), '12345')
  assert.equal(await legacyInstalledDir(r, tiny), join(r, 'x', '1.0.0'))
  const o = root()
  mkdirSync(join(o, 'x', '0.9'), { recursive: true })
  writeFileSync(join(o, 'x', '0.9', 'x.onnx'), '12345')
  assert.equal(await legacyInstalledDir(o, tiny), join(o, 'x', '0.9'))
})

test('a file of the wrong size is not an install (a part download, a different model)', async () => {
  const r = root()
  mkdirSync(join(r, 'x', '1.0.0'), { recursive: true })
  writeFileSync(join(r, 'x', '1.0.0', 'x.onnx'), '123')
  assert.equal(await legacyInstalledDir(r, tiny), null)
})

test('a ref’s holes are filled: files under the folder, values from the host, none missing', () => {
  const u = legacyModel('u2net')!
  const host = { runtime_library: '/rt/libonnx', provider: 'Cpu', session: { threads: 2 } }
  const ref = fillRef(u.ref, '/models/u2net/1.0.0', host) as {
    model: { model_path: string; runtime_library: string; provider: string; session: unknown }
    outputs: { tensor: string }[]
  }
  assert.equal(ref.model.model_path, join('/models/u2net/1.0.0', 'u2net.onnx'))
  assert.equal(ref.model.runtime_library, '/rt/libonnx')
  assert.equal(ref.model.provider, 'Cpu')
  assert.deepEqual(ref.model.session, { threads: 2 })
  assert.equal(ref.outputs[0].tensor, '1959')
  // The vendored record is not changed by filling it.
  assert.deepEqual((u.ref.model as { model_path: unknown }).model_path, { $file: 'u2net.onnx' })
  assert.throws(
    () => fillRef(u.ref, '/m', { provider: 'Cpu' }),
    /MissingHostValue: runtime_library/
  )
})
