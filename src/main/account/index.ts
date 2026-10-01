/**
 * The PIXL account in the app: signing in through the browser, the session
 * kept in userData/account.json (the refresh token sealed with the OS
 * keychain through safeStorage, or not kept at all where that isn't
 * available), and a quiet refresh at launch so a session revoked from the
 * account page signs out here. The flow itself is in oauth.ts and
 * session.ts; this file is the Electron side.
 */
import { app, BrowserWindow, safeStorage, shell } from 'electron'
import log from 'electron-log/main'
import { readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  AUTH_CONFIG,
  REDIRECT_PORT,
  type AccountStatus,
  type AuthConfig
} from '../../shared/account'
import { IPC } from '../../shared/ipc'
import { licenceEnforced } from '../../shared/licence'
import { endSession, OAuthError } from './oauth'
import { Session, type SessionStore, type StoredSession } from './session'

const cfg: AuthConfig = {
  ...AUTH_CONFIG,
  authUrl: (process.env['PLAYROOM_AUTH_URL'] || AUTH_CONFIG.authUrl).replace(/\/+$/, '')
}
/** As the licence section: shown in development, in a beta build, when asked for, or once enforced. */
const visible =
  !app.isPackaged ||
  app.getVersion().includes('-beta') ||
  licenceEnforced(app.getVersion()) ||
  process.env['PLAYROOM_LICENCE_UI'] === '1'

/** What account.json holds: who, and the refresh token sealed. */
interface Stored {
  sub: string
  email?: string
  name?: string
  refreshSealed: string
}

function filePath(): string {
  return join(app.getPath('userData'), 'account.json')
}

const fileStore: SessionStore = {
  load() {
    let s: Stored
    try {
      s = JSON.parse(readFileSync(filePath(), 'utf8')) as Stored
    } catch {
      return null
    }
    try {
      const refreshToken = safeStorage.decryptString(Buffer.from(s.refreshSealed, 'base64'))
      return { refreshToken, sub: s.sub, email: s.email, name: s.name }
    } catch (err) {
      // A keychain that no longer opens it: sign in again.
      log.warn('account: the stored session could not be decrypted', err)
      return null
    }
  },
  save(s: StoredSession | null) {
    if (!s || !safeStorage.isEncryptionAvailable()) {
      // Without the keychain the session lasts this launch only: a refresh
      // token is never written out in the clear.
      rmSync(filePath(), { force: true })
      return
    }
    const out: Stored = {
      sub: s.sub,
      email: s.email,
      name: s.name,
      refreshSealed: safeStorage.encryptString(s.refreshToken).toString('base64')
    }
    writeFileSync(filePath(), JSON.stringify(out, null, 2) + '\n', {
      encoding: 'utf8',
      mode: 0o600
    })
  }
}

let session: Session | undefined
let signingIn: AbortController | null = null

function theSession(): Session {
  session ??= new Session(cfg, fileStore, fetch, Date.now, () => broadcast())
  return session
}

export function accountStatus(): AccountStatus {
  const who = theSession().identity()
  return {
    signedIn: who !== null,
    email: who?.email,
    name: who?.name,
    signingIn: signingIn !== null,
    visible
  }
}

const listeners: ((status: AccountStatus) => void)[] = []

/** Tells `fn` whenever someone signs in or out, or a sign-in starts or ends (main/licence.ts). */
export function onAccountChange(fn: (status: AccountStatus) => void): void {
  listeners.push(fn)
}

function broadcast(): AccountStatus {
  const status = accountStatus()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.account.changed, status)
  }
  for (const fn of listeners) fn(status)
  return status
}

/** A new access token, the last one having been refused by the account API. */
export function refreshAccess(): Promise<string> {
  return theSession().refresh()
}

/** A current access token for the account API (main only; never handed to the renderer). */
export function accessToken(): Promise<string> {
  return theSession().accessToken()
}

/** Opens the browser and waits (up to five minutes) for the user to sign in there. */
export async function signIn(): Promise<AccountStatus> {
  signingIn?.abort()
  const controller = new AbortController()
  signingIn = controller
  broadcast()
  try {
    const who = await theSession().signIn({
      port: REDIRECT_PORT,
      signal: controller.signal,
      openBrowser: (url) => shell.openExternal(url)
    })
    log.info(`account: signed in (${who.sub})`)
    // Back to the app from the browser.
    const win = BrowserWindow.getAllWindows()[0]
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore()
      win.show()
      app.focus({ steal: true })
    }
  } catch (err) {
    if (err instanceof OAuthError && err.code === 'cancelled') return accountStatus()
    log.warn('account: sign-in failed', err)
    throw err
  } finally {
    if (signingIn === controller) signingIn = null
    broadcast()
  }
  return accountStatus()
}

export function cancelSignIn(): AccountStatus {
  signingIn?.abort()
  return accountStatus()
}

export async function signOut(): Promise<AccountStatus> {
  const s = theSession()
  const token = s.identity() ? await s.accessToken().catch(() => null) : null
  s.signOut()
  log.info('account: signed out')
  if (token) {
    void endSession(cfg, token, fetch).catch((err) =>
      log.warn('account: ending the session on the server failed', err)
    )
  }
  return broadcast()
}

/** At ready: check a kept session is still good (a revoked one signs out here). */
export function startAccount(): void {
  if (process.env['PLAYROOM_HIDDEN'] === '1') return
  const s = theSession()
  if (!s.identity()) return
  void s.refresh().catch((err) => {
    if (err instanceof OAuthError && err.code === 'signed-out')
      log.info('account: the session had ended; signed out')
    else log.warn('account: the launch check failed', err)
  })
}
