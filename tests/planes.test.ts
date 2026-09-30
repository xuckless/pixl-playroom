import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  defaultRecipe,
  newLocalLayer,
  planeRef,
  slimRecipe,
  type BrushComponent
} from '../src/shared/recipe'
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
  assert.equal(slimRecipe(r), r)
})

test('slimRecipe sends planes by reference and hands them over', () => {
  const r = defaultRecipe(false)
  const layer = newLocalLayer('brush')
  layer.components.push(brush('iVBORw0KGgo='))
  r.layers.push(layer)
  const seen: [string, string][] = []
  const slim = slimRecipe(r, (ref, png) => seen.push([ref, png]))
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
