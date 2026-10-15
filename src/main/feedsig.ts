/**
 * The update feed's own signature, checked before an update is downloaded.
 *
 * electron-updater trusts the feed (latest.yml, beta.yml and their -mac
 * twins) for what to install: it checks the download against the feed's
 * sha512, and the feed comes from the same bucket and release as the
 * installer. Until the builds are code-signed on both platforms, whoever
 * could write to the bucket could ship an installer. So each feed carries
 * `pixlSignature`, a compact JWS (EdDSA, Ed25519, as the entitlement token:
 * account/entitlement.ts) over the version and every file's url and sha512,
 * made at release by scripts/feed-sign.mjs with an offline key whose public
 * half is built in here. An update whose feed is unsigned, signed by a key
 * the app does not hold, or names other files than it signed is never
 * downloaded.
 *
 * `stagingPercentage` and the release notes are not signed: a staged rollout
 * changes the percentage without the key (scripts/rollout.mjs).
 *
 * Free of Electron, for tests/feedsig.test.ts.
 */
import { verifyJws, type EntitlementKeys } from './account/entitlement'

/**
 * The feed keys the app trusts, by `kid`: base64url of the raw 32-byte
 * Ed25519 public key (`node scripts/feed-sign.mjs key <kid>` makes one and
 * prints this line; the private key never enters the repo). Two at once is
 * how a key is changed: sign with the new one once a release holding both
 * is out. While none is built in, a feed is read unchecked and the log says
 * so (the first release holding a key starts the checks).
 */
export const FEED_KEYS: EntitlementKeys = {}

/** The JWS header's `typ`: a feed signature is never a token or a key set. */
export const FEED_TYPE = 'pixl-feed'

/** One file of a feed, as signed. */
export interface FeedFile {
  url: string
  sha512: string
}

/** What a feed's signature covers. */
export interface FeedClaims {
  version: string
  files: FeedFile[]
  iat: number
}

export type FeedCheck =
  | { ok: true; kid: string }
  | {
      ok: false
      problem: 'unsigned' | 'malformed' | 'unknown-key' | 'signature' | 'version' | 'files'
    }

/** The parts of electron-updater's UpdateInfo the check reads (the feed as parsed). */
export interface FeedInfo {
  version: string
  files?: readonly { url: string; sha512: string }[]
  pixlSignature?: unknown
}

const fileKey = (f: { url: string; sha512: string }): string => `${f.url}\n${f.sha512}`

function wellFormed(c: unknown): c is FeedClaims {
  if (!c || typeof c !== 'object') return false
  const o = c as Record<string, unknown>
  return (
    typeof o.version === 'string' &&
    typeof o.iat === 'number' &&
    Array.isArray(o.files) &&
    o.files.length > 0 &&
    o.files.every(
      (f) =>
        !!f &&
        typeof f === 'object' &&
        typeof (f as FeedFile).url === 'string' &&
        typeof (f as FeedFile).sha512 === 'string'
    )
  )
}

/**
 * Whether a feed is one the release signed: its signature good by one of
 * `keys`, of this version, naming exactly the files electron-updater would
 * download (by url and sha512, which it checks the download against).
 */
export function checkFeed(info: FeedInfo, keys: EntitlementKeys): FeedCheck {
  const sig = info.pixlSignature
  if (typeof sig !== 'string' || sig === '') return { ok: false, problem: 'unsigned' }
  const v = verifyJws(sig, keys)
  if (!v.ok) return v
  if (v.header.typ !== FEED_TYPE || !wellFormed(v.payload))
    return { ok: false, problem: 'malformed' }
  const claims = v.payload
  if (claims.version !== info.version) return { ok: false, problem: 'version' }
  const files = info.files ?? []
  const signed = new Set(claims.files.map(fileKey))
  if (
    files.length === 0 ||
    files.length !== signed.size ||
    !files.every((f) => signed.has(fileKey(f)))
  )
    return { ok: false, problem: 'files' }
  return { ok: true, kid: v.header.kid }
}
