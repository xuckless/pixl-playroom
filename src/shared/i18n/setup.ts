/**
 * The i18next instance each process shows its text with (shared/i18n).
 * English is the key, and the fallback for a line a catalog doesn't have
 * yet: it is bundled. Every other catalog is a chunk of its own, loaded when
 * its language is first wanted (`withLanguage`), so a start-up parses one
 * language's text rather than six.
 */
import i18next, { type i18n } from 'i18next'
import { fill, setCurrentLanguage, setTranslator, type Language, type Values } from './index'
import { pseudoExpand } from './pseudo'
import en from './locales/en.json'

/** A language's lines: the English key, its translation. */
export type Catalog = Record<string, string>

/** The catalogs other than English, each its own chunk. */
const CATALOGS: Record<Exclude<Language, 'en'>, () => Promise<{ default: Catalog }>> = {
  fr: () => import('./locales/fr.json'),
  de: () => import('./locales/de.json'),
  'zh-Hans': () => import('./locales/zh-Hans.json'),
  ja: () => import('./locales/ja.json'),
  vi: () => import('./locales/vi.json')
}

const loading = new Map<Language, Promise<Catalog | null>>()

/** `language`'s catalog, loaded once; null for English (bundled) or when it won't load. */
export function loadCatalog(language: Language): Promise<Catalog | null> {
  if (language === 'en') return Promise.resolve(null)
  let p = loading.get(language)
  if (!p) {
    p = CATALOGS[language]().then(
      (m) => m.default,
      () => {
        // Tried again next time: the English stands in meanwhile.
        loading.delete(language)
        return null
      }
    )
    loading.set(language, p)
  }
  return p
}

/**
 * A started instance in `language`, installed as the process's `t`, with
 * that language's catalog when it is given (English otherwise, until
 * `withLanguage` brings it). With `pseudo` (a check,
 * PLAYROOM_PSEUDO_LOCALE=1), each string comes back ⟦bracketed⟧: text on
 * screen without brackets never went through `t()`; with `'expand'`, also
 * accented and 1.4 times as long (`pseudoExpand`).
 */
export function startI18n(
  language: Language,
  pseudo: boolean | 'expand' = false,
  catalog: Catalog | null = null
): i18n {
  const inst = i18next.createInstance()
  void inst.init({
    resources: {
      en: { translation: en },
      ...(catalog && language !== 'en' ? { [language]: { translation: catalog } } : {})
    },
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
  setCurrentLanguage(language)
  inst.on('languageChanged', (l) => setCurrentLanguage(l as Language))
  setTranslator((key, values?: Values) => {
    const found = inst.t(key, values as Record<string, unknown>) as string
    // Not in any catalog: the English, its context dropped.
    const out = found === key ? fill(key, values) : found
    if (!pseudo || out.startsWith('⟦')) return out
    return pseudo === 'expand' ? pseudoExpand(out) : `⟦${out}⟧`
  })
  return inst
}

/** `inst` in `language`, its catalog loaded first (once) where it has one. */
export async function withLanguage(inst: i18n, language: Language): Promise<void> {
  if (language !== 'en' && !inst.hasResourceBundle(language, 'translation')) {
    const catalog = await loadCatalog(language)
    if (catalog) inst.addResourceBundle(language, 'translation', catalog)
  }
  if (inst.language !== language) await inst.changeLanguage(language)
}
