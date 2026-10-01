/**
 * Licensing: a key bought through Lemon Squeezy, active on up to three
 * devices at a time (deactivate one to add another), a 14-day trial from the
 * first launch, and a month offline before the app asks to confirm the
 * licence again. Pure (fetch is passed in), so the rules can be tested;
 * main/licence.ts keeps the file and talks to the bridge.
 *
 * Not enforced yet: with LICENCE_ENFORCED false, `allows` says yes to
 * everything, whatever the state. Turning it on also needs LS_PRODUCT set.
 */

export const LICENCE_ENFORCED = false

/**
 * What a lapsed licence (an ended trial, a licence not confirmed within the
 * offline grace, a device no longer activated) locks: exporting, and nothing
 * else. Browsing and editing stay open, so nothing already made is held back.
 */
export const LICENSED = ['export'] as const
export type Licensed = (typeof LICENSED)[number]

export const LICENCE_RULES = {
  /** Set as the activation limit on the product in Lemon Squeezy; this is what the app shows. */
  deviceLimit: 3,
  trialDays: 14,
  /** How long a licence stays good without reaching the licence server. */
  offlineGraceDays: 30,
  /** How often, at most, a launch re-validates the licence. */
  revalidateAfterDays: 1
}

/** Lemon Squeezy's public licence API. PLAYROOM_LICENCE_API points it elsewhere (our Worker, later). */
export const LICENCE_API = 'https://api.lemonsqueezy.com/v1/licenses'

/** Our store and product in Lemon Squeezy. Null until the store exists: any product's key passes. */
export const LS_PRODUCT: { storeId: number | null; productId: number | null } = {
  storeId: null,
  productId: null
}

export const BUY_URL = 'https://playroom.pixlfoundation.com/#pricing'
export const ACCOUNT_URL = 'https://pixlfoundation.com/account/'

const DAY = 24 * 60 * 60 * 1000

export interface LicenceRecord {
  key: string
  instanceId: string
  instanceName: string
  customerName?: string
  customerEmail?: string
  activatedAt: string
  lastValidatedAt: string
  activationUsage?: number
  activationLimit?: number
  /** `active` until the server says the key or this device's activation is no longer good. */
  status: 'active' | 'inactive'
  /** The server's reason, when it stopped being active. */
  reason?: string
}

/** What licence.json holds. */
export interface LicenceFile {
  trialStartedAt?: string
  licence?: LicenceRecord
}

export type LicenceState =
  | { kind: 'trial'; daysLeft: number }
  | { kind: 'trial-ended' }
  /** Licensed, and confirmed within the offline grace. */
  | { kind: 'licensed'; offlineDaysLeft: number }
  /** Licensed, but not confirmed for longer than the grace: connect to continue. */
  | { kind: 'revalidate' }
  /** The server stopped honouring this device's activation (deactivated elsewhere, refunded…). */
  | { kind: 'inactive'; reason: string }

export interface LicenceStatus {
  state: LicenceState
  enforced: boolean
  deviceLimit: number
  devicesUsed?: number
  /** The key's last four characters, for display. */
  keyHint?: string
  customerName?: string
  customerEmail?: string
  lastValidatedAt?: string
  /** Why exporting is refused, in plain words; null while it is allowed. */
  locked: string | null
  /** Settings shows the licence section (development, or PLAYROOM_LICENCE_UI=1, or once enforced). */
  visible: boolean
}

export function keyHint(key: string): string {
  return `…${key.replace(/[^A-Za-z0-9]/g, '').slice(-4)}`
}

export function licenceState(file: LicenceFile, now: Date): LicenceState {
  const l = file.licence
  if (l) {
    if (l.status !== 'active')
      return { kind: 'inactive', reason: l.reason ?? 'This device is no longer activated.' }
    const since = (now.getTime() - Date.parse(l.lastValidatedAt)) / DAY
    const left = Math.floor(LICENCE_RULES.offlineGraceDays - since)
    return left < 0 ? { kind: 'revalidate' } : { kind: 'licensed', offlineDaysLeft: left }
  }
  const start = file.trialStartedAt ? Date.parse(file.trialStartedAt) : now.getTime()
  const used = Math.floor((now.getTime() - start) / DAY)
  const daysLeft = LICENCE_RULES.trialDays - used
  return daysLeft > 0 ? { kind: 'trial', daysLeft } : { kind: 'trial-ended' }
}

