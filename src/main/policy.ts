/**
 * The release policy (shared/policy.ts) as this install last saw it: fetched
 * from updates.pixlfoundation.com at launch and every four hours, and kept
 * in userData/policy.json so an offline launch still knows the floor. A
 * fetch that fails keeps what was there. PLAYROOM_POLICY_URL reads another
 * file; with PLAYROOM_UPDATE_URL set, the policy beside that feed is read.
 */
import { app } from 'electron'
import log from 'electron-log/main'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { parsePolicy, type Policy } from '../shared/policy'

const POLICY_URL = 'https://updates.pixlfoundation.com/playroom/policy.json'
const EVERY_MS = 4 * 60 * 60 * 1000

function policyUrl(): string {
  const feed = process.env['PLAYROOM_UPDATE_URL']
  return (
    process.env['PLAYROOM_POLICY_URL'] ||
    (feed ? `${feed.replace(/\/+$/, '')}/policy.json` : POLICY_URL)
  )
}

function filePath(): string {
  return join(app.getPath('userData'), 'policy.json')
}

let current: Policy = {}
const listeners: ((p: Policy) => void)[] = []

export function policy(): Policy {
  return current
}

/** Told the policy now, and again whenever it changes. */
export function onPolicy(fn: (p: Policy) => void): void {
  listeners.push(fn)
  fn(current)
}

function take(next: Policy): void {
  if (JSON.stringify(next) === JSON.stringify(current)) return
  current = next
  for (const fn of listeners) fn(current)
}

async function fetchPolicy(): Promise<void> {
  const url = policyUrl()
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
    // None published yet: no floor, beta open.
    if (res.status === 404) return save({})
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    save(parsePolicy(await res.json()))
  } catch (err) {
    log.warn(`policy: couldn't read ${url}`, err)
  }
}

function save(p: Policy): void {
  writeFileSync(filePath(), JSON.stringify(p, null, 2) + '\n', 'utf8')
  take(p)
}

/** At ready: the kept policy at once, then a fresh one (not under automation). */
export function startPolicy(): void {
  try {
    current = parsePolicy(JSON.parse(readFileSync(filePath(), 'utf8')))
  } catch {
    current = {}
  }
  if (process.env['PLAYROOM_HIDDEN'] === '1') return
  void fetchPolicy()
  setInterval(() => void fetchPolicy(), EVERY_MS).unref()
}
