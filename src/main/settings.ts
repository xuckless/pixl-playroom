/**
 * The few preferences needed before the index is up: the update channel (the
 * updater starts at ready) and crash-report consent (the crash reporter
 * starts before ready), and the last release whose notes were shown
 * (whatsnew.ts), and the language (the menus are made at ready). They live in userData/settings.json, read synchronously;
 * everything else is an index setting.
 */
import { readFileSync, writeFileSync } from 'fs'
import type { CrashConsent, UpdateChannel } from '../shared/ipc'
import { isLanguageSetting, type LanguageSetting } from '../shared/i18n'
import { paths } from './paths'

export interface Settings {
  updateChannel: UpdateChannel
  crashReports: CrashConsent
  /** The version whose release notes were last shown (or that was installed fresh). */
  notesSeen?: string
  /** The language chosen in Settings; the system's (when it is one of ours) by default. */
  language?: LanguageSetting
}

const DEFAULTS: Settings = { updateChannel: 'latest', crashReports: 'unset' }

export function readSettings(): Settings {
  try {
    const raw = JSON.parse(readFileSync(paths.settings(), 'utf8')) as Partial<Settings>
    return {
      updateChannel: raw.updateChannel === 'beta' ? 'beta' : 'latest',
      crashReports:
        raw.crashReports === 'on' || raw.crashReports === 'off' ? raw.crashReports : 'unset',
      ...(typeof raw.notesSeen === 'string' && raw.notesSeen ? { notesSeen: raw.notesSeen } : {}),
      ...(isLanguageSetting(raw.language) ? { language: raw.language } : {})
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