export function licenceStatus(file: LicenceFile, now: Date, visible: boolean): LicenceStatus {
  const l = file.licence
  const state = licenceState(file, now)
  return {
    state,
    enforced: LICENCE_ENFORCED,
    deviceLimit: l?.activationLimit ?? LICENCE_RULES.deviceLimit,
    ...(l
      ? {
          devicesUsed: l.activationUsage,
          keyHint: keyHint(l.key),
          customerName: l.customerName,
          customerEmail: l.customerEmail,
          lastValidatedAt: l.lastValidatedAt
        }
      : {}),
    locked: lockedReason(state),
    visible: visible || LICENCE_ENFORCED
  }
}

/** Whether `what` is allowed in `state`. Always yes until licensing is enforced. */
export function allows(state: LicenceState, what: Licensed, enforced = LICENCE_ENFORCED): boolean {
  void what // every licensed feature is locked by the same states
  if (!enforced) return true
  return state.kind === 'trial' || state.kind === 'licensed'
}

/** Why exporting is refused in `state`, or null when it isn't. */
export function lockedReason(state: LicenceState, enforced = LICENCE_ENFORCED): string | null {
  if (allows(state, 'export', enforced)) return null
  switch (state.kind) {
    case 'trial-ended':
      return 'Your free trial has ended. Buy a licence, or enter your key in Settings, to export again. Editing still works.'
    case 'revalidate':
      return 'Playroom needs to confirm your licence before it exports again. Connect to the internet, then choose Check now in Settings.'
    case 'inactive':
      return `This device is no longer activated (${state.reason}). Enter your key in Settings to export again.`
    default:
      return null
  }
}

/** Whether a launch should confirm the licence with the server. */
export function dueForValidation(file: LicenceFile, now: Date): boolean {
  const l = file.licence
  if (!l || l.status !== 'active') return false
  return now.getTime() - Date.parse(l.lastValidatedAt) >= LICENCE_RULES.revalidateAfterDays * DAY
}

// ── Lemon Squeezy ────────────────────────────────────────────────────────────

export class LicenceError extends Error {
  /**
   * network: couldn't reach the server; rejected: the server said no;
   * wrong-product: a key for something else; locked: what was asked for needs
   * a licence (`allows`).
   */
  readonly code: 'network' | 'rejected' | 'wrong-product' | 'locked'
  constructor(message: string, code: LicenceError['code']) {
    super(message)
    this.name = 'LicenceError'
    this.code = code
  }
}

interface LsKey {
  status: string
  key: string
  activation_limit: number | null
  activation_usage: number
}
interface LsMeta {
  store_id: number
  product_id: number
  customer_name?: string
  customer_email?: string
}
export interface LsResponse {
  activated?: boolean
  valid?: boolean
  deactivated?: boolean
  error: string | null
  license_key?: LsKey | null
  instance?: { id: string; name: string } | null
  meta?: LsMeta | null
}

export type Fetch = (url: string, init: RequestInit) => Promise<Response>

export class LicenceServer {
  private readonly base: string
  private readonly fetchFn: Fetch
  constructor(base: string = LICENCE_API, fetchFn: Fetch = (u, i) => fetch(u, i)) {
    this.base = base
    this.fetchFn = fetchFn
  }

