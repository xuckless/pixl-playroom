import { test } from 'node:test'
import assert from 'node:assert/strict'
import { belowFloor, compareVersions, downloadUrl, parsePolicy } from '../src/shared/policy'
// @ts-expect-error a plain .mjs script, without types
import { readStaging, setStaging } from '../scripts/rollout.mjs'

test('versions sort as semver: a prerelease before its release, numbers as numbers', () => {
  const ordered = [
    '0.1.1-beta',
    '0.1.1-beta.1',
    '0.1.1-beta.2',
    '0.1.1-beta.10',
    '0.1.1',
    '0.2.0-alpha.1',
    '0.2.0-beta',
    '0.2.0',
    '0.10.0',
    '1.0.0-beta.1',
    '1.0.0'
  ]
  for (let i = 0; i < ordered.length; i++)
    for (let j = 0; j < ordered.length; j++)
      assert.equal(
        Math.sign(compareVersions(ordered[i], ordered[j])),
        Math.sign(i - j),
        `${ordered[i]} vs ${ordered[j]}`
      )
  assert.equal(compareVersions('nonsense', '0.0.1'), -1)
})

test('the floor holds back only versions below it', () => {
  assert.equal(belowFloor('0.1.1-beta', { minVersion: '0.2.0' }), true)
  assert.equal(belowFloor('0.2.0-beta.3', { minVersion: '0.2.0' }), true)
  assert.equal(belowFloor('0.2.0', { minVersion: '0.2.0' }), false)
  assert.equal(belowFloor('0.3.0', { minVersion: '0.2.0' }), false)
  assert.equal(belowFloor('0.1.0', {}), false)
})

test('a policy file is read field by field, and anything malformed is left out', () => {
  assert.deepEqual(
    parsePolicy({ minVersion: '0.2.0', betaOpen: false, message: ' Fixes a bug. ' }),
    {
      minVersion: '0.2.0',
      betaOpen: false,
      message: 'Fixes a bug.'
    }
  )
  assert.deepEqual(parsePolicy({ minVersion: 'latest', betaOpen: 'no', message: '  ' }), {})
  assert.deepEqual(parsePolicy(null), {})
  assert.deepEqual(parsePolicy('0.2.0'), {})
  assert.equal(parsePolicy({ message: 'x'.repeat(2000) }).message?.length, 500)
})

test('the download link names the platform, and the beta feed when asked', () => {
  assert.equal(
    downloadUrl('darwin', 'arm64', 'latest'),
    'https://playroom.pixlfoundation.com/download/mac-arm64'
  )
  assert.equal(
    downloadUrl('win32', 'x64', 'beta'),
    'https://playroom.pixlfoundation.com/download/win-x64?channel=beta'
  )
})

test('a rollout percentage is set, changed and cleared in a live feed', () => {
  const feed = 'version: 0.2.0\nfiles:\n  - url: 0.2.0/a.exe\npath: 0.2.0/a.exe\n'
  const staged = setStaging(feed, 25)
  assert.equal(readStaging(staged), 25)
  assert.match(staged, /\nstagingPercentage: 25\n$/)
  assert.equal(readStaging(setStaging(staged, 0)), 0)
  assert.equal(setStaging(staged, 100), feed)
  assert.equal(readStaging(feed), 100)
})
