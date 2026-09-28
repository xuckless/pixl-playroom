import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collapseStacks } from '../src/shared/stacks'
import type { LibraryItem } from '../src/shared/ipc'
import { item } from './items'

const inStack = (key: string, id: string, position: number, size = 3): LibraryItem =>
  item({
    key,
    copyId: key.includes(':') ? key.split(':')[1] : null,
    stack: { id, position, size }
  })

const keys = (items: LibraryItem[]): string[] => items.map((i) => i.key)

test('a collapsed stack shows its cover at the cover’s place', () => {
  // Sorted by name, say: the cover (3) comes after a member (2).
  const items = [
    item({ key: '1' }),
    inStack('2', 's', 1),
    inStack('3', 's', 0),
    item({ key: '4' }),
    inStack('5', 's', 2)
  ]
  assert.deepEqual(keys(collapseStacks(items, new Set())), ['1', '3', '4'])
})

test('an expanded stack keeps its members together, in stack order, copies after their photo', () => {
  const items = [
    inStack('2:c', 's', 1),
    item({ key: '1' }),
    inStack('2', 's', 1),
    inStack('3', 's', 0),
    item({ key: '4' }),
    inStack('5', 's', 2)
  ]
  assert.deepEqual(keys(collapseStacks(items, new Set(['s']))), ['1', '3', '2', '2:c', '5', '4'])
})

test('several stacks, and a listing without the cover', () => {
  const items = [
    inStack('7', 't', 2),
    item({ key: '1' }),
    inStack('6', 't', 1),
    inStack('3', 's', 0),
    inStack('4', 's', 1)
  ]
  // t's cover is not in this listing: its lowest member stands in.
  assert.deepEqual(keys(collapseStacks(items, new Set())), ['1', '6', '3'])
  assert.deepEqual(keys(collapseStacks(items, new Set(['t']))), ['1', '6', '7', '3'])
})

test('no stacks: the same array', () => {
  const items = [item({ key: '1' }), item({ key: '2' })]
  assert.equal(collapseStacks(items, new Set()), items)
})
