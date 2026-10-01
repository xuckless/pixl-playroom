import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import type {
  AccountDevice,
  DeviceInfo,
  EntitlementClaims,
  EntitlementResponse
} from '../src/shared/account'
import {
  allows,
  licenceState,
  licenceStatus,
  lockedReason,
  type LicenceInput
} from '../src/shared/licence'
import { Access, type AccessFile, type AccessServer } from '../src/main/account/access'
import { AccountApi, AccountError } from '../src/main/account/api'
import { checkKeyset } from '../src/main/account/entitlement'
import { OAuthError, type Fetch } from '../src/main/account/oauth'

const DAY_S = 24 * 60 * 60
const T0 = 1_790_000_000

// ── the rules ──

function claims(
  ent: EntitlementClaims['ent'],
  over: Partial<EntitlementClaims> = {}
): EntitlementClaims {
  return {
    iss: 'pixlfoundation.com',
    sub: 'user-1',
    aud: 'playroom',
    dev: 'dev-hash',
    iat: T0,
    exp: T0 + 30 * DAY_S,
    rfa: T0 + DAY_S,
    ...over,
    ent
  }
}

const input = (over: Partial<LicenceInput>): LicenceInput => ({
  signedIn: true,
  claims: null,
  expired: false,
  deviceLimit: null,
  betaBuild: false,
  now: T0 + 60,
  ...over
})

test('the state follows the account: signed out, checking, no trial, a trial, a licence', () => {
  assert.deepEqual(licenceState(input({ signedIn: false })), { kind: 'signed-out' })
  assert.deepEqual(licenceState(input({})), { kind: 'checking' })
  assert.deepEqual(licenceState(input({ expired: true })), { kind: 'revalidate' })
  assert.deepEqual(licenceState(input({ claims: claims({ addons: [] }) })), { kind: 'no-trial' })
  assert.deepEqual(
    licenceState(input({ claims: claims({ trial: { until: T0 + 10 * DAY_S }, addons: [] }) })),
    { kind: 'trial', daysLeft: 10 }
  )
  assert.deepEqual(licenceState(input({ claims: claims({ trial: { until: T0 }, addons: [] }) })), {
    kind: 'trial-ended'
  })
  assert.deepEqual(
    licenceState(
      input({ claims: claims({ trial: { until: T0 }, licence: { since: T0 }, addons: [] }) })
    ),
    { kind: 'licensed', offlineDaysLeft: 29 }
  )
  const devices: AccountDevice[] = [{ id: 'd1', name: 'Studio (macOS)' }]
  assert.deepEqual(licenceState(input({ deviceLimit: devices })), {
    kind: 'device-limit',
    devices
  })
})

test('beta access counts only in a beta build, and only until it ends', () => {
  const beta = (until?: number): EntitlementClaims => claims({ beta: { until }, addons: [] })
  assert.equal(licenceState(input({ betaBuild: true, claims: beta() })).kind, 'beta')
  assert.equal(licenceState(input({ betaBuild: false, claims: beta() })).kind, 'no-trial')
  assert.equal(licenceState(input({ betaBuild: true, claims: beta(T0) })).kind, 'no-trial')
  assert.equal(licenceState(input({ betaBuild: true, claims: beta(T0 + DAY_S) })).kind, 'beta')
})

test('nothing is locked until licences are enforced; then only a trial, a licence or the beta export', () => {
  for (const kind of ['signed-out', 'checking', 'no-trial', 'trial-ended', 'revalidate'] as const) {
    assert.equal(allows({ kind }, 'export', false), true)
    assert.equal(allows({ kind }, 'export', true), false)
    assert.ok(lockedReason({ kind }, true))
  }
  assert.equal(allows({ kind: 'device-limit', devices: [] }, 'export', true), false)
  assert.equal(allows({ kind: 'trial', daysLeft: 3 }, 'export', true), true)
  assert.equal(allows({ kind: 'licensed', offlineDaysLeft: 3 }, 'export', true), true)
  assert.equal(allows({ kind: 'beta', offlineDaysLeft: 3 }, 'export', true), true)
  assert.equal(lockedReason({ kind: 'trial-ended' }, false), null)
  const s = licenceStatus(
    input({ claims: claims({ addons: [] }, { discount: { code: 'TESTER', expires: T0 } }) }),
    false,
    true
  )
  assert.deepEqual(s.discount, { code: 'TESTER', expires: T0 })
  assert.equal(s.confirmedAt, T0 * 1000)
  assert.equal(s.visible, true) // enforced: always shown
})

// ── the account API ──

