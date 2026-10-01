/**
 * The entitlement token: what the PIXL account allows on this device, as
 * pixlfoundation.com's Worker signed it. A compact JWS (EdDSA, Ed25519)
 * checked offline against public keys built into the app, so editing
 * licence.json grants nothing. Its `exp` is the offline grace: past it, the
 * app has to reach the server again.
 *
 * Turning the clock back mustn't stretch the grace, so time is measured
 * from the latest moment the app has seen (`seenAt`, kept beside the token)
 * or the token's own `iat`, whichever is later.
 *
 * Which signing keys are good comes from a key set signed by a root the app
 * ships with (`checkKeyset`, shared/account.ts ROOT_KEYS), so the Worker's
 * keys can change without a release. Free of Electron, for
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
/** The contract's 30 days, and a day's slack. */
const MAX_LIFETIME_S = 31 * 24 * 60 * 60

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

type Jws =
  | { ok: true; header: { alg: string; kid: string; typ?: string }; payload: unknown }
  | { ok: false; problem: 'malformed' | 'unknown-key' | 'signature' }

/** A compact JWS signed (EdDSA) by one of `keys`, by its `kid`; its payload not yet judged. */
function verifyJws(jws: string, keys: EntitlementKeys): Jws {
  const parts = jws.split('.')
  if (parts.length !== 3) return { ok: false, problem: 'malformed' }
  const [h, p, s] = parts
  let header: { alg?: unknown; kid?: unknown; typ?: unknown }
  let payload: unknown
  try {
    header = decode(h) as typeof header
    payload = decode(p)
  } catch {
    return { ok: false, problem: 'malformed' }
  }
  if (header?.alg !== 'EdDSA') return { ok: false, problem: 'malformed' }
  const kid = typeof header.kid === 'string' ? header.kid : undefined
  const raw = kid !== undefined && Object.hasOwn(keys, kid) ? keys[kid] : undefined
  if (!kid || !raw) return { ok: false, problem: 'unknown-key' }
  let good = false
  try {
    good = verify(null, Buffer.from(`${h}.${p}`), publicKey(raw), Buffer.from(s, 'base64url'))
  } catch {
    good = false
  }
  if (!good) return { ok: false, problem: 'signature' }
  const typ = typeof header.typ === 'string' ? header.typ : undefined
  return { ok: true, header: { alg: 'EdDSA', kid, typ }, payload }
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
  const jws = verifyJws(token, opts.keys)
  if (!jws.ok) return jws
  // A key set is never a token, whoever signed it.
  if (jws.header.typ === KEYSET_TYPE) return { ok: false, problem: 'malformed' }
  const claims = jws.payload
  if (!wellFormed(claims)) return { ok: false, problem: 'malformed' }
  if (claims.iss !== ENTITLEMENT_ISSUER) return { ok: false, problem: 'issuer' }
  if (claims.aud !== opts.product) return { ok: false, problem: 'audience' }
  if (claims.dev !== opts.device) return { ok: false, problem: 'device' }
  // No token lasts longer than the offline grace the contract sets.
  if (claims.exp - claims.iat > MAX_LIFETIME_S) return { ok: false, problem: 'malformed' }
  const now = effectiveNow(opts.nowMs, opts.seenAtMs, claims.iat)
  if (now >= claims.exp) return { ok: false, problem: 'expired' }
  return { ok: true, claims, refreshDue: now >= claims.rfa }
}

export const KEYSET_TYPE = 'pixl-keyset'

export type KeysetCheck =
  | { ok: true; keys: EntitlementKeys; iat: number }
  | { ok: false; problem: 'malformed' | 'unknown-key' | 'signature' | 'issuer' | 'stale' }

const RAW_KEY = /^[A-Za-z0-9_-]{43}$/

/**
 * The key set that comes with each token: the signing keys valid now,
 * signed by a root the app ships with. One older than the newest already
 * seen (`minIat`) is refused, so a key dropped from the set (a leaked one)
 * can't be brought back by replaying an old set.
 */
export function checkKeyset(jws: string, roots: EntitlementKeys, minIat = 0): KeysetCheck {
  const v = verifyJws(jws, roots)
  if (!v.ok) return v
  if (v.header.typ !== KEYSET_TYPE) return { ok: false, problem: 'malformed' }
  const o = v.payload as { iss?: unknown; iat?: unknown; keys?: unknown } | null
  if (!o || typeof o !== 'object' || !isNum(o.iat) || !o.keys || typeof o.keys !== 'object')
    return { ok: false, problem: 'malformed' }
  if (o.iss !== ENTITLEMENT_ISSUER) return { ok: false, problem: 'issuer' }
  const keys: EntitlementKeys = {}
  for (const [kid, raw] of Object.entries(o.keys as Record<string, unknown>)) {
    if (typeof raw !== 'string' || !RAW_KEY.test(raw)) return { ok: false, problem: 'malformed' }
    // A signing key can't pose as a root's kid: roots sign key sets, nothing else.
    if (Object.hasOwn(roots, kid)) return { ok: false, problem: 'malformed' }
    keys[kid] = raw
  }
  if (o.iat < minIat) return { ok: false, problem: 'stale' }
  return { ok: true, keys, iat: o.iat }
}
