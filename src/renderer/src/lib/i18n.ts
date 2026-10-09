/**
 * The renderer's language (shared/i18n): started before the first frame, in
 * the language main says is in force; Settings → Language changes it, and
 * the app's screens are drawn again in it (App keys them by language).
 */
import type { i18n } from 'i18next'
import { create } from 'zustand'
import { pickLanguage, type Language, type LanguageSetting } from '../../../shared/i18n'
import { startI18n } from '../../../shared/i18n/setup'
import { api } from './api'

export { midSentence, t, tk, tp } from '../../../shared/i18n'
export { rich } from './rich'

interface LanguageState {
  setting: LanguageSetting
  language: Language
  pseudo?: boolean
}

export const useLanguage = create<LanguageState>(() => ({ setting: 'system', language: 'en' }))

let inst: i18n | null = null

function apply(s: LanguageState): void {
  if (!inst) inst = startI18n(s.language, s.pseudo)
  else if (inst.language !== s.language) void inst.changeLanguage(s.language)
  document.documentElement.lang = s.language
  useLanguage.setState(s)
}

/** Before the first frame: the language main has in force (the system's, if it can't say). */
export async function startLanguage(): Promise<void> {
  const s = await api.app.language().catch((): LanguageState => ({
    setting: 'system',
    language: pickLanguage(navigator.languages)
  }))
  apply(s)
  api.app.onLanguageChanged(apply)
}

/** Settings → Language. */
export async function chooseLanguage(setting: LanguageSetting): Promise<void> {
  apply(await api.app.setLanguage(setting))
}
