/**
 * The release policy, read from updates.pixlfoundation.com/playroom/policy.json
 * (scripts/policy.mjs writes it): an update floor, below which the app
 * stops and asks for the update, and whether the beta is still open (Pass
 * 26a reads that). Pure, for tests/policy.test.ts; main/policy.ts fetches it.
 */

export interface Policy {
  /** Versions below this one must update before they go on. */
  minVersion?: string
  /** False once 1.0 is out: beta builds then say the beta has ended. */
  betaOpen?: boolean
  /** Said beside "Update required" (why this update matters). */
  message?: string
}

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

/** A policy.json, judged field by field: anything malformed is left out, never guessed at. */
export function parsePolicy(json: unknown): Policy {
  if (!json || typeof json !== 'object') return {}
  const o = json as Record<string, unknown>
  const p: Policy = {}
  if (typeof o.minVersion === 'string' && VERSION.test(o.minVersion)) p.minVersion = o.minVersion
  if (typeof o.betaOpen === 'boolean') p.betaOpen = o.betaOpen
  if (typeof o.message === 'string' && o.message.trim()) p.message = o.message.trim().slice(0, 500)
  return p
}

/**
 * Semantic-version order: <0, 0 or >0. A prerelease comes before its release
 * (0.2.0-beta.3 < 0.2.0), and its parts compare as numbers where both are
 * numbers (beta.2 < beta.10). Something that isn't a version sorts first.
 */
export function compareVersions(a: string, b: string): number {
  const x = VERSION.exec(a)
  const y = VERSION.exec(b)
  if (!x || !y) return x ? 1 : y ? -1 : 0
  for (let i = 1; i <= 3; i++) {
    const d = Number(x[i]) - Number(y[i])
    if (d !== 0) return Math.sign(d)
  }
  const pa = x[4]?.split('.')
  const pb = y[4]?.split('.')
  if (!pa || !pb) return pa ? -1 : pb ? 1 : 0
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === undefined) return -1
    if (pb[i] === undefined) return 1
    const na = /^\d+$/.test(pa[i]) ? Number(pa[i]) : NaN
    const nb = /^\d+$/.test(pb[i]) ? Number(pb[i]) : NaN
    if (!isNaN(na) && !isNaN(nb)) {
      if (na !== nb) return Math.sign(na - nb)
    } else if (!isNaN(na)) return -1
    else if (!isNaN(nb)) return 1
    else if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1
  }
  return 0
}

/** Whether `version` is below the policy's floor. */
export function belowFloor(version: string, policy: Policy): boolean {
  return policy.minVersion !== undefined && compareVersions(version, policy.minVersion) < 0
}

/**
 * The website's download link for this platform (pixl-web's redirect to
 * the newest file in the channel's feed): the way out when the app can't
 * update itself.
 */
export function downloadUrl(platform: string, arch: string, channel: 'latest' | 'beta'): string {
  const os = platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : 'linux'
  const q = channel === 'beta' ? '?channel=beta' : ''
  return `https://playroom.pixlfoundation.com/download/${os}-${arch}${q}`
}
