#!/usr/bin/env node
/**
 * The catalogs' list (shared/i18n): every string the source marks with
 * `t('…')`, `tp('…', '…', n)` or `tk('…')` under src/, written to
 * src/shared/i18n/locales/en.json (the English is the key; a count's two
 * forms under `<other>_one` / `<other>_other`, as i18next looks them up).
 *
 *   node scripts/i18n-extract.mjs           write en.json, report what each language lacks
 *   node scripts/i18n-extract.mjs --check   write nothing; exit 1 if en.json is stale or a language lacks a line
 *   node scripts/i18n-extract.mjs --prune   also drop lines the source no longer has from the other catalogs
 *   node scripts/i18n-extract.mjs --dynamic list t() calls whose text isn't written out (tk() it where it's made)
 */
import { readdirSync, readFileSync, writeFileSync } from 'fs'
import { join, relative } from 'path'
import { fileURLToPath } from 'url'
import ts from 'typescript'
import { compareCatalog, LOCALES } from './i18n-lib.mjs'

const ROOT = join(fileURLToPath(import.meta.url), '../..')
const SRC = join(ROOT, 'src')
const DIR = join(SRC, 'shared/i18n/locales')

function files(dir) {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name !== 'locales' && e.name !== 'native') out.push(...files(p))
    } else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith('.d.ts')) out.push(p)
  }
  return out
}

/** A literal's text, or null when it isn't written out. */
function literal(n) {
  if (!n) return null
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text
  return null
}

export function extract() {
  const keys = new Map()
  const plurals = new Map()
  const dynamic = []
  for (const file of files(SRC)) {
    const text = readFileSync(file, 'utf8')
    if (!/\b(t[pk]?|rich)\(/.test(text)) continue
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const visit = (n) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
        const name = n.expression.text
        const where = `${relative(ROOT, file)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`
        if (name === 't' || name === 'tk' || name === 'rich') {
          const k = literal(n.arguments[0])
          if (k !== null) keys.set(k, where)
          else if (name !== 'tk') dynamic.push(where)
        } else if (name === 'tp') {
          const one = literal(n.arguments[0])
          const other = literal(n.arguments[1])
          if (one !== null && other !== null) plurals.set(other, { one, where })
          else dynamic.push(where)
        }
      }
      ts.forEachChild(n, visit)
    }
    visit(sf)
  }
  const en = {}
  for (const k of [...keys.keys()].sort()) en[k] = k
  for (const [other, { one }] of [...plurals].sort(([a], [b]) => a.localeCompare(b))) {
    en[`${other}_one`] = one
    en[`${other}_other`] = other
  }
  return { en, dynamic }
}

const read = (code) => JSON.parse(readFileSync(join(DIR, `${code}.json`), 'utf8'))
const write = (code, obj) => {
  const sorted = Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)))
  writeFileSync(join(DIR, `${code}.json`), JSON.stringify(sorted, null, 2) + '\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = new Set(process.argv.slice(2))
  const { en, dynamic } = extract()
  if (args.has('--dynamic')) for (const d of dynamic) console.log(`dynamic t(): ${d}`)
  let bad = false
  if (args.has('--check')) {
    if (JSON.stringify(en) !== JSON.stringify(Object.fromEntries(Object.entries(read('en')).sort(([a], [b]) => a.localeCompare(b))))) {
      console.log('en.json is stale: run node scripts/i18n-extract.mjs')
      bad = true
    }
  } else write('en', en)
  console.log(`en: ${Object.keys(en).length} lines (${dynamic.length} t() calls with text made elsewhere)`)
  for (const code of LOCALES.filter((c) => c !== 'en')) {
    const cat = read(code)
    const r = compareCatalog(en, cat, code)
    if (args.has('--prune') && r.stale.length) {
      for (const k of r.stale) delete cat[k]
      write(code, cat)
    }
    console.log(`${code}: ${r.missing.length} missing, ${r.placeholders.length} with other placeholders, ${r.stale.length} stale`)
    if (r.missing.length || r.placeholders.length) bad = true
  }
  if (args.has('--check') && bad) process.exit(1)
}
