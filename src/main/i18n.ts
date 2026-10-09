/**
 * Main's text in the user's language (shared/i18n): the menus, the dialogs
 * it opens and the errors it sends. The setting lives in settings.json, read
 * at ready; "system" follows the OS's preferred languages.
 */
import { app, BrowserWindow } from 'electron'
import log from 'electron-log/main'
import type { i18n } from 'i18next'
import { IPC } from '../shared/ipc'
import { pickLanguage, type Language, type LanguageSetting } from '../shared/i18n'
import { startI18n } from '../shared/i18n/setup'
import { readSettings, writeSettings } from './settings'

export interface LanguageState {
  setting: LanguageSetting
  language: Language
  /** What "system" gives on this computer: Settings names it, so choosing it brings no surprise. */
  system: Language
  /** Checking: every translated string shown ⟦bracketed⟧, so what isn't stands out. */
  pseudo?: boolean
}

const PSEUDO = process.env.PLAYROOM_PSEUDO_LOCALE === '1'

let inst: i18n | null = null
let state: LanguageState | null = null
const listeners = new Set<() => void>()

/**
 * The OS's languages, most preferred first: its preferred list, then the
 * system's and the app's locale (the list can be empty, or miss the language
 * Windows shows, on some systems).
 */
function preferred(): string[] {
  const list = [
    ...app.getPreferredSystemLanguages(),
    app.getSystemLocale(),
    app.getLocale()
  ].filter(Boolean)
  return [...new Set(list)]
}

/** The setting, what it resolves to, and what "system" is here: one reading of the OS for all three. */
function stateFor(setting: LanguageSetting): LanguageState {
  const list = preferred()
  const system = pickLanguage(list)
  log.info(`language: ${setting} (system ${system}, from ${list.join(', ') || 'nothing'})`)
  return {
    setting,
    language: setting === 'system' ? system : setting,
    system,
    ...(PSEUDO ? { pseudo: true } : {})
  }
}

/** Start in the saved language (call at ready, before the menus). */
export function startLanguage(): LanguageState {
  state = stateFor(readSettings().language ?? 'system')
  inst = startI18n(state.language, PSEUDO)
  return state
}

export function languageState(): LanguageState {
  return state ?? startLanguage()
}

/** Settings → Language: saved, in force at once, the window and the menus told. */
export function setLanguage(setting: LanguageSetting): LanguageState {
  writeSettings({ language: setting })
  state = stateFor(setting)
  if (!inst) inst = startI18n(state.language, PSEUDO)
  else void inst.changeLanguage(state.language)
  for (const w of BrowserWindow.getAllWindows())
    if (!w.isDestroyed()) w.webContents.send(IPC.app.languageChanged, state)
  listeners.forEach((f) => f())
  return state
}

/** Run when the language changes (the menus are made again). */
export function onLanguage(f: () => void): void {
  listeners.add(f)
}
