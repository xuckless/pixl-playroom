import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  defaultRecipe,
  newLocalLayer,
  planeRef,
  slimRecipe,
  type BrushComponent
} from '../src/shared/recipe'

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
