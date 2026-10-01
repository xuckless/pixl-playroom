import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error a plain .mjs build script, without types
import { prefixFeed } from '../build/prefix-feed.mjs'

const prefix = prefixFeed as (text: string, source?: string) => string

const FEED = `version: 0.3.0-beta.2
files:
  - url: pixl-playroom-win-x64-setup.exe
    sha512: abc==
    size: 123
path: pixl-playroom-win-x64-setup.exe
sha512: abc==
releaseDate: '2026-10-01T12:00:00.000Z'
`

test('a feed’s files point into their version’s folder, and nothing else changes', () => {
  assert.equal(
    prefix(FEED),
    FEED.replace('  - url: pixl', '  - url: 0.3.0-beta.2/pixl').replace(
      'path: pixl',
      'path: 0.3.0-beta.2/pixl'
    )
  )
})

test('a feed that isn’t the shape electron-builder writes is refused', () => {
  assert.throws(() => prefix(FEED.replace('version: 0.3.0-beta.2', 'version: latest')))
  assert.throws(() => prefix(FEED.replace(/^version:.*\n/, '')))
  assert.throws(() => prefix(FEED.replaceAll('pixl-playroom-win', '../pixl-playroom-win')))
  assert.throws(() => prefix(FEED.replaceAll('pixl-playroom-win', 'https://evil.example/x')))
  assert.throws(() => prefix(FEED.replace(/^path:.*\n/m, '')))
  assert.throws(() => prefix('version: 0.3.0\nfiles:\npath: x.exe\n'))
})
