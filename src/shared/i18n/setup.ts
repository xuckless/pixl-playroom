/**
 * The i18next instance each process shows its text with (shared/i18n), the
 * six catalogs bundled: English is the key, and the fallback for a line a
 * catalog doesn't have yet.
 */
import i18next, { type i18n } from 'i18next'
import { setTranslator, type Language, type Values } from './index'
import en from './locales/en.json'
import fr from './locales/fr.json'
import de from './locales/de.json'
import zhHans from './locales/zh-Hans.json'
import ja from './locales/ja.json'
import vi from './locales/vi.json'

const resources = {
  en: { translation: en },
  fr: { translation: fr },
  de: { translation: de },
  'zh-Hans': { translation: zhHans },
  ja: { translation: ja },
  vi: { translation: vi }
}

/** A started instance in `language`, installed as the process's `t`. */
export function startI18n(language: Language): i18n {
  const inst = i18next.createInstance()
  void inst.init({
    resources,
    lng: language,
    fallbackLng: 'en',
    // The English is the key: its dots, colons and ellipses are text.
    keySeparator: false,
    nsSeparator: false,
    returnEmptyString: false,
    // React (and the menus) escape; the text is never HTML.
    interpolation: { escapeValue: false },
    initAsync: false
  })
  setTranslator((key, values?: Values) => inst.t(key, values as Record<string, unknown>) as string)
  return inst
}
