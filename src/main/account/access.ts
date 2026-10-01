/**
 * This device's access: the entitlement token and its key set as they were
 * last fetched, checked offline at every look (entitlement.ts), and fetched
 * again when due, after signing in, or when asked. A refusal for the device
 * limit is remembered until the next fetch. Free of Electron (the file,
 * the server and the device are passed in), so tests/licence.test.ts runs
 * it; main/licence.ts is the Electron side.
 */
import type { AccountDevice, DeviceInfo, EntitlementResponse } from '../../shared/account'
import { licenceStatus, type LicenceInput, type LicenceStatus } from '../../shared/licence'
import { AccountError } from './api'
import {
  checkEntitlement,
  checkKeyset,
  effectiveNow,
  type EntitlementCheck,
  type EntitlementKeys
} from './entitlement'
import { OAuthError } from './oauth'

/** What licence.json holds. */
export interface AccessFile {
  token?: string
  keyset?: string
  /** The key set's iat: an older one is never taken. */
  keysetIat?: number
  /** The latest moment this device has seen, in ms: the clock can't be turned back past it. */
  seenAt?: number
}

export interface AccessServer {
  entitlements(device: DeviceInfo): Promise<EntitlementResponse>
  startTrial(device: DeviceInfo): Promise<EntitlementResponse>
  freeDevice(id: string): Promise<void>
}

export interface AccessDeps {
  load(): AccessFile
  save(f: AccessFile): void
  server: AccessServer
  /** This device's hash and name (read once). */
  device(): Promise<DeviceInfo>
  /** The roots the key set must be signed by. */
  roots: EntitlementKeys
  product: string
  betaBuild: boolean
  signedIn(): boolean
  now(): number
  /** Told after anything that changes the status. */
  onChange(): void
}

export class Access {
  private readonly d: AccessDeps
  private device: DeviceInfo | null = null
  private deviceLimit: AccountDevice[] | null = null
  private fetching: Promise<void> | null = null

  constructor(deps: AccessDeps) {
    this.d = deps
  }

  /** Reads the device once; the status can't judge a token before it knows the device. */
  async ready(): Promise<DeviceInfo> {
    this.device ??= await this.d.device()
    return this.device
  }

  private keys(f: AccessFile): EntitlementKeys {
    if (!f.keyset) return {}
    const k = checkKeyset(f.keyset, this.d.roots)
    return k.ok ? k.keys : {}
  }

  private check(f: AccessFile): EntitlementCheck | null {
    if (!f.token || !this.device) return null
    return checkEntitlement(f.token, {
      keys: this.keys(f),
      product: this.d.product,
      device: this.device.deviceHash,
      nowMs: this.d.now(),
      seenAtMs: f.seenAt
    })
  }

  private input(): LicenceInput {
    const f = this.d.load()
    const c = this.check(f)
    return {
      signedIn: this.d.signedIn(),
      claims: c?.ok ? c.claims : null,
      expired: c?.ok === false && c.problem === 'expired',
      deviceLimit: this.deviceLimit,
      betaBuild: this.d.betaBuild,
      now: effectiveNow(this.d.now(), f.seenAt)
    }
  }

  status(visible: boolean, enforced?: boolean): LicenceStatus {
    return licenceStatus(this.input(), visible, enforced)
  }

  /** Whether the server should be asked now: signed in, and no good token or one due a refresh. */
  due(): boolean {
    if (!this.d.signedIn()) return false
    const c = this.check(this.d.load())
    return !c || !c.ok || c.refreshDue
  }

  /** Moves `seenAt` up to now (never back). */
  touch(): void {
    const f = this.d.load()
    const now = this.d.now()
    if ((f.seenAt ?? 0) < now) this.d.save({ ...f, seenAt: now })
  }

  /** Forgets the token: signed out, or the server no longer gives this device one. */
  forget(): void {
    const f = this.d.load()
    // The key set and seenAt stay: they are about the server and the clock, not the account.
    this.d.save({ keyset: f.keyset, keysetIat: f.keysetIat, seenAt: f.seenAt })
    this.deviceLimit = null
    this.d.onChange()
  }

  /** Takes a token and its key set, once both check out. */
  private accept(r: EntitlementResponse): void {
    const f = this.d.load()
    const now = this.d.now()
    const ks = checkKeyset(r.keyset, this.d.roots, f.keysetIat ?? 0)
    // A stale key set (older than one already seen) is ignored, not taken.
    const keyset = ks.ok ? r.keyset : f.keyset
    const keysetIat = ks.ok ? ks.iat : f.keysetIat
    if (!ks.ok && ks.problem !== 'stale')
      throw new AccountError(
        `The account server's keys couldn't be verified (${ks.problem}).`,
        'network'
      )
    const seenAt = Math.max(f.seenAt ?? 0, now)
    const next: AccessFile = { token: r.token, keyset, keysetIat, seenAt }
    const c = this.check(next)
    if (!c?.ok)
      throw new AccountError(
        `The account server's answer couldn't be verified (${c?.problem ?? 'no device'}).`,
        'network'
      )
    this.deviceLimit = null
    this.d.save(next)
  }

  /**
   * Asks the server for this device's token (single-flight). Signed out
   * forgets it; a device-limit refusal is remembered with the account's
   * devices; a refusal of the beta forgets it. Anything else (no network, a
   * rate limit) keeps the token there is and throws for whoever asked.
   */
  refresh(): Promise<void> {
    this.fetching ??= this.doRefresh().finally(() => (this.fetching = null))
    return this.fetching
  }

  private async doRefresh(): Promise<void> {
    if (!this.d.signedIn()) {
      this.forget()
      return
    }
    const device = await this.ready()
    try {
      this.accept(await this.d.server.entitlements(device))
    } catch (err) {
      this.refused(err)
      throw err
    } finally {
      this.d.onChange()
    }
  }

  private refused(err: unknown): void {
    if (err instanceof OAuthError && err.code === 'signed-out') this.forget()
    else if (err instanceof AccountError) {
      if (err.code === 'device_limit') {
        const f = this.d.load()
        this.d.save({ keyset: f.keyset, keysetIat: f.keysetIat, seenAt: f.seenAt })
        this.deviceLimit = err.devices ?? []
      } else if (err.code === 'no_beta' || err.code === 'beta_ended' || err.code === 'signed-out')
        this.forget()
    }
  }

  /** Starts the trial (or answers with the one running). Refusals (`trial_used_*`) go to the caller. */
  async startTrial(): Promise<void> {
    const device = await this.ready()
    try {
      this.accept(await this.d.server.startTrial(device))
    } catch (err) {
      this.refused(err)
      throw err
    } finally {
      this.d.onChange()
    }
  }

  /** Frees one of the account's devices (from the device-limit list), then asks again for this one. */
  async freeDevice(id: string): Promise<void> {
    await this.d.server.freeDevice(id)
    await this.refresh()
  }
}
