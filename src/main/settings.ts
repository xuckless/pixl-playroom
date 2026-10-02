/**
 * The few preferences needed before the index is up: the update channel (the
 * updater starts at ready) and crash-report consent (the crash reporter
 * starts before ready), and the last release whose notes were shown
 * (whatsnew.ts). They live in userData/settings.json, read synchronously;
 * everything else is an index setting.
 */
import { readFileSync, writeFileSync } from 'fs'
import type { CrashConsent, UpdateChannel } from '../shared/ipc'
import { paths } from './paths'

export interface Settings {
  updateChannel: UpdateChannel
  crashReports: CrashConsent
  /** The version whose release notes were last shown (or that was installed fresh). */
  notesSeen?: string
}

const DEFAULTS: Settings = { updateChannel: 'latest', crashReports: 'unset' }

export function readSettings(): Settings {
  try {
    const raw = JSON.parse(readFileSync(paths.settings(), 'utf8')) as Partial<Settings>
    return {
      updateChannel: raw.updateChannel === 'beta' ? 'beta' : 'latest',
      crashReports:
        raw.crashReports === 'on' || raw.crashReports === 'off' ? raw.crashReports : 'unset',
      ...(typeof raw.notesSeen === 'string' && raw.notesSeen ? { notesSeen: raw.notesSeen } : {})
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function writeSettings(patch: Partial<Settings>): Settings {
  const next = { ...readSettings(), ...patch }
  writeFileSync(paths.settings(), JSON.stringify(next, null, 2) + '\n', 'utf8')
  return next
}
