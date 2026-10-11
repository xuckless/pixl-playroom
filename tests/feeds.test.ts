import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error a plain .mjs build script, without types
import { prefixFeed } from '../build/prefix-feed.mjs'

const prefix = prefixFeed as (text: string, source?: string, rollout?: number) => string

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

test('a staged rollout adds stagingPercentage at the end; a full one adds nothing', () => {
  assert.match(prefix(FEED, 'feed', 10), /\nstagingPercentage: 10\n$/)
  assert.doesNotMatch(prefix(FEED, 'feed', 100), /stagingPercentage/)
  assert.throws(() => prefix(FEED, 'feed', 101))
  assert.throws(() => prefix(FEED, 'feed', 12.5))
  assert.throws(() => prefix(prefix(FEED, 'feed', 10), 'feed', 10))
})

// @ts-expect-error a plain .mjs build script, without types
const { mergeManifests, minimumDarwin } = (await import('../build/merge-mac-channel.mjs')) as {
  mergeManifests: (m: { source: string; text: string }[], least?: string | null) => string
  minimumDarwin: (builderYaml: string) => string | null
}

const macFeed = (arch: 'x64' | 'arm64', date: string): string => `version: 0.4.0-beta
files:
  - url: pixl-playroom-mac-${arch}.zip
    sha512: ${arch}zip==
    size: 100
  - url: pixl-playroom-mac-${arch}.dmg
    sha512: ${arch}dmg==
    size: 101
path: pixl-playroom-mac-${arch}.zip
sha512: ${arch}zip==
releaseNotes: |
  Playroom in six languages.

  ## In your language

  - English, French, German.
  - url: not a file, a line of the notes
releaseDate: '${date}'
`

test('the Mac feeds merge with their release notes kept, once', () => {
  const merged = mergeManifests([
    { source: 'x64', text: macFeed('x64', '2026-10-09T22:30:52.721Z') },
    { source: 'arm64', text: macFeed('arm64', '2026-10-09T22:28:01.999Z') }
  ])
  assert.match(merged, /^ {2}- url: pixl-playroom-mac-x64\.zip$/m)
  assert.match(merged, /^ {2}- url: pixl-playroom-mac-arm64\.zip$/m)
  assert.equal(merged.match(/^ {2}- url: pixl/gm)?.length, 4)
  assert.match(
    merged,
    /\nreleaseNotes: \|\n {2}Playroom in six languages\.\n\n {2}## In your language\n\n {2}- English, French, German\.\n {2}- url: not a file, a line of the notes\nreleaseDate: '2026-10-09T22:30:52\.721Z'\n$/
  )
  // Then into the version's folder, the notes untouched.
  assert.match(prefix(merged), /\n {2}- url: not a file, a line of the notes\n/)
})

test('Mac feeds whose notes differ are refused', () => {
  assert.throws(() =>
    mergeManifests([
      { source: 'x64', text: macFeed('x64', '2026-10-09T22:30:52.721Z') },
      {
        source: 'arm64',
        text: macFeed('arm64', '2026-10-09T22:28:01.999Z').replace('six', 'seven')
      }
    ])
  )
})

test('the Mac feed states the least macOS the build opens on, as the updater reads it', async () => {
  const feeds = [
    { source: 'x64', text: macFeed('x64', '2026-10-11T10:00:00.000Z') },
    { source: 'arm64', text: macFeed('arm64', '2026-10-11T10:01:00.000Z') }
  ]
  // No minimum in the build: the feed says nothing, and every Mac takes the update.
  assert.doesNotMatch(mergeManifests(feeds), /minimumSystemVersion/)
  assert.equal(minimumDarwin('mac:\n  category: x\nwin:\n  minimumSystemVersion: 9\n'), null)
  // macOS 15 is Darwin 24: what `os.release()` reports, and what the updater compares.
  const builder =
    "appId: x\nmac:\n  category: x\n  # a note\n  minimumSystemVersion: '15.0'\nwin:\n  x: 1\n"
  assert.equal(minimumDarwin(builder), '24.0.0')
  const merged = mergeManifests(feeds, minimumDarwin(builder))
  assert.match(merged, /\nminimumSystemVersion: 24\.0\.0\n$/)
  // It survives the step that points the files into their version's folder.
  assert.match(prefix(merged), /\nminimumSystemVersion: 24\.0\.0\n/)
  // A macOS this script cannot state fails the release, rather than leave the line out.
  assert.throws(() => minimumDarwin("mac:\n  minimumSystemVersion: '99.0'\n"))
  // The app's own build file: macOS 15 or later (the owner, 2026-10-11).
  const { readFileSync } = await import('node:fs')
  const own = readFileSync(new URL('../electron-builder.yml', import.meta.url), 'utf8')
  assert.equal(minimumDarwin(own), '24.0.0')
  // electron-updater (6.8.9, `checkIfUpdateSupported`) leaves an update whose
  // `minimumSystemVersion` is above `os.release()`: macOS 13 is Darwin 22 and
  // 14 is 23, both below 24, so they keep the version they have.
})
