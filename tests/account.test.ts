import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { createServer } from 'node:http'
import type { AuthConfig, EntitlementClaims } from '../src/shared/account'
import {
  authorizeUrl,
  exchangeCode,
  listenForCallback,
  OAuthError,
  pkcePair,
  readCallback,
  refreshTokens,
  signInWithBrowser,
  type Fetch
} from '../src/main/account/oauth'
import { Session, type SessionStore, type StoredSession } from '../src/main/account/session'
import { deviceHash, parseIoreg, parseRegQuery } from '../src/main/account/device'
import { checkEntitlement, type EntitlementKeys } from '../src/main/account/entitlement'

const CFG: AuthConfig = {
  authUrl: 'https://auth.test/auth/v1',
  clientId: 'client-1',
  apiKey: 'pk_test',
  scopes: 'openid email profile'
}

/** An unsigned JWT-shaped token, as the app only reads access tokens' payloads. */
const jwt = (payload: object): string =>
  `e30.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`

const code = (err: unknown): string | undefined =>
  err instanceof OAuthError ? err.code : undefined

// ── PKCE and the authorize URL ──

test('the PKCE challenge is the S256 of the verifier', () => {
  const { verifier, challenge } = pkcePair()
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(challenge, createHash('sha256').update(verifier).digest('base64url'))
  assert.notEqual(pkcePair().verifier, verifier)
})

test('the authorize URL carries the client, the redirect, the state and the challenge', () => {
  const u = new URL(
    authorizeUrl(CFG, {
      redirectUri: 'http://127.0.0.1:47823/callback',
      state: 'st',
      challenge: 'ch'
    })
  )
  assert.equal(u.origin + u.pathname, 'https://auth.test/auth/v1/oauth/authorize')
  const q = Object.fromEntries(u.searchParams)
  assert.deepEqual(q, {
    response_type: 'code',
    client_id: 'client-1',
    redirect_uri: 'http://127.0.0.1:47823/callback',
    state: 'st',
    code_challenge: 'ch',
    code_challenge_method: 'S256',
    scope: 'openid email profile'
  })
})

test('a callback gives its code only for this sign-in’s state', () => {
  const at = (q: string): URL => new URL(`http://127.0.0.1/callback?${q}`)
  assert.equal(readCallback(at('code=abc&state=st'), 'st'), 'abc')
  assert.throws(
    () => readCallback(at('code=abc&state=other'), 'st'),
    (e) => code(e) === 'state'
  )
  assert.throws(
    () => readCallback(at('code=abc'), 'st'),
    (e) => code(e) === 'state'
  )
  assert.throws(
    () => readCallback(at('error=access_denied&error_description=No&state=st'), 'st'),
    (e) => code(e) === 'denied' && /No/.test((e as Error).message)
  )
  assert.throws(
    () => readCallback(at('state=st'), 'st'),
    (e) => code(e) === 'denied'
  )
})

// ── the loopback server ──

async function get(url: string): Promise<{ status: number; body: string }> {
  const r = await fetch(url)
  return { status: r.status, body: await r.text() }
}

test('the loopback server waits out strangers and stale tabs, then takes the code', async () => {
  const s = await listenForCallback({ port: 0, state: 'st', timeoutMs: 5000 })
  const base = s.redirectUri.replace('/callback', '')
  assert.match(s.redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/callback$/)
  assert.equal((await get(`${base}/`)).status, 404)
  assert.equal((await get(`${base}/favicon.ico`)).status, 404)
  // A stale tab from an earlier sign-in: refused, and the server keeps waiting.
  assert.equal((await get(`${s.redirectUri}?code=old&state=stale`)).status, 400)
  const ok = await get(`${s.redirectUri}?code=fresh&state=st`)
  assert.equal(ok.status, 200)
  assert.match(ok.body, /Signed in to Pixl Playroom/)
  assert.equal(await s.code, 'fresh')
  // One-shot: it has closed.
  await assert.rejects(fetch(s.redirectUri))
})

test('a refusal on the authorize page ends the sign-in, escaped on the page', async () => {
  const s = await listenForCallback({ port: 0, state: 'st', timeoutMs: 5000 })
  const r = await get(
    `${s.redirectUri}?error=access_denied&error_description=%3Cb%3Eno%3C%2Fb%3E&state=st`
  )
  assert.equal(r.status, 400)
  assert.doesNotMatch(r.body, /<b>no<\/b>/)
  await assert.rejects(s.code, (e) => code(e) === 'denied')
})

