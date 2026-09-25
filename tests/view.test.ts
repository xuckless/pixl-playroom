import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fitRect, normalisedIn } from '../src/shared/view'

test('fitRect centres a wide picture in a tall box', () => {
  const r = fitRect({ w: 400, h: 400 }, 6000, 4000)
  assert.ok(r)
  assert.equal(r.w, 400)
  assert.ok(Math.abs(r.h - 266.6667) < 1e-3)
  assert.equal(r.x, 0)
  assert.ok(Math.abs(r.y - 66.6667) < 1e-3)
})

test('fitRect does not depend on the render size, only the aspect', () => {
  const a = fitRect({ w: 1000, h: 700 }, 6000, 4000)
  const b = fitRect({ w: 1000, h: 700 }, 1536, 1024)
  assert.deepEqual(a, b)
})

test('fitRect caps enlargement and rejects empty inputs', () => {
  const r = fitRect({ w: 1000, h: 1000 }, 100, 100, 4)
  assert.equal(r?.w, 400)
  assert.equal(fitRect({ w: 0, h: 100 }, 10, 10), null)
  assert.equal(fitRect({ w: 100, h: 100 }, Number.NaN, 10), null)
})

test('normalisedIn maps a pointer into an element box', () => {
  assert.deepEqual(normalisedIn(150, 75, { left: 100, top: 50, width: 100, height: 50 }), {
    x: 0.5,
    y: 0.5
  })
})
