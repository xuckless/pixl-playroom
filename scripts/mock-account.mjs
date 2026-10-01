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
// ?login_hint=<email> to be someone else). Also:
//   POST /mock/revoke    revokes every session (as "Revoke" on the account page)
//   GET  /mock/state     the live sessions and the calls so far, as JSON
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'

const PORT = Number(process.argv[2] ?? 54321)
const CLIENT_ID = '83eab600-baf2-4f5e-aac4-252010db94b2'
const REDIRECTS = ['http://127.0.0.1:47823/callback', 'pixlplayroom://auth/callback']

const codes = new Map() // code → { challenge, redirectUri, email }
const sessions = new Map() // refresh token → { email, sessionId }
const calls = []

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const id = () => randomBytes(16).toString('base64url')
const sub = (email) => createHash('sha256').update(email).digest('hex').slice(0, 32)

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

async function form(req) {
  let body = ''
  for await (const chunk of req) body += chunk
  return new URLSearchParams(body)
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

  if (req.method === 'POST' && url.pathname === '/mock/revoke') {
    sessions.clear()
    return json(res, 200, { revoked: true })
  }
  if (req.method === 'GET' && url.pathname === '/mock/state') {
    return json(res, 200, { sessions: [...sessions.values()], calls })
  }
  json(res, 404, { error: 'not_found' })
}).listen(PORT, '127.0.0.1', () => {
  console.log(`mock PIXL account on http://127.0.0.1:${PORT}/auth/v1`)
})
