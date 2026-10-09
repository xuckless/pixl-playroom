/**
 * What a language's catalog lacks against en.json (scripts/i18n-extract.mjs,
 * tests/i18n.test.ts): its missing lines, the ones whose {{placeholders}}
 * differ from the English, and lines the English no longer has.
 */

export const LOCALES = ['en', 'fr', 'de', 'zh-Hans', 'ja', 'vi']

const SUFFIX = /_(zero|one|two|few|many|other)$/

const holes = (s) => [...String(s).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort().join(',')

/** The plural forms a language needs (i18next's suffixes, from CLDR via Intl). */
export function pluralForms(code) {
  return new Intl.PluralRules(code === 'zh-Hans' ? 'zh' : code).resolvedOptions().pluralCategories
}

export function compareCatalog(en, cat, code) {
  const missing = []
  const placeholders = []
  const wanted = new Set()
  const forms = pluralForms(code)
  for (const key of Object.keys(en)) {
    const m = SUFFIX.exec(key)
    if (m) {
      // A count: the forms this language has, each from the English plural.
      const base = key.slice(0, -m[0].length)
      if (m[1] !== 'other') continue
      for (const f of forms) {
        const k = `${base}_${f}`
        wanted.add(k)
        if (typeof cat[k] !== 'string' || !cat[k]) missing.push(k)
        // "1 photo" may drop the count's number ("une photo"); the others keep the English's.
        else if (f !== 'one' && holes(cat[k]) !== holes(en[key])) placeholders.push(k)
      }
      continue
    }
    wanted.add(key)
    if (typeof cat[key] !== 'string' || !cat[key]) missing.push(key)
    else if (holes(cat[key]) !== holes(en[key])) placeholders.push(key)
  }
  const stale = Object.keys(cat).filter((k) => !wanted.has(k))
  return { missing, placeholders, stale }
}
