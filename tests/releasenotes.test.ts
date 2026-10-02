import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  latestNotes,
  notesToShow,
  RELEASE_NOTES,
  versionLabel,
  type ReleaseNotes
} from '../src/shared/releasenotes'
import { compareVersions } from '../src/shared/policy'

const n = (version: string): ReleaseNotes => ({ version, headline: version, sections: [] })
const notes = [n('0.3.0-beta'), n('0.2.0-beta.1'), n('0.2.0-beta')]
const versions = (list: ReleaseNotes[]): string[] => list.map((x) => x.version)

test('an update shows what came since the notes last seen, newest first', () => {
  assert.deepEqual(versions(notesToShow('0.3.0-beta', '0.2.0-beta', true, notes)), [
    '0.3.0-beta',
    '0.2.0-beta.1'
  ])
  assert.deepEqual(versions(notesToShow('0.2.0-beta.1', '0.2.0-beta', true, notes)), [
    '0.2.0-beta.1'
  ])
})

test('notes are shown once, and never ahead of the build', () => {
  assert.deepEqual(notesToShow('0.3.0-beta', '0.3.0-beta', true, notes), [])
  // Notes written for the next release are not this build's to show.
  assert.deepEqual(notesToShow('0.1.1-beta.1', '0.1.1-beta', true, notes), [])
})

test('an install from before the popup shows the newest notes; a fresh one shows none', () => {
  assert.deepEqual(versions(notesToShow('0.3.0-beta', null, true, notes)), ['0.3.0-beta'])
  assert.deepEqual(notesToShow('0.3.0-beta', null, false, notes), [])
})

test("Settings shows this build's notes", () => {
  assert.equal(latestNotes('0.2.0-beta.3', notes)?.version, '0.2.0-beta.1')
  assert.equal(latestNotes('0.1.1-beta.1', notes), null)
})

test('versions read as people say them', () => {
  assert.equal(versionLabel('0.2.0-beta'), '0.2.0 beta')
  assert.equal(versionLabel('0.2.0-beta.3'), '0.2.0 beta 3')
  assert.equal(versionLabel('1.0.0'), '1.0.0')
})

test('the notes are newest first, each a version, with something to say', () => {
  for (let i = 1; i < RELEASE_NOTES.length; i++)
    assert.ok(compareVersions(RELEASE_NOTES[i - 1].version, RELEASE_NOTES[i].version) > 0)
  for (const r of RELEASE_NOTES) {
    assert.match(r.version, /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/)
    assert.ok(r.headline && r.sections.every((s) => s.items.length > 0))
  }
})