  private async post(path: string, params: Record<string, string>): Promise<LsResponse> {
    let res: Response
    try {
      res = await this.fetchFn(`${this.base}/${path}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams(params).toString(),
        signal: AbortSignal.timeout(15_000)
      })
    } catch {
      throw new LicenceError(
        "Couldn't reach the licence server. Check your connection and try again.",
        'network'
      )
    }
    // Refusals come back as 4xx with the same JSON shape; anything else is the server's problem.
    const body = (await res.json().catch(() => null)) as LsResponse | null
    if (!body) throw new LicenceError(`The licence server answered ${res.status}.`, 'network')
    return body
  }

  activate(key: string, instanceName: string): Promise<LsResponse> {
    return this.post('activate', { license_key: key, instance_name: instanceName })
  }
  validate(key: string, instanceId: string): Promise<LsResponse> {
    return this.post('validate', { license_key: key, instance_id: instanceId })
  }
  deactivate(key: string, instanceId: string): Promise<LsResponse> {
    return this.post('deactivate', { license_key: key, instance_id: instanceId })
  }
}

function ours(meta: LsMeta | null | undefined): boolean {
  if (!meta) return false
  if (LS_PRODUCT.storeId !== null && meta.store_id !== LS_PRODUCT.storeId) return false
  if (LS_PRODUCT.productId !== null && meta.product_id !== LS_PRODUCT.productId) return false
  return true
}

/** Plain words for Lemon Squeezy's refusals. */
function refusal(r: LsResponse): string {
  const e = r.error ?? 'The licence server refused the key.'
  if (/activation limit/i.test(e)) {
    const limit = r.license_key?.activation_limit ?? LICENCE_RULES.deviceLimit
    return `This licence is already active on ${limit} devices. Deactivate one first, in Settings on that device or from your account, then try again.`
  }
  if (/not found|invalid/i.test(e))
    return "That licence key wasn't recognised. Check it against your receipt email."
  return e
}

/** Activate `key` on this device. */
export async function activate(
  file: LicenceFile,
  key: string,
  instanceName: string,
  server: LicenceServer,
  now: Date
): Promise<LicenceFile> {
  const k = key.trim()
  if (!k) throw new LicenceError('Enter a licence key.', 'rejected')
  const r = await server.activate(k, instanceName)
  if (!r.activated || !r.instance) throw new LicenceError(refusal(r), 'rejected')
  if (!ours(r.meta)) {
    // Don't keep a slot on someone else's product.
    await server.deactivate(k, r.instance.id).catch(() => undefined)
    throw new LicenceError('That key is for a different product.', 'wrong-product')
  }
  const at = now.toISOString()
  return {
    ...file,
    licence: {
      key: k,
      instanceId: r.instance.id,
      instanceName,
      customerName: r.meta?.customer_name,
      customerEmail: r.meta?.customer_email,
      activatedAt: at,
      lastValidatedAt: at,
      activationUsage: r.license_key?.activation_usage,
      activationLimit: r.license_key?.activation_limit ?? undefined,
      status: 'active'
    }
  }
}

/**
 * Confirm this device's activation. Offline, nothing changes (the grace
 * period applies); a refusal marks the licence inactive, with the reason.
 */
export async function validate(
  file: LicenceFile,
  server: LicenceServer,
  now: Date
): Promise<LicenceFile> {
  const l = file.licence
  if (!l) return file
  let r: LsResponse
  try {
    r = await server.validate(l.key, l.instanceId)
  } catch (err) {
    if (err instanceof LicenceError && err.code === 'network') return file
    throw err
  }
  if (!r.valid || r.license_key?.status === 'disabled' || r.license_key?.status === 'expired') {
    return {
      ...file,
      licence: {
        ...l,
        status: 'inactive',
        reason: r.error ?? `This licence is ${r.license_key?.status ?? 'no longer valid'}.`
      }
    }
  }
  return {
    ...file,
    licence: {
      ...l,
      status: 'active',
      reason: undefined,
      lastValidatedAt: now.toISOString(),
      activationUsage: r.license_key?.activation_usage ?? l.activationUsage,
      activationLimit: r.license_key?.activation_limit ?? l.activationLimit
    }
  }
}

/** Free this device's slot. Needs the server: offline, it throws and keeps the licence. */
export async function deactivate(file: LicenceFile, server: LicenceServer): Promise<LicenceFile> {
  const l = file.licence
  if (!l) return file
  const r = await server.deactivate(l.key, l.instanceId)
  // Already gone on the server (deactivated from the account) is as good as done.
  if (!r.deactivated && !/not found|inactive/i.test(r.error ?? '')) {
    throw new LicenceError(
      r.error ?? "The licence server didn't deactivate this device.",
      'rejected'
    )
  }
  const rest = { ...file }
  delete rest.licence
  return rest
}