test('the loopback server times out, can be cancelled, and says when the port is taken', async () => {
  const slow = await listenForCallback({ port: 0, state: 'st', timeoutMs: 50 })
  await assert.rejects(slow.code, (e) => code(e) === 'timeout')

  const ctl = new AbortController()
  const cancelled = await listenForCallback({
    port: 0,
    state: 'st',
    timeoutMs: 5000,
    signal: ctl.signal
  })
  ctl.abort()
  await assert.rejects(cancelled.code, (e) => code(e) === 'cancelled')

  const holder = createServer().listen(0, '127.0.0.1')
  await new Promise((r) => holder.once('listening', r))
  const port = (holder.address() as { port: number }).port
  await assert.rejects(
    listenForCallback({ port, state: 'st', timeoutMs: 5000 }),
    (e) => code(e) === 'port-in-use'
  )
  holder.close()
})

// ── the token endpoint ──

interface FakeAuth {
  fetch: Fetch
  calls: { grant: string; body: URLSearchParams; apikey: string | null }[]
  /** Refresh tokens still good. */
  live: Set<string>
  challenges: Map<string, string>
  down: boolean
  status?: number
}

/** pixl-core's token endpoint in miniature: one-use codes, PKCE checked, rotating refresh tokens. */
function fakeAuth(): FakeAuth {
  let n = 0
  const issue = (sub: string): object => {
    const refresh = `rt-${++n}`
    f.live.add(refresh)
    return {
      access_token: jwt({ sub, email: 'ada@example.com', client_id: 'client-1' }),
      refresh_token: refresh,
      id_token: jwt({ sub, email: 'ada@example.com', name: 'Ada Lovelace' }),
      token_type: 'bearer',
      expires_in: 3600
    }
  }
  const reply = (status: number, json: object): Response =>
    new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } })
  const f: FakeAuth = {
    calls: [],
    live: new Set(),
    challenges: new Map(),
    down: false,
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      if (f.down) throw new TypeError('fetch failed')
      assert.equal(String(input), 'https://auth.test/auth/v1/oauth/token')
      const body = new URLSearchParams(String(init?.body))
      const headers = new Headers(init?.headers)
      f.calls.push({ grant: body.get('grant_type') ?? '', body, apikey: headers.get('apikey') })
      if (f.status) return reply(f.status, { error: 'slow_down' })
      if (body.get('client_id') !== 'client-1') return reply(400, { error: 'invalid_client' })
      if (body.get('grant_type') === 'authorization_code') {
        const challenge = f.challenges.get(body.get('code') ?? '')
        f.challenges.delete(body.get('code') ?? '')
        const verifier = body.get('code_verifier') ?? ''
        if (!challenge || createHash('sha256').update(verifier).digest('base64url') !== challenge)
          return reply(400, { error: 'invalid_grant' })
        return reply(200, issue('user-1'))
      }
      const rt = body.get('refresh_token') ?? ''
      if (!f.live.delete(rt)) return reply(400, { error: 'refresh_token_not_found' })
      return reply(200, issue('user-1'))
    }) as Fetch
  }
  return f
}

test('the code is exchanged with its verifier and the publishable key; a code works once', async () => {
  const auth = fakeAuth()
  const { verifier, challenge } = pkcePair()
  auth.challenges.set('c1', challenge)
  const t = await exchangeCode(
    CFG,
    { code: 'c1', verifier, redirectUri: 'http://127.0.0.1:47823/callback' },
    auth.fetch,
    () => 1000
  )
  assert.equal(t.refreshToken, 'rt-1')
  assert.equal(t.expiresAt, 1000 + 3600_000)
  const call = auth.calls[0]
  assert.equal(call.apikey, 'pk_test')
  assert.equal(call.body.get('redirect_uri'), 'http://127.0.0.1:47823/callback')
  await assert.rejects(
    exchangeCode(CFG, { code: 'c1', verifier, redirectUri: 'x' }, auth.fetch),
    (e) => code(e) === 'rejected'
  )
})

test('a refused refresh signs out; an outage or a rate limit doesn’t', async () => {
  const auth = fakeAuth()
  await assert.rejects(refreshTokens(CFG, 'nope', auth.fetch), (e) => code(e) === 'signed-out')
  auth.status = 429
  await assert.rejects(refreshTokens(CFG, 'nope', auth.fetch), (e) => code(e) === 'network')
  auth.status = 503
  await assert.rejects(refreshTokens(CFG, 'nope', auth.fetch), (e) => code(e) === 'network')
  auth.status = undefined
  auth.down = true
  await assert.rejects(refreshTokens(CFG, 'nope', auth.fetch), (e) => code(e) === 'network')
})

test('the whole browser sign-in: the browser comes back to the loopback with the code', async () => {
  const auth = fakeAuth()
  let opened = ''
  const t = await signInWithBrowser(CFG, {
    fetch: auth.fetch,
    port: 0,
    openBrowser: async (url) => {
      opened = url
      // The authorize page and the consent page, approving at once.
      const q = new URL(url).searchParams
      auth.challenges.set('the-code', q.get('code_challenge') ?? '')
      const back = new URL(q.get('redirect_uri') ?? '')
      back.searchParams.set('code', 'the-code')
      back.searchParams.set('state', q.get('state') ?? '')
      void fetch(back)
    }
  })
  assert.match(opened, /^https:\/\/auth\.test\/auth\/v1\/oauth\/authorize\?/)
  assert.equal(t.refreshToken, 'rt-1')
})

