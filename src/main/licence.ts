/**
 * This device's licence: userData/licence.json (the key encrypted with the
 * OS keychain through safeStorage where it can be), the trial's start, and a
 * quiet re-check with the licence server at launch. The rules are in
 * shared/licence.ts; nothing is enforced yet (LICENCE_ENFORCED), and with it
 * off `requireLicence` never refuses.
 */
import { app, BrowserWindow, safeStorage } from 'electron'
import log from 'electron-log/main'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { IPC } from '../shared/ipc'
import { deviceName } from './account/device'
import {
  activate,
  deactivate,
  dueForValidation,
  LICENCE_API,
  LicenceError,
  LicenceServer,
  licenceStatus,
  validate,
  type LicenceFile,
  type LicenceStatus,
  type Licensed
} from '../shared/licence'

/** What is written: the record without its key, and the key sealed or plain. */
interface Stored {
  trialStartedAt?: string
  licence?: Omit<NonNullable<LicenceFile['licence']>, 'key'> & {
    keySealed?: string
    keyPlain?: string
  }
}

const server = new LicenceServer(process.env['PLAYROOM_LICENCE_API'] || LICENCE_API)
/** The licence section shows in development, or when asked for, until licensing is enforced. */
const visible = !app.isPackaged || process.env['PLAYROOM_LICENCE_UI'] === '1'

function filePath(): string {
  return join(app.getPath('userData'), 'licence.json')
}

function load(): LicenceFile {
  let s: Stored
  try {
    s = JSON.parse(readFileSync(filePath(), 'utf8')) as Stored
  } catch {
    return {}
  }
  if (!s.licence) return { trialStartedAt: s.trialStartedAt }
  const { keySealed, keyPlain, ...rest } = s.licence
  let key = keyPlain ?? ''
  if (keySealed) {
    try {
      key = safeStorage.decryptString(Buffer.from(keySealed, 'base64'))
    } catch (err) {
      // A keychain that no longer opens it: the device needs activating again.
      log.warn('licence: the stored key could not be decrypted', err)
      return { trialStartedAt: s.trialStartedAt }
    }
  }
  return { trialStartedAt: s.trialStartedAt, licence: { ...rest, key } }
}

function save(file: LicenceFile): void {
  const s: Stored = { trialStartedAt: file.trialStartedAt }
  if (file.licence) {
    const { key, ...rest } = file.licence
    s.licence = safeStorage.isEncryptionAvailable()
      ? { ...rest, keySealed: safeStorage.encryptString(key).toString('base64') }
      : { ...rest, keyPlain: key }
  }
  writeFileSync(filePath(), JSON.stringify(s, null, 2) + '\n', 'utf8')
}

function broadcast(status: LicenceStatus): LicenceStatus {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.licence.changed, status)
  }
  return status
}

export function licence(): LicenceStatus {
  return licenceStatus(load(), new Date(), visible)
}

/** Throws (code `locked`) when this device's licence doesn't allow `what`. */
export function requireLicence(what: Licensed): void {
  const s = licence()
  if (s.locked) {
    log.info(`licence: ${what} refused (${s.state.kind})`)
    throw new LicenceError(s.locked, 'locked')
  }
}

export async function activateLicence(key: string): Promise<LicenceStatus> {
  const next = await activate(load(), key, deviceName(), server, new Date())
  save(next)
  log.info(`licence: activated on ${next.licence?.instanceName}`)
  return broadcast(licence())
}

export async function deactivateLicence(): Promise<LicenceStatus> {
  save(await deactivate(load(), server))
  log.info('licence: this device deactivated')
  return broadcast(licence())
}

export async function validateLicence(): Promise<LicenceStatus> {
  save(await validate(load(), server, new Date()))
  return broadcast(licence())
}

/** At ready: start the trial clock on a first launch, and re-check a licence that is due. */
export function startLicence(): void {
  const file = load()
  if (!file.licence && !file.trialStartedAt)
    save({ ...file, trialStartedAt: new Date().toISOString() })
  if (process.env['PLAYROOM_HIDDEN'] === '1') return
  if (dueForValidation(file, new Date())) {
    void validateLicence().catch((err) => log.warn('licence: re-check failed', err))
  }
}
