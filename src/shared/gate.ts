/**
 * The beta gate: in a beta build, nothing opens until the window knows the
 * account has beta access. Pure, for tests/gate.test.ts; main/gate.ts feeds
 * it and enforces it (the IPC calls a gated window may still make), and the
 * renderer shows it (views/Gate.tsx).
 */
import type { AccountDevice } from './account'
import type { LicenceState } from './licence'

export const BETA_URL = 'https://playroom.pixlfoundation.com/beta/'

export type GateState =
  /** Nothing in the way. */
  | { kind: 'open' }
  /** Not known yet (the device is being read): the launch waits, briefly. */
  | { kind: 'pending' }
  /** Signed out: sign in with a PIXL account that's in the beta. */
  | { kind: 'sign-in' }
  /** Signed in, access not confirmed yet (no answer, or offline past the month). */
  | { kind: 'checking'; offline: boolean }
  /** Signed in with an account that hasn't joined the beta. */
  | { kind: 'join' }
  /** The beta is over: update to the released app. */
  | { kind: 'beta-ended' }
  /** The account's devices are all taken: free one. */
  | { kind: 'device-limit'; devices: AccountDevice[] }

export interface GateInput {
  /** A beta build (its version has -beta). */
  betaBuild: boolean
  /** Development and automation skip the gate (PLAYROOM_BETA_GATE=1 brings it back). */
  skip: boolean
  /** The device has been read, so the state below can be trusted. */
  ready: boolean
  signedIn: boolean
  state: LicenceState
  /** policy.json's betaOpen; undefined when it says nothing. */
  betaOpen: boolean | undefined
}

export function gateFor(i: GateInput): GateState {
  if (!i.betaBuild || i.skip) return { kind: 'open' }
  if (i.betaOpen === false) return { kind: 'beta-ended' }
  if (!i.signedIn) return { kind: 'sign-in' }
  if (!i.ready) return { kind: 'pending' }
  switch (i.state.kind) {
    case 'beta':
    case 'licensed':
      return { kind: 'open' }
    case 'beta-ended':
      return { kind: 'beta-ended' }
    case 'device-limit':
      return { kind: 'device-limit', devices: i.state.devices }
    case 'checking':
      return { kind: 'checking', offline: false }
    case 'revalidate':
      return { kind: 'checking', offline: true }
    default:
      // No beta on the account (a trial, or nothing): join it.
      return { kind: 'join' }
  }
}

/**
 * What a gated window may still ask the main process: signing in, access,
 * updates, settings and the app's own housekeeping. The library, develop,
 * export and the rest wait for the gate to open.
 */
export function allowedWhileGated(channel: string): boolean {
  return /^(account|licence|updates|prefs|app):/.test(channel)
}