// ── the session ──

function memoryStore(
  initial: StoredSession | null = null
): SessionStore & { saved: (StoredSession | null)[] } {
  let current = initial
  const saved: (StoredSession | null)[] = []
  return {
    saved,
    load: () => current,
    save: (s) => {
      current = s
      saved.push(s)
    }
  }
}

test('each refresh saves the rotated token at once, and concurrent callers share one refresh', async () => {
  const auth = fakeAuth()
  auth.live.add('rt-start')
  const store = memoryStore({ refreshToken: 'rt-start', sub: 'user-1', email: 'ada@example.com' })
  let now = 0
  const s = new Session(CFG, store, auth.fetch, () => now)
  const [a, b, c] = await Promise.all([s.accessToken(), s.accessToken(), s.accessToken()])
  assert.equal(a, b)
  assert.equal(b, c)
  assert.equal(auth.calls.length, 1)
  assert.equal(store.saved.at(-1)?.refreshToken, 'rt-1')
  assert.equal(store.saved.at(-1)?.name, 'Ada Lovelace')
  // Still fresh: no call.
  now = 30 * 60_000
  await s.accessToken()
  assert.equal(auth.calls.length, 1)
  // Within a minute of expiry: refreshed, with the rotated token.
  now = 59.5 * 60_000
  await s.accessToken()
  assert.equal(auth.calls.length, 2)
  assert.equal(auth.calls[1].body.get('refresh_token'), 'rt-1')
  assert.equal(store.saved.at(-1)?.refreshToken, 'rt-2')
})

test('a revoked session signs out and is forgotten; an outage keeps it', async () => {
  const auth = fakeAuth()
  auth.live.add('rt-start')
  const store = memoryStore({ refreshToken: 'rt-start', sub: 'user-1' })
  let changes = 0
  const s = new Session(CFG, store, auth.fetch, Date.now, () => changes++)
  auth.down = true
  await assert.rejects(s.refresh(), (e) => code(e) === 'network')
  assert.notEqual(s.identity(), null)
  assert.equal(store.saved.length, 0)
  auth.down = false
  auth.live.clear() // revoked from the account page
  await assert.rejects(s.accessToken(), (e) => code(e) === 'signed-out')
  assert.equal(s.identity(), null)
  assert.equal(store.saved.at(-1), null)
  assert.equal(changes, 1)
})

test('signing out while a refresh is in flight drops its answer', async () => {
  const auth = fakeAuth()
  auth.live.add('rt-start')
  const store = memoryStore({ refreshToken: 'rt-start', sub: 'user-1' })
  const s = new Session(CFG, store, auth.fetch)
  const pending = s.refresh()
  s.signOut()
  await assert.rejects(pending, (e) => code(e) === 'signed-out')
  assert.equal(s.identity(), null)
  assert.equal(store.saved.at(-1), null)
})

// ── the device ──

test('the device hash is the contract’s HMAC, and the ids are read from the OS’s output', () => {
  // Checked independently: printf %s <id> | openssl dgst -sha256 -hmac 'pixl:playroom:device:v1'
  assert.equal(
    deviceHash('4C4C4544-0042-3010-8052-B4C04F4A4D32', 'playroom'),
    '98079476e4c52656821ae8466a619f978a83c0c158c8deb25dd0b680d8aab0dd'
  )
  assert.notEqual(
    deviceHash('4C4C4544-0042-3010-8052-B4C04F4A4D32', 'spacepixl'),
    deviceHash('4C4C4544-0042-3010-8052-B4C04F4A4D32', 'playroom')
  )
  assert.equal(
    parseIoreg(
      '+-o J316sAP  <class IOPlatformExpertDevice>\n    "IOPlatformUUID" = "1A2B3C4D-0000-1111-2222-333344445555"\n'
    ),
    '1A2B3C4D-0000-1111-2222-333344445555'
  )
  assert.equal(parseIoreg('nothing here'), null)
  assert.equal(
    parseRegQuery(
      '\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\r\n    MachineGuid    REG_SZ    6f1c2a3b-4d5e-6f70-8192-a3b4c5d6e7f8\r\n'
    ),
    '6f1c2a3b-4d5e-6f70-8192-a3b4c5d6e7f8'
  )
  assert.equal(
    parseRegQuery('ERROR: The system was unable to find the specified registry key'),
    null
  )
})

// ── the entitlement token ──

