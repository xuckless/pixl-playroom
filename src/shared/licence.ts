/**
 * Access: what the PIXL account allows on this device, read from the
 * entitlement token pixlfoundation.com signs (main/account/). A 14-day
 * trial (one per account and one per device, decided by the server), a
 * licence bought once for up to three devices, or beta access in a beta
 * build. The token lasts a month offline before the app has to reach the
 * server again. Pure, so the rules can be tested; main/account/access.ts
 * keeps the token and talks to the server.
 *
 * Buying happens on the website (Lemon Squeezy, set up there): the app only
 * opens BUY_URL and sees the licence on the account.
 *
 * Enforced from 1.0 (`licenceEnforced`): before that, `allows` says yes to
 * everything, whatever the state, and a beta build is held by the beta gate
 * (shared/gate.ts) instead.
 */
import type { AccountDevice, EntitlementClaims } from './account'
import { t, tp } from './i18n'

/**
 * Whether this version enforces licences: a release from 1.0.0 on. Betas
 * and 0.x releases don't (the beta gate holds beta builds).
 */
export function licenceEnforced(version: string): boolean {
  const m = /^(\d+)\.\d+\.\d+(-.+)?$/.exec(version)
  return !!m && Number(m[1]) >= 1 && m[2] === undefined
}

/** Kept for callers that don't know the version: off. main/licence.ts passes the real answer. */
export const LICENCE_ENFORCED = false

/**
 * What lapsed access (no account, an ended trial, a token not renewed within
 * the offline grace) locks: exporting, and nothing else. Browsing and
 * editing stay open, so nothing already made is held back.
 */
export const LICENSED = ['export'] as const
export type Licensed = (typeof LICENSED)[number]

/** What the app shows; the server holds the real rules. */
export const LICENCE_RULES = {
  deviceLimit: 3,
  trialDays: 14,
  offlineGraceDays: 30
}

export const BUY_URL = 'https://playroom.pixlfoundation.com/#pricing'
export const ACCOUNT_URL = 'https://pixlfoundation.com/account/'

const DAY_S = 24 * 60 * 60

export type LicenceState =
  /** No PIXL account signed in. */
  | { kind: 'signed-out' }
  /** Signed in, and the account hasn't been asked yet (or couldn't be). */
  | { kind: 'checking' }
  /** Signed in with nothing on the account for this app: the trial can start. */
  | { kind: 'no-trial' }
  | { kind: 'trial'; daysLeft: number }
  | { kind: 'trial-ended' }
  | { kind: 'licensed'; offlineDaysLeft: number }
  /** A beta build, and the account has beta access. */
  | { kind: 'beta'; offlineDaysLeft: number }
  /** The token's offline grace ran out: connect to continue. */
  | { kind: 'revalidate' }
  /** The licence is on as many devices as it allows; free one to use it here. */
  | { kind: 'device-limit'; devices: AccountDevice[] }
  /** A beta build, and the account hasn't joined the beta. */
  | { kind: 'no-beta' }
  /** A beta build, after the beta has ended. */
  | { kind: 'beta-ended' }

export interface LicenceInput {
  signedIn: boolean
  /** The entitlement token's claims, verified; null when there is none good. */
  claims: EntitlementClaims | null
  /** There was a token, but its offline grace has run out. */
  expired: boolean
  /** The server refused this device for the device limit, with the account's devices. */
  deviceLimit: AccountDevice[] | null
  /** The server refused this beta build: not in the beta, or the beta has ended. */
  refusal?: 'no_beta' | 'beta_ended' | null
  betaBuild: boolean
  /** Now, in Unix seconds, never earlier than a moment already seen. */
  now: number
}

