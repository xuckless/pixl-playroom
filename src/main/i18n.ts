/**
 * Main's text in the user's language (shared/i18n): the menus, the dialogs
 * it opens and the errors it sends. The setting lives in settings.json, read
 * at ready; "system" follows the OS's preferred languages.
 */
import { app, BrowserWindow } from 'electron'
import type { i18n } from 'i18next'
import { IPC } from '../shared/ipc'
import { resolveLanguage, type Language, type LanguageSetting } from '../shared/i18n'
import { startI18n } from '../shared/i18n/setup'
import { readSettings, writeSettings } from './settings'

export interface LanguageState {
  setting: LanguageSetting
  language: Language
}

let inst: i18n | null = null
let state: LanguageState | null = null
const listeners = new Set<() => void>()

function preferred(): string[] {
  const list = app.getPreferredSystemLanguages()
  return list.length ? list : [app.getLocale()]
}

/** Start in the saved language (call at ready, before the menus). */
export function startLanguage(): LanguageState {
  const setting = readSettings().language ?? 'system'
  state = { setting, language: resolveLanguage(setting, preferred()) }
  inst = startI18n(state.language)
  return state
}

export function languageState(): LanguageState {
  return state ?? startLanguage()
}

/** Settings → Language: saved, in force at once, the window and the menus told. */
export function setLanguage(setting: LanguageSetting): LanguageState {
  writeSettings({ language: setting })
  state = { setting, language: resolveLanguage(setting, preferred()) }
  if (!inst) inst = startI18n(state.language)
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
