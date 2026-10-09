/**
 * Signing in with the PIXL account: OAuth 2.1's authorization code flow with
 * PKCE, as a public client (RFC 8252). The system browser opens Supabase's
 * authorize page; the code comes back to a one-shot HTTP server on
 * 127.0.0.1 at the registered port, and is exchanged for tokens. Free of
 * Electron (fetch and opening the browser are passed in), so
 * tests/account.test.ts runs it against a fake server.
 */
import { t } from '../../shared/i18n'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { REDIRECT_PATH, type AuthConfig } from '../../shared/account'

export type Fetch = typeof fetch

export type OAuthErrorCode =
  /** Another sign-in (this app's, or another copy's) holds the port. */
  | 'port-in-use'
  | 'timeout'
  | 'cancelled'
  /** The user (or the server) refused on the authorize page. */
  | 'denied'
  /** A callback that isn't the answer to this sign-in. */
  | 'state'
  | 'network'
  /** The token endpoint refused the code. */
  | 'rejected'
  /** The refresh token is no longer good: revoked, or the session ended. */
  | 'signed-out'

export class OAuthError extends Error {
  readonly code: OAuthErrorCode
  constructor(message: string, code: OAuthErrorCode) {
    super(message)
    this.name = 'OAuthError'
    this.code = code
  }
}

export interface TokenSet {
  accessToken: string
  refreshToken: string
  /** When the access token expires, in ms since the epoch (our clock). */
  expiresAt: number
  idToken?: string
}

const b64url = (b: Buffer): string => b.toString('base64url')

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32))
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) }
}

export function newState(): string {
  return b64url(randomBytes(24))
}

export function authorizeUrl(
  cfg: AuthConfig,
  p: { redirectUri: string; state: string; challenge: string }
): string {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.clientId,
    redirect_uri: p.redirectUri,
    state: p.state,
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
    scope: cfg.scopes
  })
  return `${cfg.authUrl}/oauth/authorize?${q}`
}

function sameState(a: string | null, b: string): boolean {
  if (a === null) return false
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** The authorization code from the redirect, once its `state` is this sign-in's. */
export function readCallback(url: URL, state: string): string {
  const q = url.searchParams
  if (!sameState(q.get('state'), state))
    throw new OAuthError(t("That sign-in answer wasn't for this sign-in."), 'state')
  const error = q.get('error')
  if (error) {
    const why = q.get('error_description') || error
    throw new OAuthError(t('Sign-in was refused: {{reason}}', { reason: why }), 'denied')
  }
  const code = q.get('code')
  if (!code) throw new OAuthError(t('The sign-in answer carried no code.'), 'denied')
  return code
}

const page = (title: string, body: string): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>` +
  `<meta name="viewport" content="width=device-width,initial-scale=1"><style>` +
  `body{font:16px/1.5 system-ui,sans-serif;background:#0b0b0f;color:#e8e8ef;display:grid;` +
  `place-items:center;min-height:100vh;margin:0;padding:0 16px}main{max-width:28rem;text-align:center}` +
  `h1{font-size:1.25rem;font-weight:600}p{color:#a0a0b0}</style></head>` +
  `<body><main><h1>${title}</h1><p>${body}</p></main></body></html>`

const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

export interface CallbackServer {
  redirectUri: string
  /** The code, once the browser comes back with it. */
  code: Promise<string>
  close(): void
}

/**
 * Listens on 127.0.0.1:`port` for the one redirect this sign-in expects, then
 * closes. Anything else on the port is a 404; a wrong `state` is refused and
 * the server keeps waiting (a stale tab can't end a new sign-in).
 */
export function listenForCallback(opts: {
  port: number
  state: string
  timeoutMs: number
  signal?: AbortSignal
}): Promise<CallbackServer> {
  return new Promise((resolveServer, rejectServer) => {
    let settle: { resolve(code: string): void; reject(err: OAuthError): void }
    const code = new Promise<string>((resolve, reject) => (settle = { resolve, reject }))
    // Handled by whoever awaits it; never an unhandled rejection meanwhile.
    code.catch(() => {})
    let done = false
    const finish = (fn: () => void): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      fn()
      server.close()
      server.closeAllConnections?.()
    }
    const server: Server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (req.method !== 'GET' || url.pathname !== REDIRECT_PATH) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found')
        return
      }
      const send = (status: number, title: string, body: string): void => {
        res
          .writeHead(status, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            Connection: 'close'
          })
          .end(page(title, body))
      }
      try {
        const got = readCallback(url, opts.state)
        send(
          200,
          t('Signed in to Pixl Playroom'),
          t('You can close this tab and go back to the app.')
        )
        finish(() => settle.resolve(got))
      } catch (err) {
        const e = err as OAuthError
        send(400, t('Sign-in didn’t finish'), escapeHtml(e.message))
        if (e.code !== 'state') finish(() => settle.reject(e))
      }
    })
    const timer = setTimeout(
      () =>
        finish(() =>
          settle.reject(
            new OAuthError(t('Sign-in timed out. Try again when you’re ready.'), 'timeout')
          )
        ),
      opts.timeoutMs
    )
    const onAbort = (): void =>
      finish(() => settle.reject(new OAuthError(t('Sign-in was cancelled.'), 'cancelled')))
    if (opts.signal?.aborted) {
      clearTimeout(timer)
      rejectServer(new OAuthError(t('Sign-in was cancelled.'), 'cancelled'))
      return
    }
    opts.signal?.addEventListener('abort', onAbort)
    server.once('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      rejectServer(
        err.code === 'EADDRINUSE'
          ? new OAuthError(
              t(
                'Another sign-in is already waiting in the browser. Finish or close it, then try again.'
              ),
              'port-in-use'
            )
          : new OAuthError(t("Couldn't start the sign-in: {{reason}}", { reason: err.message }), 'network')
      )
    })
    server.listen(opts.port, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : opts.port
      resolveServer({
        redirectUri: `http://127.0.0.1:${port}${REDIRECT_PATH}`,
        code,
        close: () =>
          finish(() => settle.reject(new OAuthError(t('Sign-in was cancelled.'), 'cancelled')))
      })
    })
  })
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  id_token?: string
  error?: string
  error_code?: string
  error_description?: string
  msg?: string
}