export function licenceState(i: LicenceInput): LicenceState {
  if (!i.signedIn) return { kind: 'signed-out' }
  if (i.deviceLimit) return { kind: 'device-limit', devices: i.deviceLimit }
  if (i.refusal === 'beta_ended') return { kind: 'beta-ended' }
  if (i.refusal === 'no_beta') return { kind: 'no-beta' }
  const c = i.claims
  if (!c) return i.expired ? { kind: 'revalidate' } : { kind: 'checking' }
  const offlineDaysLeft = Math.max(0, Math.floor((c.exp - i.now) / DAY_S))
  const { beta, licence, trial } = c.ent
  if (licence) return { kind: 'licensed', offlineDaysLeft }
  if (i.betaBuild && beta && (beta.until === undefined || beta.until > i.now))
    return { kind: 'beta', offlineDaysLeft }
  if (trial) {
    const left = trial.until - i.now
    return left > 0 ? { kind: 'trial', daysLeft: Math.ceil(left / DAY_S) } : { kind: 'trial-ended' }
  }
  return { kind: 'no-trial' }
}

export interface LicenceStatus {
  state: LicenceState
  enforced: boolean
  deviceLimit: number
  /** A tester's discount code, once the beta has ended. */
  discount?: { code: string; expires: number }
  /** When the account was last confirmed (the token's iat), in ms. */
  confirmedAt?: number
  /** Why exporting is refused, in plain words; null while it is allowed. */
  locked: string | null
  /** Settings shows the access section (development, PLAYROOM_LICENCE_UI=1, or once enforced). */
  visible: boolean
}

export function licenceStatus(
  input: LicenceInput,
  visible: boolean,
  enforced = LICENCE_ENFORCED
): LicenceStatus {
  const state = licenceState(input)
  return {
    state,
    enforced,
    deviceLimit: LICENCE_RULES.deviceLimit,
    discount: input.claims?.discount,
    confirmedAt: input.claims ? input.claims.iat * 1000 : undefined,
    locked: lockedReason(state, enforced),
    visible: visible || enforced
  }
}

/** Whether `what` is allowed in `state`. Always yes until licensing is enforced. */
export function allows(state: LicenceState, what: Licensed, enforced = LICENCE_ENFORCED): boolean {
  void what // every licensed feature is locked by the same states
  if (!enforced) return true
  return state.kind === 'trial' || state.kind === 'licensed' || state.kind === 'beta'
}

/** Why exporting is refused in `state`, or null when it isn't. */
export function lockedReason(state: LicenceState, enforced = LICENCE_ENFORCED): string | null {
  if (allows(state, 'export', enforced)) return null
  switch (state.kind) {
    case 'signed-out':
      return t(
        'Sign in with your PIXL account to start your free trial, or to use your licence. Editing still works.'
      )
    case 'checking':
      return t(
        'Playroom needs to check your account before it exports. Connect to the internet, then choose Check now in Settings.'
      )
    case 'no-trial':
      return t(
        'Start your free {{days}}-day trial in Settings, or buy a licence, to export. Editing still works.',
        { days: LICENCE_RULES.trialDays }
      )
    case 'trial-ended':
      return t('Your free trial has ended. Buy a licence to export again. Editing still works.')
    case 'revalidate':
      return t(
        'Playroom needs to confirm your licence before it exports again. Connect to the internet, then choose Check now in Settings.'
      )
    case 'device-limit':
      return tp(
        'Your licence is already on {{count}} device. Free one in Settings to use it here. Editing still works.',
        'Your licence is already on {{count}} devices. Free one in Settings to use it here. Editing still works.',
        LICENCE_RULES.deviceLimit
      )
    case 'no-beta':
      return t(
        'This account isn’t in the beta. Join it on the beta page, or use the released Pixl Playroom.'
      )
    case 'beta-ended':
      return t('The beta has ended. Update to the released Pixl Playroom to keep going.')
    default:
      return null
  }
}

export class LicenceError extends Error {
  /** locked: what was asked for needs access the account doesn't give (`allows`). */
  readonly code: 'locked'
  constructor(message: string, code: LicenceError['code']) {
    super(message)
    this.name = 'LicenceError'
    this.code = code
  }
}
