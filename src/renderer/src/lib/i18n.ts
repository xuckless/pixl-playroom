/**
 * The renderer's language (shared/i18n): started before the first frame, in
 * the language main says is in force; Settings → Language changes it, and
 * the app's screens are drawn again in it (App keys them by language).
 */
import type { i18n } from 'i18next'
import { create } from 'zustand'
import { pickLanguage, type Language, type LanguageSetting } from '../../../shared/i18n'
import { loadCatalog, startI18n, withLanguage } from '../../../shared/i18n/setup'
import { api } from './api'

export { midSentence, t, tk, tp } from '../../../shared/i18n'
export { rich } from './rich'

interface LanguageState {
  setting: LanguageSetting
  language: Language
  /** What "system" gives here (main reads the OS once for both). */
  system: Language
  pseudo?: boolean | 'expand'
}

export const useLanguage = create<LanguageState>(() => ({
  setting: 'system',
  language: 'en',
  system: 'en'
}))

let inst: i18n | null = null
/** The latest language asked for: a slower catalog arriving after it changes nothing. */
let wanted = 0

/** In `s`'s language, its catalog loaded first (the screens are drawn again once it is in). */
async function apply(s: LanguageState): Promise<void> {
  const mine = ++wanted
  if (!inst) inst = startI18n(s.language, s.pseudo, await loadCatalog(s.language))
  else await withLanguage(inst, s.language)
  if (mine !== wanted) return
  document.documentElement.lang = s.language
  useLanguage.setState(s)
}

/** Before the first frame: the language main has in force (the system's, if it can't say). */
export async function startLanguage(): Promise<void> {
  const s = await api.app.language().catch((): LanguageState => {
    const system = pickLanguage(navigator.languages)
    return { setting: 'system', language: system, system }
  })
  await apply(s)
  api.app.onLanguageChanged((next) => void apply(next))
}

/** Settings → Language. */
export async function chooseLanguage(setting: LanguageSetting): Promise<void> {
  await apply(await api.app.setLanguage(setting))
}