interface Seen {
  method: string
  url: string
  auth: string | null
  body: Record<string, unknown> | null
}

function fakeFetch(answers: Response[]): { fetch: Fetch; seen: Seen[] } {
  const seen: Seen[] = []
  return {
    seen,
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const h = new Headers(init?.headers)
      seen.push({
        method: init?.method ?? 'GET',
        url: String(input),
        auth: h.get('Authorization'),
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
      })
      const r = answers.shift()
      if (!r) throw new TypeError('fetch failed')
      return r
    }) as Fetch
  }
}

const reply = (status: number, body?: object, headers: Record<string, string> = {}): Response =>
  new Response(body ? JSON.stringify(body) : null, {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  })

const DEVICE: DeviceInfo = { deviceHash: 'dev-hash', deviceName: 'Studio (macOS)', os: 'macos' }

function apiWith(answers: Response[]): { api: AccountApi; seen: Seen[]; refreshed: () => number } {
  const f = fakeFetch(answers)
  let refreshes = 0
  const api = new AccountApi({
    base: 'https://pixlfoundation.com/api',
    product: 'playroom',
    appVersion: '0.2.0-beta.1',
    fetch: f.fetch,
    accessToken: async () => 'access-1',
    refreshAccess: async () => `access-${2 + refreshes++}`
  })
  return { api, seen: f.seen, refreshed: () => refreshes }
}

test('the API sends the device and the bearer, and refreshes once on a 401', async () => {
  const ok = { token: 't', keyset: 'k' }
  const a = apiWith([reply(200, ok)])
  assert.deepEqual(await a.api.entitlements(DEVICE), ok)
  assert.deepEqual(a.seen[0], {
    method: 'POST',
    url: 'https://pixlfoundation.com/api/entitlements',
    auth: 'Bearer access-1',
    body: { product: 'playroom', ...DEVICE, appVersion: '0.2.0-beta.1' }
  })

  const b = apiWith([reply(401, { error: 'auth' }), reply(200, ok)])
  assert.deepEqual(await b.api.startTrial(DEVICE), ok)
  assert.equal(b.seen[1].url, 'https://pixlfoundation.com/api/trials')
  assert.equal(b.seen[1].auth, 'Bearer access-2')

  const c = apiWith([reply(401, { error: 'auth' }), reply(401, { error: 'auth' })])
  await assert.rejects(c.api.entitlements(DEVICE), (e) => (e as AccountError).code === 'auth')
  assert.equal(c.refreshed(), 1)
})

test('the API’s refusals carry their code, and what comes with it', async () => {
  const devices = [{ id: 'd1', name: 'A' }]
  const a = apiWith([reply(403, { error: 'device_limit', devices })])
  await assert.rejects(a.api.entitlements(DEVICE), (e) => {
    const err = e as AccountError
    return err.code === 'device_limit' && err.devices?.[0].id === 'd1'
  })
  const b = apiWith([reply(429, { error: 'too_many' }, { 'Retry-After': '30' })])
  await assert.rejects(b.api.entitlements(DEVICE), (e) => (e as AccountError).retryAfter === 30)
  for (const code of [
    'trial_used_account',
    'trial_used_device',
    'no_beta',
    'beta_ended',
    'wrong_client'
  ]) {
    const c = apiWith([reply(409, { error: code })])
    await assert.rejects(c.api.startTrial(DEVICE), (e) => (e as AccountError).code === code)
  }
  const d = apiWith([reply(502)])
  await assert.rejects(d.api.entitlements(DEVICE), (e) => (e as AccountError).code === 'network')
  const e = apiWith([])
  await assert.rejects(e.api.entitlements(DEVICE), (x) => (x as AccountError).code === 'network')
  const f = apiWith([reply(200, { token: 't' })])
  await assert.rejects(f.api.entitlements(DEVICE), (x) => (x as AccountError).code === 'network')
  const g = apiWith([reply(204)])
  await g.api.freeDevice('d 1')
  assert.equal(g.seen[0].method, 'DELETE')
  assert.equal(g.seen[0].url, 'https://pixlfoundation.com/api/devices/d%201')
})

// ── keys ──

function keypair(): { priv: KeyObject; raw: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return { priv: privateKey, raw: publicKey.export({ format: 'jwk' }).x as string }
}

function jws(header: object, payload: object, priv: KeyObject): string {
  const enc = (o: object): string => Buffer.from(JSON.stringify(o)).toString('base64url')
  const data = `${enc(header)}.${enc(payload)}`
  return `${data}.${sign(null, Buffer.from(data), priv).toString('base64url')}`
}