async function tokenRequest(
  cfg: AuthConfig,
  body: Record<string, string>,
  fetchFn: Fetch,
  now: () => number
): Promise<TokenSet> {
  let res: Response
  try {
    res = await fetchFn(`${cfg.authUrl}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        apikey: cfg.apiKey
      },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(20_000)
    })
  } catch (err) {
    throw new OAuthError(
      t("Couldn't reach the PIXL account: {{reason}}", {
        reason: err instanceof Error ? err.message : String(err)
      }),
      'network'
    )
  }
  let json: TokenResponse = {}
  try {
    json = (await res.json()) as TokenResponse
  } catch {
    // An empty or HTML body: judged by the status below.
  }
  if (!res.ok || !json.access_token || !json.refresh_token) {
    const reason = json.error ?? json.error_code ?? `HTTP ${res.status}`
    const why = json.error_description ?? json.msg ?? reason
    // Only a refusal of the token itself (400 refresh_token_not_found,
    // invalid_grant; 401) signs out. Rate limits and outages keep the
    // session for the next try.
    const refused = res.status === 400 || res.status === 401
    if (!refused && !res.ok)
      throw new OAuthError(t('The PIXL account is unavailable ({{reason}}).', { reason: why }), 'network')
    if (body.grant_type === 'refresh_token')
      throw new OAuthError(t('Signed out: {{reason}}', { reason: why }), 'signed-out')
    throw new OAuthError(t('Sign-in was refused: {{reason}}', { reason: why }), 'rejected')
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: now() + (json.expires_in ?? 3600) * 1000,
    idToken: json.id_token
  }
}

export function exchangeCode(
  cfg: AuthConfig,
  p: { code: string; verifier: string; redirectUri: string },
  fetchFn: Fetch,
  now: () => number = Date.now
): Promise<TokenSet> {
  return tokenRequest(
    cfg,
    {
      grant_type: 'authorization_code',
      code: p.code,
      redirect_uri: p.redirectUri,
      client_id: cfg.clientId,
      code_verifier: p.verifier
    },
    fetchFn,
    now
  )
}

/** Refresh tokens rotate: the answer's refresh token replaces the old one, which must not be sent again. */
export function refreshTokens(
  cfg: AuthConfig,
  refreshToken: string,
  fetchFn: Fetch,
  now: () => number = Date.now
): Promise<TokenSet> {
  return tokenRequest(
    cfg,
    { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: cfg.clientId },
    fetchFn,
    now
  )
}

export interface SignInDeps {
  fetch: Fetch
  /** Opens the authorize page in the system browser. */
  openBrowser(url: string): Promise<void> | void
  port: number
  timeoutMs?: number
  signal?: AbortSignal
  now?: () => number
}

/** The whole browser sign-in: listen, open the browser, wait for the code, exchange it. */
export async function signInWithBrowser(cfg: AuthConfig, deps: SignInDeps): Promise<TokenSet> {
  const { verifier, challenge } = pkcePair()
  const state = newState()
  const server = await listenForCallback({
    port: deps.port,
    state,
    timeoutMs: deps.timeoutMs ?? 5 * 60_000,
    signal: deps.signal
  })
  try {
    await deps.openBrowser(authorizeUrl(cfg, { redirectUri: server.redirectUri, state, challenge }))
    const code = await server.code
    return await exchangeCode(
      cfg,
      { code, verifier, redirectUri: server.redirectUri },
      deps.fetch,
      deps.now
    )
  } finally {
    server.close()
  }
}

/**
 * A JWT's payload, unverified. Only for showing who is signed in: the
 * token came straight from the account server over TLS, and what the
 * account allows is decided by the Worker, which verifies it.
 */
export function jwtPayload(token: string): Record<string, unknown> {
  try {
    const part = token.split('.')[1]
    const json = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as unknown
    return json && typeof json === 'object' ? (json as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * Ends the session on the server too (Supabase's logout, this session
 * only), so its refresh token stops working everywhere. Best effort:
 * signing out on this device doesn't wait for it or depend on it.
 */
export async function endSession(
  cfg: AuthConfig,
  accessToken: string,
  fetchFn: Fetch
): Promise<void> {
  await fetchFn(`${cfg.authUrl}/logout?scope=local`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, apikey: cfg.apiKey },
    signal: AbortSignal.timeout(10_000)
  })
}
