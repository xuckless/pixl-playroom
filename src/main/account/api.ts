/**
 * pixlfoundation.com's account API, as agreed with pixl-web ("Contract with
 * the apps"): the entitlement token for this device, starting the trial,
 * freeing a device. Every call carries the account's access token; one the
 * Worker refuses (401) is refreshed once and the call tried again. Free of
 * Electron (fetch and the tokens are passed in), for tests/licence.test.ts.
 */
import { t, tk } from '../../shared/i18n'
import type {
  AccountApiError,
  AccountDevice,
  DeviceInfo,
  EntitlementResponse
} from '../../shared/account'
import type { Fetch } from './oauth'

export type AccountErrorCode = AccountApiError | 'network' | 'signed-out'

export class AccountError extends Error {
  readonly code: AccountErrorCode
  /** `device_limit`: the account's devices, to free one. */
  readonly devices?: AccountDevice[]
  /** `too_many`: seconds to wait, when the Worker says. */
  readonly retryAfter?: number
  constructor(
    message: string,
    code: AccountErrorCode,
    extra: { devices?: AccountDevice[]; retryAfter?: number } = {}
  ) {
    super(message)
    this.name = 'AccountError'
    this.code = code
    this.devices = extra.devices
    this.retryAfter = extra.retryAfter
  }
}

const MESSAGES: Record<AccountApiError, string> = {
  auth: tk('Sign in again to continue.'),
  device_limit: tk('Your licence is already in use on the most devices it allows.'),
  trial_used_account: tk('This account has already had its free trial.'),
  trial_used_device: tk('This device has already had a free trial, under another account.'),
  no_beta: tk('This account isn’t in the beta yet.'),
  beta_ended: tk('The beta has ended. Update to the released Pixl Playroom to keep going.'),
  wrong_client: tk('Sign-in isn’t set up for this build of Pixl Playroom.'),
  bad_request: tk('Pixl Playroom sent something the account server didn’t understand.'),
  too_many: tk('Too many tries. Wait a little, then try again.')
}

export interface AccountApiDeps {
  base: string
  product: string
  appVersion: string
  fetch: Fetch
  /** A current access token (refreshed if about to expire). */
  accessToken(): Promise<string>
  /** A new access token, the old one having been refused. */
  refreshAccess(): Promise<string>
}

export class AccountApi {
  private readonly d: AccountApiDeps
  constructor(deps: AccountApiDeps) {
    this.d = deps
  }

  entitlements(device: DeviceInfo): Promise<EntitlementResponse> {
    return this.call('POST', '/entitlements', this.body(device)) as Promise<EntitlementResponse>
  }

  /** Starts the trial, or answers with the token of one already running (it's idempotent). */
  startTrial(device: DeviceInfo): Promise<EntitlementResponse> {
    return this.call('POST', '/trials', this.body(device)) as Promise<EntitlementResponse>
  }

  async freeDevice(id: string): Promise<void> {
    await this.call('DELETE', `/devices/${encodeURIComponent(id)}`)
  }

  private body(device: DeviceInfo): object {
    return { product: this.d.product, ...device, appVersion: this.d.appVersion }
  }

  private async call(method: string, path: string, body?: object): Promise<unknown> {
    let token = await this.d.accessToken()
    let res = await this.send(method, path, token, body)
    if (res.status === 401) {
      token = await this.d.refreshAccess()
      res = await this.send(method, path, token, body)
    }
    let json: Record<string, unknown> = {}
    try {
      json = (await res.json()) as Record<string, unknown>
    } catch {
      // No body (a 204), or not JSON: judged by the status.
    }
    if (res.ok) {
      if (
        method !== 'DELETE' &&
        (typeof json.token !== 'string' || typeof json.keyset !== 'string')
      )
        throw new AccountError(t('The account server sent an answer without a token.'), 'network')
      return json
    }
    const code = typeof json.error === 'string' ? json.error : ''
    if (code in MESSAGES) {
      const c = code as AccountApiError
      const retry = Number(res.headers.get('Retry-After'))
      throw new AccountError(t(MESSAGES[c]), c, {
        devices: Array.isArray(json.devices) ? (json.devices as AccountDevice[]) : undefined,
        retryAfter: Number.isFinite(retry) && retry > 0 ? retry : undefined
      })
    }
    throw new AccountError(
      t('The account server answered HTTP {{status}}.', { status: res.status }),
      'network'
    )
  }

  private async send(
    method: string,
    path: string,
    token: string,
    body?: object
  ): Promise<Response> {
    try {
      return await this.d.fetch(`${this.d.base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20_000)
      })
    } catch (err) {
      throw new AccountError(
        t("Couldn't reach the PIXL account: {{reason}}", {
          reason: err instanceof Error ? err.message : String(err)
        }),
        'network'
      )
    }
  }
}
