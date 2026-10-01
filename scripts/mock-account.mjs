// A stand-in for the PIXL account (Supabase Auth on pixl-core, as an OAuth
// server), for working on sign-in before pixl-web's pages are live, or
// offline. It follows the contract in pixl-web's TODO ("Contract with the
// apps") and what the spike found: exact redirect URIs, one-use codes,
// PKCE (S256), rotating refresh tokens, 1-hour access tokens, and
// refresh_token_not_found once a session is revoked.
//
//   node scripts/mock-account.mjs [port]          (default 54321)
//   PLAYROOM_AUTH_URL=http://127.0.0.1:54321/auth/v1 pnpm dev
//
// The authorize page approves at once, as the user ada@example.com (pass
// ?login_hint=<email> to be someone else).
//
// It also answers the Worker's account API (PLAYROOM_ACCOUNT_URL=
// http://127.0.0.1:54321/api): /api/entitlements, /api/trials and
// DELETE /api/devices/:id. Tokens are signed with a key made at start, in a
// key set signed by the development root (dev-entitlement-root.mjs), which
// only unpackaged builds trust. Every account starts with beta access, no
// trial and no licence, and up to 3 devices. Also:
//   POST /mock/revoke    revokes every session (as "Revoke" on the account page)
//   POST /mock/grant     {"email", "beta": bool, "licence": bool, "trial": "reset"|"end"}
//   POST /mock/policy    {"betaOpen": bool}: false answers beta builds beta_ended
//   GET  /mock/state     the sessions, accounts and calls so far, as JSON
// MOCK_TOKEN_DAYS and MOCK_REFRESH_S shorten the token's grace and refresh time.
import { createHash, createPrivateKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { createServer } from 'node:http'
import { DEV_ROOT } from './dev-entitlement-root.mjs'

const PORT = Number(process.argv[2] ?? 54321)
const CLIENT_ID = '83eab600-baf2-4f5e-aac4-252010db94b2'
const REDIRECTS = ['http://127.0.0.1:47823/callback', 'pixlplayroom://auth/callback']

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const id = () => randomBytes(16).toString('base64url')
const sub = (email) => createHash('sha256').update(email).digest('hex').slice(0, 32)

const DAY = 24 * 60 * 60
const TOKEN_S = Number(process.env.MOCK_TOKEN_DAYS ?? 30) * DAY
const REFRESH_S = Number(process.env.MOCK_REFRESH_S ?? DAY)
const DEVICE_LIMIT = 3

// The signing key, and the key set naming it, signed by the dev root.
const signing = generateKeyPairSync('ed25519')
const KID = `mock-${Date.now().toString(36)}`
const jws = (header, payload, key) => {
  const data = `${b64(header)}.${b64(payload)}`
  return `${data}.${sign(null, Buffer.from(data), key).toString('base64url')}`
}
const root = createPrivateKey({ key: { kty: 'OKP', crv: 'Ed25519', ...DEV_ROOT }, format: 'jwk' })
const KEYSET = jws(
  { alg: 'EdDSA', kid: DEV_ROOT.kid, typ: 'pixl-keyset' },
  {
    iss: 'pixlfoundation.com',
    keys: { [KID]: signing.publicKey.export({ format: 'jwk' }).x },
    iat: Math.floor(Date.now() / 1000)
  },
  root
)

const accounts = new Map() // sub → { email, beta, licence, trialUntil, devices: Map<hash, device> }
const trialDevices = new Set() // device hashes that have had a trial, under any account
let betaOpen = true

function account(sub, email) {
  let a = accounts.get(sub)
  if (!a) {
    a = { email, beta: true, licence: null, trialUntil: null, devices: new Map() }
    accounts.set(sub, a)
  }
  return a
}

const codes = new Map() // code → { challenge, redirectUri, email }
const sessions = new Map() // refresh token → { email, sessionId }
const calls = []

function tokens(email, sessionId) {
  const now = Math.floor(Date.now() / 1000)
  const claims = {
    iss: `http://127.0.0.1:${PORT}/auth/v1`,
    aud: 'authenticated',
    sub: sub(email),
    email,
    role: 'authenticated',
    session_id: sessionId,
    client_id: CLIENT_ID,
    scope: 'openid email profile',
    iat: now,
    exp: now + 3600
  }
  const refresh = id()
  sessions.set(refresh, { email, sessionId })
  return {
    // Unsigned (the mock's tokens are never verified by the app).
    access_token: `${b64({ alg: 'none', typ: 'JWT' })}.${b64(claims)}.mock`,
    refresh_token: refresh,
    id_token: `${b64({ alg: 'none' })}.${b64({ ...claims, aud: CLIENT_ID, name: 'Ada Lovelace' })}.mock`,
    token_type: 'bearer',
    expires_in: 3600
  }
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body))
}

