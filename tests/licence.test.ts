import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  activate,
  allows,
  lockedReason,
  deactivate,
  dueForValidation,
  keyHint,
  LicenceError,
  LicenceServer,
  licenceState,
  licenceStatus,
  validate,
  type Fetch,
  type LicenceFile
} from '../src/shared/licence'

const KEY = '38b1460a-5104-4067-a91d-77b872934d51'
const DAY = 24 * 60 * 60 * 1000
const at = (days: number): Date => new Date(Date.UTC(2026, 9, 1) + days * DAY)

/** Lemon Squeezy's licence API in miniature: one key, a limit of three, instances by id. */
function fakeLemonSqueezy(opts: { limit?: number; productId?: number } = {}): {
  fetch: Fetch
  instances: Map<string, string>
  offline: { on: boolean }
} {
  const limit = opts.limit ?? 3
  const instances = new Map<string, string>()
  const offline = { on: false }
  let next = 1
  const meta = {
    store_id: 1,
    product_id: opts.productId ?? 4,
    customer_name: 'Sam Doe',
    customer_email: 'sam@example.com'
  }
  const keyInfo = (): object => ({
    status: 'active',
    key: KEY,
    activation_limit: limit,
    activation_usage: instances.size
  })
  const json = (body: object, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const fetch: Fetch = async (url, init) => {
    if (offline.on) throw new TypeError('fetch failed')
    const p = new URLSearchParams(String(init.body))
    const op = url.split('/').pop()
    if (p.get('license_key') !== KEY)
      return json({ error: 'license_key not found.', license_key: null, meta: null }, 404)
    if (op === 'activate') {
      if (instances.size >= limit)
        return json(
          {
            activated: false,
            error: 'This license key has reached the activation limit.',
            license_key: keyInfo(),
            meta
          },
          400
        )
      const id = `inst-${next++}`
      instances.set(id, p.get('instance_name') ?? '')
      return json({
        activated: true,
        error: null,
        license_key: keyInfo(),
        instance: { id, name: instances.get(id) },
        meta
      })
    }
    const id = p.get('instance_id') ?? ''
    if (op === 'validate') {
      if (!instances.has(id))
        return json(
          {
            valid: false,
            error: 'license_key instance not found.',
            license_key: null,
            instance: null,
            meta: null
          },
          404
        )
      return json({
        valid: true,
        error: null,
        license_key: keyInfo(),
        instance: { id, name: instances.get(id) },
        meta
      })
    }
    if (op === 'deactivate') {
      if (!instances.delete(id))
        return json({ deactivated: false, error: 'license_key instance not found.' }, 404)
      return json({ deactivated: true, error: null, license_key: keyInfo(), meta })
    }
    return json({ error: 'unknown' }, 404)
  }
  return { fetch, instances, offline }
}

test('the trial counts down from the first launch, then ends', () => {
  const file: LicenceFile = { trialStartedAt: at(0).toISOString() }
  assert.deepEqual(licenceState(file, at(0)), { kind: 'trial', daysLeft: 14 })
  assert.deepEqual(licenceState(file, at(3.5)), { kind: 'trial', daysLeft: 11 })
  assert.deepEqual(licenceState(file, at(13.9)), { kind: 'trial', daysLeft: 1 })
  assert.deepEqual(licenceState(file, at(14)), { kind: 'trial-ended' })
})

test('nothing is gated while licensing is not enforced', () => {
  assert.equal(allows({ kind: 'trial-ended' }, 'export'), true)
  assert.equal(allows({ kind: 'revalidate' }, 'export'), true)
  assert.equal(lockedReason({ kind: 'trial-ended' }), null)
})

test('enforced, a lapsed licence locks exporting, with the reason', () => {
  assert.equal(allows({ kind: 'trial-ended' }, 'export', true), false)
  assert.equal(allows({ kind: 'revalidate' }, 'export', true), false)
  assert.equal(allows({ kind: 'inactive', reason: 'Refunded.' }, 'export', true), false)
  assert.equal(allows({ kind: 'trial', daysLeft: 2 }, 'export', true), true)
  assert.equal(allows({ kind: 'licensed', offlineDaysLeft: 3 }, 'export', true), true)
  assert.match(lockedReason({ kind: 'trial-ended' }, true) ?? '', /trial has ended/)
  assert.match(lockedReason({ kind: 'revalidate' }, true) ?? '', /confirm your licence/)
  assert.match(lockedReason({ kind: 'inactive', reason: 'Refunded.' }, true) ?? '', /Refunded/)
  assert.equal(lockedReason({ kind: 'licensed', offlineDaysLeft: 3 }, true), null)
})

test('activating a key licenses this device and records the customer', async () => {
  const ls = fakeLemonSqueezy()
  const server = new LicenceServer('https://ls.test/v1/licenses', ls.fetch)
  const file = await activate(
    { trialStartedAt: at(-20).toISOString() },
    ` ${KEY} `,
    'Studio Mac',
    server,
    at(0)
  )
  assert.equal(file.licence?.status, 'active')
  assert.equal(file.licence?.customerName, 'Sam Doe')
  assert.deepEqual(licenceState(file, at(0)), { kind: 'licensed', offlineDaysLeft: 30 })
  const s = licenceStatus(file, at(0), true)
  assert.equal(s.devicesUsed, 1)
  assert.equal(s.deviceLimit, 3)
  assert.equal(s.keyHint, '…4d51')
  assert.equal(keyHint(KEY), '…4d51')
})

test('a fourth device is refused; freeing one lets it in', async () => {
  const ls = fakeLemonSqueezy()
  const server = new LicenceServer('https://ls.test/v1/licenses', ls.fetch)
  const devices = await Promise.all(['A', 'B', 'C'].map((n) => activate({}, KEY, n, server, at(0))))
  assert.equal(ls.instances.size, 3)
  await assert.rejects(activate({}, KEY, 'D', server, at(0)), (err: LicenceError) => {
    assert.equal(err.code, 'rejected')
    assert.match(err.message, /already active on 3 devices/)
    return true
  })
  const freed = await deactivate(devices[0], server)
  assert.equal(freed.licence, undefined)
  assert.equal(ls.instances.size, 2)
  const d = await activate({}, KEY, 'D', server, at(0))
  assert.equal(d.licence?.status, 'active')
  assert.equal(ls.instances.size, 3)
})

test('an unknown key is refused in plain words', async () => {
  const server = new LicenceServer('https://ls.test/v1/licenses', fakeLemonSqueezy().fetch)
  await assert.rejects(activate({}, 'not-a-key', 'A', server, at(0)), /wasn't recognised/)
  await assert.rejects(activate({}, '  ', 'A', server, at(0)), /Enter a licence key/)
})

test('offline, a licence holds for the grace period, then asks to reconnect', async () => {
  const ls = fakeLemonSqueezy()
  const server = new LicenceServer('https://ls.test/v1/licenses', ls.fetch)
  const file = await activate({}, KEY, 'A', server, at(0))
  ls.offline.on = true
  const same = await validate(file, server, at(29))
  assert.equal(same, file, 'offline changes nothing')
  assert.deepEqual(licenceState(same, at(29)), { kind: 'licensed', offlineDaysLeft: 1 })
  assert.deepEqual(licenceState(same, at(31)), { kind: 'revalidate' })
  ls.offline.on = false
  const back = await validate(same, server, at(31))
  assert.deepEqual(licenceState(back, at(31)), { kind: 'licensed', offlineDaysLeft: 30 })
})

test('a device deactivated elsewhere turns inactive on its next check', async () => {
  const ls = fakeLemonSqueezy()
  const server = new LicenceServer('https://ls.test/v1/licenses', ls.fetch)
  const file = await activate({}, KEY, 'A', server, at(0))
  ls.instances.clear()
  const after = await validate(file, server, at(2))
  assert.equal(licenceState(after, at(2)).kind, 'inactive')
  assert.equal(dueForValidation(after, at(5)), false, 'an inactive licence is not re-checked')
})

test('a launch re-checks the licence at most once a day', async () => {
  const server = new LicenceServer('https://ls.test/v1/licenses', fakeLemonSqueezy().fetch)
  const file = await activate({}, KEY, 'A', server, at(0))
  assert.equal(dueForValidation(file, at(0.5)), false)
  assert.equal(dueForValidation(file, at(1)), true)
  assert.equal(dueForValidation({}, at(5)), false)
})

test('deactivating offline keeps the licence and says why', async () => {
  const ls = fakeLemonSqueezy()
  const server = new LicenceServer('https://ls.test/v1/licenses', ls.fetch)
  const file = await activate({}, KEY, 'A', server, at(0))
  ls.offline.on = true
  await assert.rejects(deactivate(file, server), (err: LicenceError) => err.code === 'network')
  assert.equal(ls.instances.size, 1)
})