const keyset = (
  root: KeyObject,
  keys: Record<string, string>,
  iat: number,
  rootKid = 'root-1'
): string =>
  jws(
    { alg: 'EdDSA', kid: rootKid, typ: 'pixl-keyset' },
    { iss: 'pixlfoundation.com', keys, iat },
    root
  )

test('a key set counts when a root signed it and it isn’t older than one already seen', () => {
  const root = keypair()
  const roots = { 'root-1': root.raw }
  const signer = keypair()
  const good = checkKeyset(keyset(root.priv, { 'ent-1': signer.raw }, T0), roots)
  assert.deepEqual(good, { ok: true, keys: { 'ent-1': signer.raw }, iat: T0 })
  assert.deepEqual(checkKeyset(keyset(root.priv, { 'ent-1': signer.raw }, T0), roots, T0 + 1), {
    ok: false,
    problem: 'stale'
  })
  // Signed by the signing key rather than a root.
  assert.equal(
    (
      checkKeyset(keyset(signer.priv, { 'ent-1': signer.raw }, T0, 'ent-1'), roots) as {
        problem: string
      }
    ).problem,
    'unknown-key'
  )
  const forged = keyset(keypair().priv, { 'ent-1': signer.raw }, T0)
  assert.equal((checkKeyset(forged, roots) as { problem: string }).problem, 'signature')
  // A token, even one a root signed, isn't a key set.
  const asToken = jws(
    { alg: 'EdDSA', kid: 'root-1', typ: 'JWT' },
    { iss: 'pixlfoundation.com', keys: {}, iat: T0 },
    root.priv
  )
  assert.equal((checkKeyset(asToken, roots) as { problem: string }).problem, 'malformed')
  // A signing key can't take a root's name.
  assert.equal(
    (checkKeyset(keyset(root.priv, { 'root-1': signer.raw }, T0), roots) as { problem: string })
      .problem,
    'malformed'
  )
  assert.equal(
    (checkKeyset(keyset(root.priv, { 'ent-1': 'short' }, T0), roots) as { problem: string })
      .problem,
    'malformed'
  )
})

// ── access: the token, fetched, kept and checked ──

interface FakeWorker {
  ent: EntitlementClaims['ent']
  nowS: number
  refuse: AccountError | OAuthError | null
  calls: string[]
  keysetOf(): string
  rotate(): void
  answer(device: DeviceInfo): EntitlementResponse
  server: AccessServer
}

/** The Worker in miniature: signs what it's told the account holds. */
function fakeWorker(root: { priv: KeyObject }): FakeWorker {
  let signer = { kid: 'ent-1', ...keypair() }
  let keysetIat = T0
  const w: FakeWorker = {
    ent: { addons: [] },
    nowS: T0,
    refuse: null,
    calls: [],
    keysetOf: () => keyset(root.priv, { [signer.kid]: signer.raw }, keysetIat),
    rotate(): void {
      signer = { kid: `ent-${keysetIat - T0 + 2}`, ...keypair() }
      keysetIat += 1
    },
    answer(device: DeviceInfo): EntitlementResponse {
      const c = claims(w.ent, {
        dev: device.deviceHash,
        iat: w.nowS,
        exp: w.nowS + 30 * DAY_S,
        rfa: w.nowS + DAY_S
      })
      return {
        token: jws({ alg: 'EdDSA', kid: signer.kid, typ: 'JWT' }, c, signer.priv),
        keyset: w.keysetOf()
      }
    },
    server: {
      entitlements: async (d: DeviceInfo) => {
        w.calls.push('entitlements')
        if (w.refuse) throw w.refuse
        return w.answer(d)
      },
      startTrial: async (d: DeviceInfo) => {
        w.calls.push('trial')
        if (w.refuse) throw w.refuse
        w.ent = { ...w.ent, trial: { until: w.nowS + 14 * DAY_S } }
        return w.answer(d)
      },
      freeDevice: async (id: string) => {
        w.calls.push(`free ${id}`)
        w.refuse = null
      }
    }
  }
  return w
}

function setup(): {
  access: Access
  worker: FakeWorker
  file: () => AccessFile
  setFile: (f: AccessFile) => void
  clock: { ms: number }
  account: { signedIn: boolean }
} {
  const root = keypair()
  const worker = fakeWorker(root)
  let file: AccessFile = {}
  const clock = { ms: (T0 + 60) * 1000 }
  const account = { signedIn: true }
  const access = new Access({
    load: () => file,
    save: (f) => (file = f),
    server: worker.server,
    device: async () => DEVICE,
    roots: { 'root-1': root.raw },
    product: 'playroom',
    betaBuild: false,
    signedIn: () => account.signedIn,
    now: () => clock.ms,
    onChange: () => {}
  })
  return { access, worker, file: () => file, setFile: (f) => (file = f), clock, account }
}

