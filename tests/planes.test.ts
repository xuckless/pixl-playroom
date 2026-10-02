import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'crypto'
import { defaultRecipe, newLocalLayer, slimRecipe, type BrushComponent } from '../src/shared/recipe'
import { isPlaneHash, planeRef, renameRefs } from '../src/main/planeref'
import { pruneDue } from '../src/main/planes'

const brush = (png: string): BrushComponent => ({
  id: 'b1',
  kind: 'brush',
  mode: 'Add',
  opacity: 100,
  invert: false,
  feather: 0,
  width: 4,
  height: 4,
  png
})

test('slimRecipe returns a recipe without planes untouched', () => {
  const r = defaultRecipe(false)
  assert.equal(slimRecipe(r, planeRef), r)
})

test('slimRecipe sends planes by reference and hands them over', () => {
  const r = defaultRecipe(false)
  const layer = newLocalLayer('brush')
  layer.components.push(brush('iVBORw0KGgo='))
  r.layers.push(layer)
  const seen: [string, string][] = []
  const slim = slimRecipe(r, planeRef, (ref, png) => seen.push([ref, png]))
  const c = slim.layers[0].components[0] as BrushComponent
  assert.equal(c.png, '')
  assert.equal(c.ref, planeRef('iVBORw0KGgo='))
  assert.deepEqual(seen, [[c.ref, 'iVBORw0KGgo=']])
  // The original keeps its pixels.
  assert.equal((r.layers[0].components[0] as BrushComponent).png, 'iVBORw0KGgo=')
})

test('gradient planes are pruned after 32 writes or 10 s, not on every write', () => {
  let st: { writes: number; at: number } | undefined
  let dues = 0
  for (let i = 0; i < 64; i++) {
    const r = pruneDue(st, 1000)
    st = r.next
    if (r.due) dues++
  }
  assert.equal(dues, 2)
  const first = pruneDue(undefined, 0)
  assert.equal(first.due, false)
  assert.equal(pruneDue(first.next, 10_000).due, true, 'ten seconds on, the next write prunes')
})

test('a plane is named by the SHA-256 of its bytes; older names are renamed in stored JSON', () => {
  // The bytes, not the base64 text: 0x89 0x50.
  const bytes = createHash('sha256')
    .update(Buffer.from([0x89, 0x50]))
    .digest('hex')
  assert.equal(planeRef('iVA='), bytes)
  assert.ok(isPlaneHash(planeRef('iVA=')))
  assert.equal(isPlaneHash('1a2b3c-120'), false)
  const names = new Map([['1a2b3c-120', 'f'.repeat(64)]])
  assert.equal(
    renameRefs('{"ref":"1a2b3c-120","x":{"ref":"other-1"}}', names),
    `{"ref":"${'f'.repeat(64)}","x":{"ref":"other-1"}}`
  )
})

test('a snapped stroke is cut to its object, at the object’s size', async () => {
  const { cutToObject } = await import('../src/main/planes')
  // A 2×1 stroke, full on the left; a 4×2 object, only its left half.
  const stroke = { data: Uint8Array.from([255, 255]), width: 2, height: 1 }
  const object = { data: Uint8Array.from([255, 255, 0, 0, 255, 128, 0, 0]), width: 4, height: 2 }
  const out = cutToObject(stroke, object)
  assert.equal(out.width, 4)
  assert.equal(out.height, 2)
  assert.deepEqual([...out.data], [255, 255, 0, 0, 255, 128, 0, 0])
  // Where the stroke is not, nothing, whatever the object.
  const none = cutToObject({ data: new Uint8Array(2), width: 2, height: 1 }, object)
  assert.ok(none.data.every((v) => v === 0))
})
