/**
 * The entitlement token: what the PIXL account allows on this device, as
 * pixlfoundation.com's Worker signed it. A compact JWS (EdDSA, Ed25519)
 * checked offline against public keys built into the app, so editing
 * licence.json grants nothing. Its `exp` is the offline grace: past it, the
 * app has to reach the server again.
 *
 * Turning the clock back mustn't stretch the grace, so time is measured
 * from the latest moment the app has seen (`seenAt`, kept beside the token)
 * or the token's own `iat`, whichever is later. Free of Electron, for
 * tests/account.test.ts.
 */
import { createPublicKey, verify, type KeyObject } from 'node:crypto'
import type { EntitlementClaims } from '../../shared/account'

/** Public keys by `kid`: base64url of the raw 32-byte Ed25519 key. */
export type EntitlementKeys = Record<string, string>

export type EntitlementProblem =
  'malformed' | 'unknown-key' | 'signature' | 'issuer' | 'audience' | 'device' | 'expired'

export type EntitlementCheck =
  | { ok: true; claims: EntitlementClaims; refreshDue: boolean }
  | { ok: false; problem: EntitlementProblem }

export const ENTITLEMENT_ISSUER = 'pixlfoundation.com'

const keyCache = new Map<string, KeyObject>()

function publicKey(raw: string): KeyObject {
  let k = keyCache.get(raw)
  if (!k) {
    k = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw }, format: 'jwk' })
    keyCache.set(raw, k)
  }
  return k
}

function decode(part: string): unknown {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function wellFormed(c: unknown): c is EntitlementClaims {
  if (!c || typeof c !== 'object') return false
  const o = c as Record<string, unknown>
  const ent = o.ent as Record<string, unknown> | undefined
  return (
    typeof o.sub === 'string' &&
    typeof o.aud === 'string' &&
    typeof o.dev === 'string' &&
    typeof o.iss === 'string' &&
    isNum(o.iat) &&
    isNum(o.exp) &&
    isNum(o.rfa) &&
    !!ent &&
    typeof ent === 'object' &&
    Array.isArray(ent.addons)
  )
}

/** The moment to judge the token at, in Unix seconds: never earlier than any moment already seen. */
export function effectiveNow(nowMs: number, seenAtMs: number | undefined, iat?: number): number {
  return Math.max(nowMs, seenAtMs ?? 0, (iat ?? 0) * 1000) / 1000
}

export function checkEntitlement(
  token: string,
  opts: {
    keys: EntitlementKeys
    product: string
    device: string
    nowMs: number
    seenAtMs?: number
  }
): EntitlementCheck {
  const parts = token.split('.')
  if (parts.length !== 3) return { ok: false, problem: 'malformed' }
  const [h, p, s] = parts
  let header: { alg?: string; kid?: string }
  let claims: unknown
  try {
    header = decode(h) as { alg?: string; kid?: string }
    claims = decode(p)
  } catch {
    return { ok: false, problem: 'malformed' }
  }
  if (header?.alg !== 'EdDSA') return { ok: false, problem: 'malformed' }
  const raw = header.kid !== undefined ? opts.keys[header.kid] : undefined
  if (!raw) return { ok: false, problem: 'unknown-key' }
  let good = false
  try {
    good = verify(null, Buffer.from(`${h}.${p}`), publicKey(raw), Buffer.from(s, 'base64url'))
  } catch {
    good = false
  }
  if (!good) return { ok: false, problem: 'signature' }
  if (!wellFormed(claims)) return { ok: false, problem: 'malformed' }
  if (claims.iss !== ENTITLEMENT_ISSUER) return { ok: false, problem: 'issuer' }
  if (claims.aud !== opts.product) return { ok: false, problem: 'audience' }
  if (claims.dev !== opts.device) return { ok: false, problem: 'device' }
  const now = effectiveNow(opts.nowMs, opts.seenAtMs, claims.iat)
  if (now >= claims.exp) return { ok: false, problem: 'expired' }
  return { ok: true, claims, refreshDue: now >= claims.rfa }
}
