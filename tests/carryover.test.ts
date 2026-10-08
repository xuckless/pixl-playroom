import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { carryOver, retiredModelDirs } from '../src/main/ai/carryover'

const sha = (s: string): string => createHash('sha256').update(s).digest('hex')
const model = {
  id: 'x',
  version: '1.0.1',
  files: [
    { name: 'a.onnx', bytes: 5, sha256: sha('12345') },
    { name: 'b.onnx', bytes: 3, sha256: sha('abc') }
  ]
}
function root(files: Record<string, string>): string {
  const r = mkdtempSync(join(tmpdir(), 'carry-models-'))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(r, path, '..'), { recursive: true })
    writeFileSync(join(r, path), text)
  }
  return r
}

test('the same files under an earlier version become this version’s', async () => {
  const r = root({ 'x/1.0.0/a.onnx': '12345', 'x/1.0.0/b.onnx': 'abc' })
  assert.equal(await carryOver(r, model), true)
  assert.equal(readFileSync(join(r, 'x', '1.0.1', 'a.onnx'), 'utf8'), '12345')
  assert.equal(readFileSync(join(r, 'x', '1.0.1', 'b.onnx'), 'utf8'), 'abc')
  assert.equal(existsSync(join(r, 'x', '1.0.0')), false)
})

test('a part download under the new version gives way to the whole copy', async () => {
  const r = root({
    'x/1.0.0/a.onnx': '12345',
    'x/1.0.0/b.onnx': 'abc',
    'x/1.0.1/a.onnx.part': '12'
  })
  assert.equal(await carryOver(r, model), true)
  assert.equal(existsSync(join(r, 'x', '1.0.1', 'a.onnx.part')), false)
  assert.equal(existsSync(join(r, 'x', '1.0.1', 'b.onnx')), true)
})

test('other files are left where they are: a changed model, a missing file, no folder', async () => {
  // The same size, other bytes.
  const changed = root({ 'x/1.0.0/a.onnx': '54321', 'x/1.0.0/b.onnx': 'abc' })
  assert.equal(await carryOver(changed, model), false)
  assert.equal(existsSync(join(changed, 'x', '1.0.0', 'a.onnx')), true)
  const partial = root({ 'x/1.0.0/a.onnx': '12345' })
  assert.equal(await carryOver(partial, model), false)
  assert.equal(await carryOver(root({}), model), false)
})

test('what no release uses goes: retired models and old versions; on-demand and current stay', async () => {
  const r = root({
    'real-esrgan-x2plus/1.0.0/x.onnx': 'x',
    'lama/1.0.0/l.onnx': 'l',
    'u2net/1.0.0/u.onnx': 'u',
    'span-x4-ch48/1.0.0/s.onnx': 's',
    'sam2-1-hiera-tiny/1.0.0/old.onnx': 'o',
    'sam2-1-hiera-tiny/1.0.1/new.onnx': 'n',
    'birefnet-lite/1.0.0/b.onnx': 'b'
  })
  writeFileSync(join(r, 'notes.txt'), 'not a model')
  const gone = await retiredModelDirs(
    r,
    new Map([
      ['span-x4-ch48', '1.0.0'],
      ['sam2-1-hiera-tiny', '1.0.1']
    ]),
    new Set(['birefnet-lite'])
  )
  assert.deepEqual(gone.sort(), ['lama', 'real-esrgan-x2plus', 'sam2-1-hiera-tiny/1.0.0', 'u2net'])
  assert.deepEqual(await retiredModelDirs(join(r, 'missing'), new Map(), new Set()), [])
})
