// The copies of Playroom the installed one has macOS forget ("Open With").
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copiesToForget } from '../src/shared/othercopies'

const HOME = '/Users/sam'
const INSTALLED = '/Applications/Pixl Playroom.app'
const copies = [
  { path: INSTALLED, version: '0.4.3-beta' },
  { path: '/Volumes/Pixl Playroom 0.4.2-beta-arm64/Pixl Playroom.app', version: '0.4.2-beta' },
  { path: '/Volumes/Pixl Playroom 0.4.3-beta-arm64/Pixl Playroom.app', version: '0.4.3-beta' },
  { path: '/Users/sam/.Trash/Pixl Playroom.app', version: '0.1.0' },
  { path: '/Users/sam/Downloads/Pixl Playroom.app', version: null },
  { path: '/Volumes/Pixl Playroom 0.5.0-arm64/Pixl Playroom.app', version: '0.5.0' }
]

test('the installed copy forgets every other copy that is no newer', () => {
  assert.deepEqual(copiesToForget(INSTALLED, '0.4.3-beta', HOME, copies), [
    '/Volumes/Pixl Playroom 0.4.2-beta-arm64/Pixl Playroom.app',
    '/Volumes/Pixl Playroom 0.4.3-beta-arm64/Pixl Playroom.app',
    '/Users/sam/.Trash/Pixl Playroom.app',
    '/Users/sam/Downloads/Pixl Playroom.app'
  ])
})

test('it never forgets itself, however macOS spells its path', () => {
  const spelled = [{ path: '/applications/Pixl Playroom.app/', version: '0.4.3-beta' }]
  assert.deepEqual(copiesToForget(INSTALLED, '0.4.3-beta', HOME, spelled), [])
})

test('the user’s own Applications folder counts as installed', () => {
  const own = `${HOME}/Applications/Pixl Playroom.app`
  assert.deepEqual(copiesToForget(own, '0.4.3-beta', HOME, copies.slice(3, 4)), [
    '/Users/sam/.Trash/Pixl Playroom.app'
  ])
})

test('a copy started from anywhere else leaves the menu alone', () => {
  for (const self of [
    '/Volumes/Pixl Playroom 0.5.0-arm64/Pixl Playroom.app',
    '/Users/sam/Downloads/Pixl Playroom.app',
    '/Users/sam/code/pixl-playroom/dist/mac-arm64/Pixl Playroom.app',
    '/Applications/Tools/Pixl Playroom.app'
  ])
    assert.deepEqual(copiesToForget(self, '0.5.0', HOME, copies), [])
})
