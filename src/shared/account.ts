/**
 * The PIXL account: one account across PIXL's apps, held by Supabase Auth
 * (project pixl-core) acting as an OAuth 2.1 server. The app is a public
 * client: it signs in through the system browser with PKCE and gets the code
 * back on a fixed loopback port. What the account holds for this app (beta
 * access, the trial, the licence) comes from pixlfoundation.com's Worker as
 * an Ed25519-signed entitlement token, checked offline (main/account/).
 *
 * The contract with pixl-web (endpoints, claims, the device hash, error
 * codes) was agreed on 2026-10-01 and lives in pixl-web's TODO ("PIXL
 * account" → "Contract with the apps"); the types here mirror it.
 */

/** This app's name in the contract: the entitlement token's `aud`, the requests' `product`. */
export const PRODUCT = 'playroom'

/** Supabase Auth on pixl-core. PLAYROOM_AUTH_URL points it at scripts/mock-account.mjs. */
export const AUTH_URL = 'https://lskosagqyekwklxyuczi.supabase.co/auth/v1'
/** The Worker's account API. PLAYROOM_ACCOUNT_URL points it at the mock too. */
export const ACCOUNT_API = 'https://pixlfoundation.com/api'
/** The "Pixl Playroom" OAuth client on pixl-core: public, PKCE only. */
export const CLIENT_ID = '83eab600-baf2-4f5e-aac4-252010db94b2'
/** pixl-core's publishable key, sent as `apikey`; public by design. */
export const PUBLISHABLE_KEY = 'sb_publishable_1ozNwiLZxZLPZO3LEK5LHw_9VVf6A7G'
/** Supabase matches redirect URIs exactly, so the port is fixed (and registered). */
export const REDIRECT_PORT = 47823
export const REDIRECT_PATH = '/callback'
export const SCOPES = 'openid email profile'

export interface AuthConfig {
  authUrl: string
  clientId: string
  apiKey: string
  scopes: string
}

export const AUTH_CONFIG: AuthConfig = {
  authUrl: AUTH_URL,
  clientId: CLIENT_ID,
  apiKey: PUBLISHABLE_KEY,
  scopes: SCOPES
}

/**
 * The roots the app trusts: Ed25519 public keys (base64url, raw 32 bytes)
 * whose private halves are kept offline by the owner, never on a server
 * (scripts/entitlement-keys.mjs). A root signs the key set the Worker sends
 * with each token, naming the signing keys valid now, so those can be
 * rotated or revoked without a release. root-2 is the spare: changing roots
 * is the only key change that needs a release.
 */
export const ROOT_KEYS: Record<string, string> = {
  'root-1': 'C9EdMvVbY6ZY3MM9_3pg-YxeJuGLiHLTqhFxEz2cd0g',
  'root-2': 'CRSgddfssdTYmQQriIHmyOc-IEjaDGZz_U0Oi0Tvu8U'
}

/**
 * The development root, trusted only by unpackaged builds: its private key
 * is in scripts/mock-account.mjs, in the open, so the mock can sign.
 */
export const DEV_ROOT_KEYS: Record<string, string> = {
  'dev-root': 'mvSbsudfbttEQ4sOYN5zX8IBPisy9FoykmgqoMis_FM'
}

/** What /api/entitlements and /api/trials answer. */
export interface EntitlementResponse {
  /** The entitlement token (a JWS, EdDSA). */
  token: string
  /** The signing keys valid now (a JWS, signed by a root). */
  keyset: string
}

/** What a device sends with each request. */
export interface DeviceInfo {
  deviceHash: string
  deviceName: string
  os: 'macos' | 'windows' | 'linux'
}

/** A device on the account, as `device_limit` lists them. */
export interface AccountDevice {
  id: string
  name: string
  lastSeen?: string
}

/** What an entitlement token holds for this account, product and device. */
export interface Entitlements {
  /** Beta access; no `until` means until the beta ends. */
  beta?: { until?: number }
  trial?: { until: number }
  licence?: { since: number }
  addons: string[]
}

/** The entitlement token's payload. Times are Unix seconds. */
export interface EntitlementClaims {
  iss: string
  /** The account's id. */
  sub: string
  aud: string
  /** This device's hash, as the app sent it. */
  dev: string
  iat: number
  /** The end of the offline grace. */
  exp: number
  /** When the app should fetch a fresh token. */
  rfa: number
  email?: string
  ent: Entitlements
  /** A tester's discount code on the account, once the beta has ended. */
  discount?: { code: string; expires: number }
}

/** The Worker's refusals, as `{ error, ... }` JSON. */
export type AccountApiError =
  | 'auth'
  | 'device_limit'
  | 'trial_used_account'
  | 'trial_used_device'
  | 'no_beta'
  | 'beta_ended'
  | 'wrong_client'
  | 'bad_request'
  | 'too_many'

/** The account, as Settings shows it. No token ever reaches the renderer. */
export interface AccountStatus {
  signedIn: boolean
  email?: string
  name?: string
  /** A browser sign-in is waiting for the user. */
  signingIn: boolean
  /** Settings shows the account (development, PLAYROOM_LICENCE_UI=1, or once licences are enforced). */
  visible: boolean
}