async function body(req) {
  let text = ''
  for await (const chunk of req) text += chunk
  return text
}

async function form(req) {
  return new URLSearchParams(await body(req))
}

/** The bearer's claims, if it's one of the mock's own live access tokens. */
function bearer(req) {
  const [kind, token] = (req.headers.authorization ?? '').split(' ')
  if (kind !== 'Bearer' || !token) return null
  try {
    const c = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
    if (c.client_id !== CLIENT_ID || c.exp <= Date.now() / 1000) return null
    return c
  } catch {
    return null
  }
}

/** The Worker's account API, as in the contract. */
async function api(req, res, url) {
  const who = bearer(req)
  if (!who) return json(res, 401, { error: 'auth' })
  const a = account(who.sub, who.email)
  const now = Math.floor(Date.now() / 1000)

  const del = /^\/api\/devices\/([^/]+)$/.exec(url.pathname)
  if (req.method === 'DELETE' && del) {
    for (const [h, d] of a.devices) if (d.id === decodeURIComponent(del[1])) a.devices.delete(h)
    res.writeHead(204).end()
    return
  }
  if (req.method !== 'POST' || !['/api/entitlements', '/api/trials'].includes(url.pathname))
    return json(res, 404, { error: 'not_found' })

  let b
  try {
    b = JSON.parse(await body(req))
  } catch {
    return json(res, 400, { error: 'bad_request', field: 'body' })
  }
  for (const field of ['product', 'deviceHash', 'deviceName', 'os', 'appVersion'])
    if (typeof b[field] !== 'string' || !b[field])
      return json(res, 400, { error: 'bad_request', field })
  if (b.product !== 'playroom') return json(res, 403, { error: 'wrong_client' })

  const betaBuild = b.appVersion.includes('-beta')
  if (betaBuild && !betaOpen) return json(res, 410, { error: 'beta_ended' })
  if (betaBuild && !a.beta && !a.licence) return json(res, 403, { error: 'no_beta' })

  // One row per device; a device already on the account never counts twice.
  if (!a.devices.has(b.deviceHash)) {
    if (a.devices.size >= DEVICE_LIMIT) {
      const devices = [...a.devices.values()].map(({ id, name, lastSeen }) => ({
        id,
        name,
        lastSeen
      }))
      return json(res, 403, { error: 'device_limit', devices })
    }
    a.devices.set(b.deviceHash, { id: id(), name: b.deviceName, os: b.os })
  }
  Object.assign(a.devices.get(b.deviceHash), {
    name: b.deviceName,
    os: b.os,
    appVersion: b.appVersion,
    lastSeen: new Date().toISOString()
  })

  if (url.pathname === '/api/trials' && a.trialUntil === null && !a.licence) {
    if (trialDevices.has(b.deviceHash)) return json(res, 409, { error: 'trial_used_device' })
    a.trialUntil = now + 14 * DAY
    trialDevices.add(b.deviceHash)
  } else if (url.pathname === '/api/trials' && a.trialUntil !== null && a.trialUntil <= now) {
    return json(res, 409, { error: 'trial_used_account' })
  }

  const ent = { addons: [] }
  if (a.beta && betaOpen) ent.beta = {}
  if (a.trialUntil !== null) ent.trial = { until: a.trialUntil }
  if (a.licence) ent.licence = { since: a.licence }
  const token = jws(
    { alg: 'EdDSA', kid: KID, typ: 'JWT' },
    {
      iss: 'pixlfoundation.com',
      sub: who.sub,
      aud: b.product,
      dev: b.deviceHash,
      iat: now,
      exp: now + TOKEN_S,
      rfa: now + REFRESH_S,
      email: who.email,
      ent
    },
    signing.privateKey
  )
  return json(res, 200, { token, keyset: KEYSET })
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  calls.push(`${req.method} ${url.pathname}`)
  const q = url.searchParams

  if (req.method === 'GET' && url.pathname === '/auth/v1/oauth/authorize') {
    if (q.get('client_id') !== CLIENT_ID) return json(res, 400, { error: 'invalid_client' })
    if (!REDIRECTS.includes(q.get('redirect_uri')))
      return json(res, 400, { error_code: 'validation_failed', msg: 'invalid redirect_uri' })
    if (q.get('response_type') !== 'code' || q.get('code_challenge_method') !== 'S256')
      return json(res, 400, { error: 'invalid_request' })
    const code = id()
    codes.set(code, {
      challenge: q.get('code_challenge'),
      redirectUri: q.get('redirect_uri'),
      email: q.get('login_hint') || 'ada@example.com'
    })
    const back = new URL(q.get('redirect_uri'))
    back.searchParams.set('code', code)
    back.searchParams.set('state', q.get('state') ?? '')
    res.writeHead(302, { Location: back.toString() }).end()
    return
  }

  if (req.method === 'POST' && url.pathname === '/auth/v1/oauth/token') {
    const f = await form(req)
    if (f.get('client_id') !== CLIENT_ID) return json(res, 400, { error: 'invalid_client' })
    if (f.get('grant_type') === 'authorization_code') {
      const c = codes.get(f.get('code'))
      codes.delete(f.get('code'))
      const verifier = f.get('code_verifier') ?? ''
      if (
        !c ||
        c.redirectUri !== f.get('redirect_uri') ||
        createHash('sha256').update(verifier).digest('base64url') !== c.challenge
      )
        return json(res, 400, { error: 'invalid_grant' })
      return json(res, 200, tokens(c.email, id()))
    }
    if (f.get('grant_type') === 'refresh_token') {
      const s = sessions.get(f.get('refresh_token'))
      if (!s) return json(res, 400, { error: 'refresh_token_not_found' })
      sessions.delete(f.get('refresh_token'))
      return json(res, 200, tokens(s.email, s.sessionId))
    }
    return json(res, 400, { error: 'unsupported_grant_type' })
  }

  if (req.method === 'POST' && url.pathname === '/auth/v1/logout') {
    const auth = req.headers.authorization ?? ''
    let sessionId
    try {
      sessionId = JSON.parse(Buffer.from(auth.split('.')[1] ?? '', 'base64url')).session_id
    } catch {
      return json(res, 401, { error: 'bad_jwt' })
    }
    for (const [rt, s] of sessions) if (s.sessionId === sessionId) sessions.delete(rt)
    res.writeHead(204).end()
    return
  }

  if (url.pathname.startsWith('/api/')) return api(req, res, url)

  if (req.method === 'POST' && url.pathname === '/mock/grant') {
    const g = JSON.parse((await body(req)) || '{}')
    const a = account(sub(g.email ?? 'ada@example.com'), g.email ?? 'ada@example.com')
    const now = Math.floor(Date.now() / 1000)
    if ('beta' in g) a.beta = !!g.beta
    if ('licence' in g) a.licence = g.licence ? now : null
    if (g.trial === 'reset') {
      a.trialUntil = null
      for (const h of a.devices.keys()) trialDevices.delete(h)
    }
    if (g.trial === 'end') a.trialUntil = now - 1
    return json(res, 200, { ok: true })
  }
  if (req.method === 'POST' && url.pathname === '/mock/policy') {
    betaOpen = !!JSON.parse((await body(req)) || '{}').betaOpen
    return json(res, 200, { betaOpen })
  }

  if (req.method === 'POST' && url.pathname === '/mock/revoke') {
    sessions.clear()
    return json(res, 200, { revoked: true })
  }
  if (req.method === 'GET' && url.pathname === '/mock/state') {
    const list = [...accounts.values()].map((a) => ({ ...a, devices: [...a.devices.values()] }))
    return json(res, 200, { sessions: [...sessions.values()], accounts: list, calls })
  }
  json(res, 404, { error: 'not_found' })
}).listen(PORT, '127.0.0.1', () => {
  console.log(`mock PIXL account on http://127.0.0.1:${PORT}/auth/v1 and /api (signing key ${KID})`)
})
