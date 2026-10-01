import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allowedWhileGated, gateFor, type GateInput } from '../src/shared/gate'
import { licenceEnforced, licenceState, type LicenceState } from '../src/shared/licence'

const base: GateInput = {
  betaBuild: true,
  skip: false,
  ready: true,
  signedIn: true,
  state: { kind: 'beta', offlineDaysLeft: 30 },
  betaOpen: undefined
}
const gate = (over: Partial<GateInput>): string => gateFor({ ...base, ...over }).kind

test('a beta build opens only with beta access (or a licence)', () => {
  assert.equal(gate({}), 'open')
  assert.equal(gate({ state: { kind: 'licensed', offlineDaysLeft: 3 } }), 'open')
  assert.equal(gate({ signedIn: false }), 'sign-in')
  assert.equal(gate({ ready: false }), 'pending')
  assert.equal(gate({ state: { kind: 'checking' } }), 'checking')
  assert.deepEqual(gateFor({ ...base, state: { kind: 'revalidate' } }), {
    kind: 'checking',
    offline: true
  })
  for (const kind of ['no-beta', 'no-trial', 'trial-ended', 'signed-out'] as const)
    assert.equal(gate({ state: { kind } as LicenceState }), 'join', kind)
  assert.equal(gate({ state: { kind: 'trial', daysLeft: 3 } }), 'join')
  assert.equal(gate({ state: { kind: 'beta-ended' } }), 'beta-ended')
  const devices = [{ id: 'd1', name: 'Old Mac (macOS)' }]
  assert.deepEqual(gateFor({ ...base, state: { kind: 'device-limit', devices } }), {
    kind: 'device-limit',
    devices
  })
})

test('the policy ends the beta for everyone, signed in or not', () => {
  assert.equal(gate({ betaOpen: false }), 'beta-ended')
  assert.equal(gate({ betaOpen: false, signedIn: false }), 'beta-ended')
  assert.equal(gate({ betaOpen: true }), 'open')
})

test('a released build, development and automation have no beta gate', () => {
  assert.equal(gate({ betaBuild: false, signedIn: false }), 'open')
  assert.equal(gate({ skip: true, signedIn: false }), 'open')
})

test('a gated window may sign in, check access, update and change settings, nothing else', () => {
  for (const ch of [
    'account:sign-in',
    'licence:refresh',
    'updates:install',
    'prefs:get',
    'app:gate'
  ])
    assert.equal(allowedWhileGated(ch), true, ch)
  for (const ch of ['library:open-folder', 'develop:open', 'export:start', 'ai:start', 'apps:x'])
    assert.equal(allowedWhileGated(ch), false, ch)
})

test('licences are enforced from 1.0.0 on, never in a beta or a 0.x', () => {
  assert.equal(licenceEnforced('1.0.0'), true)
  assert.equal(licenceEnforced('1.2.3'), true)
  assert.equal(licenceEnforced('2.0.0'), true)
  assert.equal(licenceEnforced('1.0.0-beta.4'), false)
  assert.equal(licenceEnforced('0.9.9'), false)
  assert.equal(licenceEnforced('0.1.1-beta'), false)
  assert.equal(licenceEnforced('nonsense'), false)
})

test('the server’s beta refusals become their own states', () => {
  const input = {
    signedIn: true,
    claims: null,
    expired: false,
    deviceLimit: null,
    betaBuild: true,
    now: 0
  }
  assert.equal(licenceState({ ...input, refusal: 'no_beta' }).kind, 'no-beta')
  assert.equal(licenceState({ ...input, refusal: 'beta_ended' }).kind, 'beta-ended')
  assert.equal(licenceState({ ...input, refusal: null }).kind, 'checking')
})
