import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LegacyPreviews } from '../src/main/legacy'

function setup(): { dir: string; thumb: string } {
  const root = mkdtempSync(join(tmpdir(), 'legacy-'))
  const thumb = join(root, 'thumb.jpg')
  writeFileSync(thumb, 'old pixels')
  return { dir: join(root, 'legacy'), thumb }
}

test('a legacy preview is a copy, taken once per photo', () => {
  const { dir, thumb } = setup()
  const l = new LegacyPreviews(dir, '0.2.0')
  assert.equal(l.capture('7', thumb), true)
  assert.equal(l.capture('7', thumb), false)
  assert.ok(existsSync(thumb))
  assert.ok(existsSync(l.get('7')!.path))
  assert.equal(l.get('7')!.seen, false)
  l.markSeen('7')
  assert.equal(new LegacyPreviews(dir, '0.2.0').get('7')!.seen, true)
})

test('copies are keyed apart, and a missing file is not captured', () => {
  const { dir, thumb } = setup()
  const l = new LegacyPreviews(dir, '0.2.0')
  assert.equal(l.capture('7:ab', thumb), true)
  assert.equal(l.get('7:ab')!.file, '7_ab.jpg')
  assert.equal(l.capture('8', join(dir, 'nope.jpg')), false)
  assert.equal(l.count(), 1)
})

test('the user removes one, or all', () => {
  const { dir, thumb } = setup()
  const l = new LegacyPreviews(dir, '0.2.0')
  l.capture('1', thumb)
  l.capture('2', thumb)
  const path = l.get('1')!.path
  l.remove('1')
  assert.equal(existsSync(path), false)
  assert.equal(l.has('2'), true)
  assert.equal(l.removeAll(), 1)
  assert.equal(new LegacyPreviews(dir, '0.2.0').count(), 0)
})

test('a later version removes what an earlier one took', () => {
  const { dir, thumb } = setup()
  new LegacyPreviews(dir, '0.2.0').capture('1', thumb)
  assert.equal(new LegacyPreviews(dir, '0.2.0').count(), 1)
  const later = new LegacyPreviews(dir, '0.3.0')
  assert.equal(later.count(), 0)
  assert.equal(existsSync(join(dir, '1.jpg')), false)
})
