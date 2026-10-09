/**
 * This device, as the PIXL account knows it: a hash of the OS's machine id
 * (IOPlatformUUID on macOS, MachineGuid on Windows, /etc/machine-id on
 * Linux), never the id itself, and a name for the account page. The hash
 * is keyed per product, so two PIXL apps on one machine can't be linked
 * by it; the Worker hashes it again with its own secret before storing.
 * The server uses it for one trial per device and the device limit.
 */
import { t } from '../../shared/i18n'
import { execFile } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** Lowercase hex HMAC-SHA256 of the machine id, keyed `pixl:<product>:device:v1` (the contract's). */
export function deviceHash(machineId: string, product: string): string {
  return createHmac('sha256', `pixl:${product}:device:v1`).update(machineId, 'utf8').digest('hex')
}

/** `"IOPlatformUUID" = "…"` out of `ioreg -rd1 -c IOPlatformExpertDevice`. */
export function parseIoreg(out: string): string | null {
  return /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(out)?.[1] ?? null
}

/** `MachineGuid    REG_SZ    …` out of `reg query`. */
export function parseRegQuery(out: string): string | null {
  return /MachineGuid\s+REG_SZ\s+(\S+)/i.exec(out)?.[1] ?? null
}

/**
 * The OS's machine id, read with absolute paths (a PATH of the user's own
 * can't stand in a different one). Throws when it can't be read.
 */
export async function machineId(platform: NodeJS.Platform = process.platform): Promise<string> {
  let id: string | null = null
  if (platform === 'darwin') {
    const { stdout } = await run('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'])
    id = parseIoreg(stdout)
  } else if (platform === 'win32') {
    const reg = `${process.env['SystemRoot'] ?? 'C:\\Windows'}\\System32\\reg.exe`
    const { stdout } = await run(reg, [
      'query',
      'HKLM\\SOFTWARE\\Microsoft\\Cryptography',
      '/v',
      'MachineGuid',
      '/reg:64'
    ])
    id = parseRegQuery(stdout)
  } else {
    for (const f of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
      id = (await readFile(f, 'utf8').catch(() => '')).trim() || null
      if (id) break
    }
  }
  if (!id) throw new Error(t("Couldn't identify this device"))
  return id
}

export type DeviceOs = 'macos' | 'windows' | 'linux'

export function deviceOs(platform: NodeJS.Platform = process.platform): DeviceOs {
  return platform === 'darwin' ? 'macos' : platform === 'win32' ? 'windows' : 'linux'
}

/** How this device appears on the account page and in the licence's device list. */
export function deviceName(platform: NodeJS.Platform = process.platform): string {
  const os = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }[platform as string]
  return `${hostname().replace(/\.local$/, '')} (${os ?? platform})`
}