test('starting the trial, refreshing when due, and the month offline', async () => {
  const { access, worker, file, clock } = setup()
  await access.ready()
  assert.equal(access.status(true).state.kind, 'checking')
  assert.equal(access.due(), true)
  await access.refresh()
  assert.equal(access.status(true).state.kind, 'no-trial')
  assert.equal(access.due(), false)
  await access.startTrial()
  assert.deepEqual(access.status(true).state, { kind: 'trial', daysLeft: 14 })
  // A day on, it wants a refresh; offline, the token still stands.
  clock.ms += 2 * DAY_S * 1000
  assert.equal(access.due(), true)
  worker.refuse = new AccountError('offline', 'network')
  await assert.rejects(access.refresh())
  assert.equal(access.status(true).state.kind, 'trial')
  // Past the month's grace: confirm online.
  clock.ms += 30 * DAY_S * 1000
  assert.equal(access.status(true).state.kind, 'revalidate')
  // Turning the clock back after a launch saw the late date doesn't help.
  access.touch()
  clock.ms -= 30 * DAY_S * 1000
  assert.equal(access.status(true).state.kind, 'revalidate')
  assert.ok((file().seenAt ?? 0) > clock.ms)
})

test('editing the token or the key set grants nothing', async () => {
  const { access, file, setFile } = setup()
  await access.ready()
  await access.refresh()
  const f = file()
  const [h, , s] = (f.token ?? '').split('.')
  const forged = Buffer.from(
    JSON.stringify(claims({ licence: { since: T0 }, addons: [] }, { dev: DEVICE.deviceHash }))
  ).toString('base64url')
  setFile({ ...f, token: `${h}.${forged}.${s}` })
  assert.equal(access.status(true).state.kind, 'checking')
  // A key set of the user's own making, with their key in it.
  const mine = keypair()
  setFile({ ...f, keyset: keyset(mine.priv, { 'ent-1': mine.raw }, T0 + 99) })
  assert.equal(access.status(true).state.kind, 'checking')
})

test('signing keys rotate without a release; an old answer replayed can’t bring a dropped key back', async () => {
  const { access, worker, file } = setup()
  await access.ready()
  await access.refresh()
  const before = worker.answer(DEVICE) // signed by ent-1, in the first key set
  worker.rotate()
  worker.ent = { licence: { since: T0 }, addons: [] }
  await access.refresh()
  assert.equal(access.status(true).state.kind, 'licensed')
  const kept = file()
  // The first answer, replayed (its key since dropped): its key set is older than the one kept,
  // so it isn't taken, and its token can't be verified without it.
  worker.server.entitlements = async () => before
  await assert.rejects(access.refresh(), (e) => (e as AccountError).code === 'network')
  assert.deepEqual(file(), kept)
  assert.equal(access.status(true).state.kind, 'licensed')
})

test('the device limit, freeing a device, and signing out', async () => {
  const { access, worker, file, account } = setup()
  await access.ready()
  worker.ent = { licence: { since: T0 }, addons: [] }
  await access.refresh()
  assert.equal(access.status(true).state.kind, 'licensed')
  const devices = [{ id: 'd1', name: 'Old laptop (Windows)' }]
  worker.refuse = new AccountError('limit', 'device_limit', { devices })
  await assert.rejects(access.refresh())
  assert.deepEqual(access.status(true).state, { kind: 'device-limit', devices })
  assert.equal(file().token, undefined)
  await access.freeDevice('d1')
  assert.deepEqual(worker.calls.slice(-2), ['free d1', 'entitlements'])
  assert.equal(access.status(true).state.kind, 'licensed')
  // The account's session revoked: forgotten.
  worker.refuse = new OAuthError('gone', 'signed-out')
  await assert.rejects(access.refresh())
  assert.equal(file().token, undefined)
  assert.ok(file().keyset) // the key set and the clock mark stay
  account.signedIn = false
  assert.equal(access.status(true).state.kind, 'signed-out')
  assert.equal(access.due(), false)
})

test('concurrent refreshes share one request', async () => {
  const { access, worker } = setup()
  await access.ready()
  await Promise.all([access.refresh(), access.refresh(), access.refresh()])
  assert.deepEqual(worker.calls, ['entitlements'])
})
