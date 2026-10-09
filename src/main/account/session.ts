/**
 * The signed-in session: who is signed in, the refresh token kept between
 * launches (main/account/index.ts seals it with the OS keychain), and the
 * access token, kept in memory only and refreshed when it is about to
 * expire. Refresh tokens rotate and pixl-core doesn't detect one being used
 * twice, so refreshing is single-flight and the new token is saved before
 * anything else uses it. Free of Electron, for tests/account.test.ts.
 */
import { t } from '../../shared/i18n'
import type { AuthConfig } from '../../shared/account'
import {
  jwtPayload,
  OAuthError,
  refreshTokens,
  signInWithBrowser,
  type Fetch,
  type SignInDeps,
  type TokenSet
} from './oauth'

/** What is kept between launches. */
export interface StoredSession {
  refreshToken: string
  sub: string
  email?: string
  name?: string
}

export interface SessionStore {
  load(): StoredSession | null
  save(s: StoredSession | null): void
}

export interface Identity {
  sub: string
  email?: string
  name?: string
}

/** Refresh this long before the access token expires. */
const EARLY_MS = 60_000

function identityOf(tokens: TokenSet): Identity {
  const access = jwtPayload(tokens.accessToken)
  const id = tokens.idToken ? jwtPayload(tokens.idToken) : {}
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() ? v.trim() : undefined
  return {
    sub: str(access.sub) ?? str(id.sub) ?? '',
    email: str(access.email) ?? str(id.email),
    name: str(id.name) ?? str((access.user_metadata as Record<string, unknown>)?.full_name)
  }
}

export class Session {
  private stored: StoredSession | null
  private access: { token: string; expiresAt: number } | null = null
  private refreshing: Promise<string> | null = null

  private readonly cfg: AuthConfig
  private readonly store: SessionStore
  private readonly fetchFn: Fetch
  private readonly now: () => number
  /** Told whenever someone signs in or out. */
  private readonly onChange: () => void

  constructor(
    cfg: AuthConfig,
    store: SessionStore,
    fetchFn: Fetch,
    now: () => number = Date.now,
    onChange: () => void = () => {}
  ) {
    this.cfg = cfg
    this.store = store
    this.fetchFn = fetchFn
    this.now = now
    this.onChange = onChange
    this.stored = store.load()
  }

  identity(): Identity | null {
    const s = this.stored
    return s ? { sub: s.sub, email: s.email, name: s.name } : null
  }

  private keep(tokens: TokenSet, who: Identity): void {
    this.stored = { refreshToken: tokens.refreshToken, ...who }
    this.store.save(this.stored)
    this.access = { token: tokens.accessToken, expiresAt: tokens.expiresAt }
  }

  async signIn(deps: Omit<SignInDeps, 'fetch' | 'now'>): Promise<Identity> {
    const tokens = await signInWithBrowser(this.cfg, {
      ...deps,
      fetch: this.fetchFn,
      now: this.now
    })
    const who = identityOf(tokens)
    // Wait out a refresh of the old session, so it can't save over this one.
    await this.refreshing?.catch(() => {})
    this.keep(tokens, who)
    this.onChange()
    return who
  }

  /** Forgets the session on this device. The account page can revoke it on the server too. */
  signOut(): void {
    const had = this.stored !== null
    this.stored = null
    this.access = null
    this.store.save(null)
    if (had) this.onChange()
  }

  /**
   * A current access token, refreshed first when it is about to expire.
   * Throws OAuthError: `signed-out` (the session is gone, and is forgotten
   * here), or `network` (the session is kept for the next try).
   */
  accessToken(): Promise<string> {
    if (this.access && this.access.expiresAt - EARLY_MS > this.now())
      return Promise.resolve(this.access.token)
    return this.refresh()
  }

  /** Refreshes now (single-flight), whatever the access token's expiry. */
  refresh(): Promise<string> {
    if (this.refreshing) return this.refreshing
    const stored = this.stored
    if (!stored) return Promise.reject(new OAuthError(t('Not signed in.'), 'signed-out'))
    this.refreshing = (async () => {
      try {
        const tokens = await refreshTokens(this.cfg, stored.refreshToken, this.fetchFn, this.now)
        // Signed out (or in as someone else) while this was in flight: drop it.
        if (this.stored !== stored) throw new OAuthError(t('Signed out.'), 'signed-out')
        const who = identityOf(tokens)
        this.keep(tokens, {
          sub: who.sub || stored.sub,
          email: who.email ?? stored.email,
          name: who.name ?? stored.name
        })
        return tokens.accessToken
      } catch (err) {
        if (err instanceof OAuthError && err.code === 'signed-out' && this.stored === stored)
          this.signOut()
        throw err
      } finally {
        this.refreshing = null
      }
    })()
    return this.refreshing
  }
}
