import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
// @ts-expect-error: a plain .mjs script, no types
import { counts } from '../scripts/css-tokens.mjs'

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
