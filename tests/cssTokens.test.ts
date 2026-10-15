import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
// @ts-expect-error: a plain .mjs script, no types
import { counts, typeCounts } from '../scripts/css-tokens.mjs'

/**
 * Colours live on tokens (styles/tokens.css, styles/themes/) so a theme
 * changes them in one place: a stylesheet, or a component drawing in code,
 * may hold no more colour literals than it did
 * (tests/fixtures/css-literals.json, made by
 * `node scripts/css-tokens.mjs --json`). Lower the counts as literals move.
 */
test('no stylesheet or component gains a colour literal (a ratchet: use a token)', () => {
  const baseline = JSON.parse(
    readFileSync(join(import.meta.dirname, 'fixtures', 'css-literals.json'), 'utf8')
  ) as Record<string, number>
  const now = counts() as Record<string, number>
  for (const [file, n] of Object.entries(now))
    assert.ok(
      n <= (baseline[file] ?? 0),
      `${file} has ${n} colour literals, ${baseline[file] ?? 0} allowed: use a token from tokens.css`
    )
})

/**
 * Text takes the type scale's sizes (--fs-micro … --fs-large in tokens.css):
 * a stylesheet may write no more font sizes as numbers than it did
 * (tests/fixtures/css-type.json, made by `node scripts/css-tokens.mjs --type`).
 */
test('no stylesheet gains a font size off the type scale (a ratchet: use --fs-*)', () => {
  const baseline = JSON.parse(
    readFileSync(join(import.meta.dirname, 'fixtures', 'css-type.json'), 'utf8')
  ) as Record<string, number>
  const now = typeCounts() as Record<string, number>
  for (const [file, n] of Object.entries(now))
    assert.ok(
      n <= (baseline[file] ?? 0),
      `${file} writes ${n} font sizes as numbers, ${baseline[file] ?? 0} allowed: use a --fs-* token`
    )
  const tokens = readFileSync(
    join(import.meta.dirname, '..', 'src', 'renderer', 'src', 'styles', 'tokens.css'),
    'utf8'
  )
  for (const t of ['--fs-micro', '--fs-small', '--fs-body', '--fs-title', '--fs-large'])
    assert.match(tokens, new RegExp(`${t}: \\d+px;`))
})
