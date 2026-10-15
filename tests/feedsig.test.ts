import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, type KeyObject } from 'node:crypto'
import { createRequire } from 'node:module'
import { checkFeed, FEED_KEYS, type FeedInfo } from '../src/main/feedsig'
import {
  feedClaims,
  feedKeys,
  kidOf,
  signFeed,
  verifyFeed,
  withSignature
} from '../scripts/feed-sign.mjs'
import { setStaging } from '../scripts/rollout.mjs'

// The feed as electron-updater reads it: through its own YAML parser.
const require = createRequire(import.meta.url)
const yaml = createRequire(require.resolve('electron-updater'))('js-yaml') as {
  load(text: string): unknown
}
const parse = (text: string): FeedInfo => yaml.load(text) as FeedInfo

/** A feed as release.yml publishes it (prefix-feed.mjs's urls, the notes as a block). */
const FEED = `version: 0.6.0-beta
files:
  - url: 0.6.0-beta/pixl-playroom-win-x64-setup.exe
    sha512: 3q2+7w0LAoc/AbCdEf==
    size: 123456
    isAdminRightsRequired: false
path: 0.6.0-beta/pixl-playroom-win-x64-setup.exe
sha512: 3q2+7w0LAoc/AbCdEf==
releaseDate: '2026-10-14T12:00:00.000Z'
releaseNotes: |
  ## What's new
    - url: not-a-file.exe
  More text
`

const MAC = `version: 0.6.0-beta
files:
  - url: 0.6.0-beta/pixl-playroom-mac-arm64.zip
    sha512: armSHA==
    size: 1
  - url: 0.6.0-beta/pixl-playroom-mac-x64.zip
    sha512: x64SHA==
    size: 2
    blockMapSize: 3
path: 0.6.0-beta/pixl-playroom-mac-arm64.zip
sha512: armSHA==
releaseDate: '2026-10-14T12:00:00.000Z'
`

function keyPair(): { privateKey: KeyObject; raw: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return { privateKey, raw: publicKey.export({ format: 'jwk' }).x as string }
}

test('a feed’s claims are its version and files, never a line of its notes', () => {
  assert.deepEqual(feedClaims(FEED), {
    version: '0.6.0-beta',
    files: [{ url: '0.6.0-beta/pixl-playroom-win-x64-setup.exe', sha512: '3q2+7w0LAoc/AbCdEf==' }]
  })
  assert.equal(feedClaims(MAC).files.length, 2)
  assert.throws(() => feedClaims('version: 1.0.0\n'), /no files/)
})

test('a feed signed at release passes the app’s check, as electron-updater parses it', () => {
  const { privateKey, raw } = keyPair()
  const keys = { 'feed-1': raw }
  for (const text of [FEED, MAC]) {
    const signed = signFeed(text, privateKey, 'feed-1')
    assert.deepEqual(checkFeed(parse(signed), keys), { ok: true, kid: 'feed-1' })
    assert.equal(verifyFeed(signed, keys).kid, 'feed-1')
    // The notes are untouched; signing again keeps one signature.
    assert.equal(parse(signed).releaseNotes, parse(text).releaseNotes)
    const twice = signFeed(signed, privateKey, 'feed-1')
    assert.equal(twice.match(/^pixlSignature:/gm)?.length, 1)
    // A staged rollout changes the percentage without the key.
    const staged = setStaging(signed, 20)
    assert.equal(parse(staged).stagingPercentage, 20)
    assert.deepEqual(checkFeed(parse(staged), keys), { ok: true, kid: 'feed-1' })
  }
})

test('an unsigned, foreign, altered or reused feed is refused', () => {
  const { privateKey, raw } = keyPair()
  const other = keyPair()
  const keys = { 'feed-1': raw }
  const signed = signFeed(FEED, privateKey, 'feed-1')
  assert.deepEqual(checkFeed(parse(FEED), keys), { ok: false, problem: 'unsigned' })
  // Signed by a key the app does not hold, under its kid or another.
  assert.equal(checkFeed(parse(signFeed(FEED, other.privateKey, 'feed-1')), keys).ok, false)
  assert.deepEqual(checkFeed(parse(signFeed(FEED, other.privateKey, 'feed-9')), keys), {
    ok: false,
    problem: 'unknown-key'
  })
  // Another installer under the signature (the attack: a written bucket).
  const swapped = signed.replaceAll('3q2+7w0LAoc/AbCdEf==', 'ATTACKER==')
  assert.deepEqual(checkFeed(parse(swapped), keys), { ok: false, problem: 'files' })
  const moved = signed.replace(
    '  - url: 0.6.0-beta/pixl-playroom-win-x64-setup.exe',
    '  - url: https://attacker.example/setup.exe'
  )
  assert.deepEqual(checkFeed(parse(moved), keys), { ok: false, problem: 'files' })
  const extra = signed.replace(
    'path: ',
    '  - url: 0.6.0-beta/more.exe\n    sha512: more==\n    size: 1\npath: '
  )
  assert.deepEqual(checkFeed(parse(extra), keys), { ok: false, problem: 'files' })
  // An old release's signature on a newer version's feed.
  const replayed = withSignature(
    FEED.replace('version: 0.6.0-beta', 'version: 0.7.0-beta'),
    /^pixlSignature: (\S+)$/m.exec(signed)![1]
  )
  assert.deepEqual(checkFeed(parse(replayed), keys), { ok: false, problem: 'version' })
  assert.throws(() => verifyFeed(swapped, keys), /other files/)
  // A JWS of another kind, by a feed key, is still not a feed signature.
  const notFeed = signed.replace(/^pixlSignature: .*$/m, 'pixlSignature: a.b.c')
  assert.equal(checkFeed(parse(notFeed), keys).ok, false)
})

test('the signing key is named by the app’s own FEED_KEYS, and none is built in yet', () => {
  const { privateKey, raw } = keyPair()
  assert.equal(kidOf(privateKey, { 'feed-1': raw }), 'feed-1')
  assert.equal(kidOf(privateKey, { 'feed-1': keyPair().raw }), null)
  // The script reads FEED_KEYS out of src/main/feedsig.ts: the same keys the app holds.
  assert.deepEqual(feedKeys(), FEED_KEYS)
  assert.deepEqual(
    feedKeys(`export const FEED_KEYS: EntitlementKeys = {\n  'feed-1': '${raw}'\n}`),
    { 'feed-1': raw }
  )
})
