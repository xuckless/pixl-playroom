import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LOOK_ALIASES, STARTER_LOOK_IDS } from '../src/shared/looks/catalog'
import { addMine, moveMine, readMine, removeMine, writeMine } from '../src/shared/looks/mine'

test('nothing stored yet: My Looks is the starter set', () => {
  assert.deepEqual(readMine(undefined), STARTER_LOOK_IDS)
  assert.deepEqual(readMine(null), STARTER_LOOK_IDS)
  assert.deepEqual(readMine({ v: 1 }), STARTER_LOOK_IDS)
})

test('an emptied list stays empty', () => {
  assert.deepEqual(readMine(writeMine([])), [])
})

test('a stored list drops unknown and repeated ids and follows aliases', () => {
  LOOK_ALIASES['builtin:old-name'] = 'builtin:vivid'
  try {
    assert.deepEqual(
      readMine({
        v: 1,
        ids: ['builtin:portrait', 'builtin:gone', 'builtin:portrait', 'builtin:old-name', 7]
      }),
      ['builtin:portrait', 'builtin:vivid']
    )
  } finally {
    delete LOOK_ALIASES['builtin:old-name']
  }
})

test('add, remove and move keep the order', () => {
  const a = ['builtin:a', 'builtin:b', 'builtin:c']
  assert.deepEqual(addMine(a, 'builtin:d'), [...a, 'builtin:d'])
  assert.equal(addMine(a, 'builtin:b'), a)
  assert.deepEqual(removeMine(a, 'builtin:b'), ['builtin:a', 'builtin:c'])
  assert.deepEqual(moveMine(a, 'builtin:c', 0), ['builtin:c', 'builtin:a', 'builtin:b'])
  assert.deepEqual(moveMine(a, 'builtin:a', 99), ['builtin:b', 'builtin:c', 'builtin:a'])
  assert.equal(moveMine(a, 'builtin:x', 0), a)
})
