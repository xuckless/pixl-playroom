import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import i18next from 'i18next'
import {
  fill,
  languageOf,
  pickLanguage,
  resetTranslator,
  resolveLanguage,
  setTranslator,
  t,
  tp
} from '../src/shared/i18n/index.ts'
// @ts-expect-error: a plain .mjs module, no types
import { compareCatalog, LOCALES } from '../scripts/i18n-lib.mjs'
// @ts-expect-error: a plain .mjs module, no types
import { extract } from '../scripts/i18n-extract.mjs'

const catalog = (code: string): Record<string, string> =>
  JSON.parse(
    readFileSync(new URL(`../src/shared/i18n/locales/${code}.json`, import.meta.url), 'utf8')
  )

test("the system's language picks ours, else English", () => {
  assert.equal(pickLanguage(['fr-CA', 'en-US']), 'fr')
  assert.equal(pickLanguage(['nl-NL', 'de-AT']), 'de')
  assert.equal(pickLanguage(['zh-Hant-TW']), 'zh-Hans')
  assert.equal(pickLanguage(['zh-CN']), 'zh-Hans')
  assert.equal(pickLanguage(['ja']), 'ja')
  assert.equal(pickLanguage(['vi-VN']), 'vi')
  assert.equal(pickLanguage(['ko-KR', 'es-ES']), 'en')
  assert.equal(pickLanguage([]), 'en')
  assert.equal(languageOf('pt-BR'), null)
  assert.equal(resolveLanguage('system', ['de-DE']), 'de')
  assert.equal(resolveLanguage('ja', ['de-DE']), 'ja')
})

test('the English stands, values filled, until a translator is installed', () => {
  resetTranslator()
  assert.equal(t('Saved to {{name}}', { name: 'a.jpg' }), 'Saved to a.jpg')
  assert.equal(tp('{{count}} photo', '{{count}} photos', 1), '1 photo')
  assert.equal(tp('{{count}} photo', '{{count}} photos', 3), '3 photos')
  assert.equal(fill('{{a}} and {{b}}', { a: 1 }), '1 and {{b}}')
})

test('a count takes each language’s plural forms', async () => {
  const inst = i18next.createInstance()
  await inst.init({
    lng: 'fr',
    fallbackLng: 'en',
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false },
    resources: {
      en: {
        translation: {
          '{{count}} photos_one': '{{count}} photo',
          '{{count}} photos_other': '{{count}} photos'
        }
      },
      fr: {
        translation: {
          '{{count}} photos_one': '{{count}} photo',
          '{{count}} photos_many': '{{count}} photos',
          '{{count}} photos_other': '{{count}} photos'
        }
      },
      ja: { translation: { '{{count}} photos_other': '{{count}} 枚の写真' } }
    }
  })
  setTranslator((k, v) => inst.t(k, v as Record<string, unknown>) as string)
  try {
    assert.equal(tp('{{count}} photo', '{{count}} photos', 0), '0 photo')
    assert.equal(tp('{{count}} photo', '{{count}} photos', 2), '2 photos')
    await inst.changeLanguage('ja')
    assert.equal(tp('{{count}} photo', '{{count}} photos', 1), '1 枚の写真')
    // A line no catalog has: the English.
    assert.equal(t('Not in any catalog'), 'Not in any catalog')
  } finally {
    resetTranslator()
  }
})

test('en.json is what the source marks', () => {
  const { en } = extract()
  assert.deepEqual(catalog('en'), en, 'run node scripts/i18n-extract.mjs')
})

test('every language has every line, with the same placeholders', () => {
  const en = catalog('en')
  for (const code of (LOCALES as string[]).filter((c) => c !== 'en')) {
    const r = compareCatalog(en, catalog(code), code)
    assert.deepEqual(r.missing.slice(0, 10), [], `${code}: ${r.missing.length} missing`)
    assert.deepEqual(r.placeholders.slice(0, 10), [], `${code}: placeholders differ`)
  }
})
