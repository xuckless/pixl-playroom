import { test } from 'node:test'
import assert from 'node:assert/strict'
import { simplifyPath } from '../src/shared/simplify'

test('straight runs collapse to their ends; corners stay', () => {
  const line = Array.from({ length: 50 }, (_, i) => ({ x: i, y: 0 }))
  assert.deepEqual(simplifyPath(line, 0.5), [
    { x: 0, y: 0 },
    { x: 49, y: 0 }
  ])
  const corner = [
    ...Array.from({ length: 10 }, (_, i) => ({ x: i, y: 0 })),
    ...Array.from({ length: 10 }, (_, i) => ({ x: 10, y: i }))
  ]
  assert.deepEqual(simplifyPath(corner, 0.5), [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 9 }
  ])
})

test('a wobble within epsilon goes; one past it stays', () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 5, y: 0.4 },
    { x: 10, y: 0 },
    { x: 15, y: 3 },
    { x: 20, y: 0 }
  ]
  assert.deepEqual(simplifyPath(pts, 0.75), [pts[0], pts[2], pts[3], pts[4]])
})

test('short paths come back as they are, and a long one does not recurse', () => {
  assert.deepEqual(simplifyPath([{ x: 1, y: 2 }], 1), [{ x: 1, y: 2 }])
  const circle = Array.from({ length: 20000 }, (_, i) => ({
    x: Math.cos((i / 20000) * Math.PI * 2) * 100,
    y: Math.sin((i / 20000) * Math.PI * 2) * 100
  }))
  const out = simplifyPath(circle, 0.5)
  assert.ok(out.length > 20 && out.length < 200, String(out.length))
})
