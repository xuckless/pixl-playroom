/**
 * Playroom in six languages: English, French, German, Simplified Chinese,
 * Japanese and Vietnamese (i18next).
 *
 * The English text is the key: `t('Export…')` shows "Export…" in English and
 * the catalog's line for it in another language (locales/<code>.json; English
 * needs no catalog bar its plurals). So the source reads as it always has,
 * and an English change shows up as a missing translation (tests/i18n.test.ts).
 *
 * - `t(text, values)`: translated now, `{{name}}` filled from `values`.
 * - `tp(one, other, count, values)`: a count. French and German have a
 *   singular; Chinese, Japanese and Vietnamese don't (CLDR rules).
 * - `tk(text)`: marks text defined in one place and shown in another (a
 *   list of labels made once, at load): `t(label)` where it is shown.
 * - `t('Free|device')`: a context after a bar, for an English word with two
 *   meanings (see `withoutContext`).
 *
 * Whoever shows text (the renderer, main for its menus, dialogs and errors)
 * installs its i18next instance with `setTranslator`; until then the English
 * stands, values filled in. scripts/i18n-extract.mjs gathers every string so
 * marked into locales/en.json, the list the translations follow.
 */

export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'zh-Hans', name: '简体中文' },
  { code: 'ja', name: '日本語' },
  { code: 'vi', name: 'Tiếng Việt' }
] as const

export type Language = (typeof LANGUAGES)[number]['code']

/** What the user chose: the system's language (when it is one of ours), or one of them. */
export type LanguageSetting = 'system' | Language

export const LANGUAGE_SETTING_KEY = 'app.language'

export function isLanguage(v: unknown): v is Language {
  return LANGUAGES.some((l) => l.code === v)
}

export function isLanguageSetting(v: unknown): v is LanguageSetting {
  return v === 'system' || isLanguage(v)
}

/**
 * Ours for a BCP 47 tag, or null: any Chinese is Simplified (the one we
 * have; a Traditional reader gets it before English), any French, German,
 * Japanese or Vietnamese is that.
 */
export function languageOf(tag: string): Language | null {
  const base = tag.toLowerCase().split(/[-_]/)[0]
  if (base === 'zh') return 'zh-Hans'
  return isLanguage(base) ? base : null
}

/** The first of the system's preferred languages we have, else English. */
export function pickLanguage(preferred: readonly string[]): Language {
  for (const tag of preferred) {
    const l = languageOf(tag)
    if (l) return l
  }
  return 'en'
}

/** The language in force for a setting. */
export function resolveLanguage(setting: LanguageSetting, preferred: readonly string[]): Language {
  return setting === 'system' ? pickLanguage(preferred) : setting
}

/** Not English: the translation is ours, not a native speaker's yet. */
export function isBetaTranslation(l: Language): boolean {
  return l !== 'en'
}

export type Values = Record<string, string | number | undefined | null>

type Translator = (key: string, values?: Values) => string

/**
 * A word with two meanings in English gets a context after a bar, so each
 * meaning has its own translation: `t('Free|device')` (a device freed) is
 * not `t('Free')` (the free crop ratio). The English drops the bar.
 */
export function withoutContext(key: string): string {
  return key.replace(/\|[a-z][\w-]*$/, '')
}

/** `{{name}}` filled from `values` (the English, before a translator is installed). */
export function fill(text: string, values?: Values): string {
  text = withoutContext(text)
  if (!values) return text
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, name: string) =>
    values[name] === undefined || values[name] === null ? m : String(values[name])
  )
}

let impl: Translator = fill
let current: Language = 'en'

/** The language `t()` answers in (set with the translator). */
export function currentLanguage(): Language {
  return current
}

export function setCurrentLanguage(l: Language): void {
  current = l
}

/** The process's i18next, once it has one. */
export function setTranslator(fn: Translator): void {
  impl = fn
}

/** Translated now. */
export function t(text: string, values?: Values): string {
  return impl(text, values)
}

/**
 * A count: `tp('{{count}} photo', '{{count}} photos', n)`. The catalogs hold
 * it under the plural's key (`{{count}} photos_one`, `_other`), as i18next
 * looks it up.
 */
export function tp(one: string, other: string, count: number, values?: Values): string {
  const out = impl(other, { ...values, count })
  // No catalog line for it (English, or not translated yet): the English pair.
  return out === other || out === fill(other, { ...values, count })
    ? fill(count === 1 ? one : other, { ...values, count })
    : out
}

/**
 * A name (a label) translated for the middle of a sentence: "Finding the
 * sky". English, French and Vietnamese lower-case it; German keeps its
 * nouns' capitals; Chinese and Japanese have no case.
 */
export function midSentence(label: string): string {
  const text = t(label)
  return current === 'de' ? text : text.charAt(0).toLowerCase() + text.slice(1)
}

/** Marks text for the catalogs where it is defined; `t()` it where it is shown. */
export function tk<T extends string>(text: T): T {
  return text
}

/** For tests: back to the English. */
export function resetTranslator(): void {
  impl = fill
  current = 'en'
}