const DEV = deviceHash('machine', 'playroom')
const T0 = 1_790_000_000 // a Unix time, seconds
const DAY_S = 24 * 60 * 60

function keypair(): { priv: KeyObject; raw: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return { priv: privateKey, raw: publicKey.export({ format: 'jwk' }).x as string }
}

function claims(over: Partial<EntitlementClaims> = {}): EntitlementClaims {
  return {
    iss: 'pixlfoundation.com',
    sub: 'user-1',
    aud: 'playroom',
    dev: DEV,
    iat: T0,
    exp: T0 + 30 * DAY_S,
    rfa: T0 + DAY_S,
    ent: { beta: {}, addons: [] },
    ...over
  }
}

function mint(
  priv: KeyObject,
  c: object,
  header: object = { alg: 'EdDSA', kid: 'k1', typ: 'JWT' }
): string {
  const enc = (o: object): string => Buffer.from(JSON.stringify(o)).toString('base64url')
  const data = `${enc(header)}.${enc(c)}`
  return `${data}.${sign(null, Buffer.from(data), priv).toString('base64url')}`
}

test('a token signed by a known key, for this app and device, is good until exp', () => {
  const k = keypair()
  const keys: EntitlementKeys = { k1: k.raw }
  const check = (
    token: string,
    nowS: number,
    seenAtS?: number
  ): ReturnType<typeof checkEntitlement> =>
    checkEntitlement(token, {
      keys,
      product: 'playroom',
      device: DEV,
      nowMs: nowS * 1000,
      seenAtMs: seenAtS !== undefined ? seenAtS * 1000 : undefined
    })
  const token = mint(k.priv, claims())
  const fresh = check(token, T0 + 60)
  assert.equal(fresh.ok, true)
  assert.equal(fresh.ok && fresh.refreshDue, false)
  assert.deepEqual(fresh.ok && fresh.claims.ent, { beta: {}, addons: [] })
  const due = check(token, T0 + 2 * DAY_S)
  assert.equal(due.ok && due.refreshDue, true)
  assert.deepEqual(check(token, T0 + 30 * DAY_S), { ok: false, problem: 'expired' })
  // Turning the clock back doesn't bring an expired token back…
  assert.deepEqual(check(token, T0 + 60, T0 + 31 * DAY_S), { ok: false, problem: 'expired' })
  // …nor stretch the grace: a clock set back is judged at the latest
  // moment seen (day 5), so the token is still good but due a refresh.
  const back = check(token, T0 - 10 * DAY_S, T0 + 5 * DAY_S)
  assert.equal(back.ok && back.refreshDue, true)
  assert.deepEqual(check(token, T0 - 10 * DAY_S, T0 + 30 * DAY_S), {
    ok: false,
    problem: 'expired'
  })
})

test('anything else is refused, and says why', () => {
  const k = keypair()
  const other = keypair()
  const keys: EntitlementKeys = { k1: k.raw, k2: other.raw }
  const check = (token: string): unknown =>
    checkEntitlement(token, { keys, product: 'playroom', device: DEV, nowMs: (T0 + 60) * 1000 })
  const problem = (token: string): unknown => (check(token) as { problem?: string }).problem
  assert.equal(problem('not a token'), 'malformed')
  assert.equal(problem('a.b.c'), 'malformed')
  assert.equal(problem(mint(k.priv, claims(), { alg: 'none', kid: 'k1' })), 'malformed')
  assert.equal(problem(mint(k.priv, claims(), { alg: 'EdDSA', kid: 'k9' })), 'unknown-key')
  assert.equal(problem(mint(k.priv, claims(), { alg: 'EdDSA' })), 'unknown-key')
  // Signed by a key we know, under another key's id.
  assert.equal(problem(mint(other.priv, claims())), 'signature')
  // A payload edited after signing.
  const [h, , s] = mint(k.priv, claims()).split('.')
  const edited = Buffer.from(
    JSON.stringify(claims({ ent: { licence: { since: T0 }, addons: [] } }))
  ).toString('base64url')
  assert.equal(problem(`${h}.${edited}.${s}`), 'signature')
  assert.equal(problem(mint(k.priv, claims({ iss: 'evil.example' }))), 'issuer')
  assert.equal(problem(mint(k.priv, claims({ aud: 'spacepixl' }))), 'audience')
  assert.equal(
    problem(mint(k.priv, claims({ dev: deviceHash('another machine', 'playroom') }))),
    'device'
  )
  assert.equal(problem(mint(k.priv, { ...claims(), ent: undefined })), 'malformed')
  assert.equal(problem(mint(k.priv, claims({ exp: T0 }))), 'expired')
  // Longer than the contract's month: refused, whoever signed it.
  assert.equal(problem(mint(k.priv, claims({ exp: T0 + 365 * DAY_S }))), 'malformed')
})
