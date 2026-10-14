import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const STYLES = join(import.meta.dirname, '..', 'src', 'renderer', 'src', 'styles')

/** A #rrggbb colour's hue, in degrees. */
function hue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  if (d === 0) return 0
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return (h * 60 + 360) % 360
}

/** The accent a stylesheet sets, if it sets one. */
const accentOf = (css: string): string | null =>
  css.match(/--acc:\s*(#[0-9a-fA-F]{6})/)?.[1] ?? null

test('the accent is purple in every theme (the owner, 2026-10-14)', () => {
  const original = accentOf(readFileSync(join(STYLES, 'tokens.css'), 'utf8'))
  assert.ok(original)
  for (const file of ['tokens.css', 'themes/calm.css', 'themes/bold.css']) {
    const css = readFileSync(join(STYLES, file), 'utf8')
    const acc = accentOf(css) ?? original
    const h = hue(acc)
    assert.ok(h >= 240 && h <= 290, `${file}: --acc ${acc} is hue ${Math.round(h)}°, not purple`)
  }
})

test('each theme is a :root[data-theme] block, loaded after every other layer', () => {
  const index = readFileSync(join(STYLES, 'index.css'), 'utf8')
  assert.match(index, /@layer [^;]*motion, themes;/)
  for (const t of ['calm', 'bold']) {
    assert.match(index, new RegExp(`themes/${t}\\.css' layer\\(themes\\)`))
    assert.match(
      readFileSync(join(STYLES, 'themes', `${t}.css`), 'utf8'),
      new RegExp(`:root\\[data-theme='${t}'\\]`)
    )
  }
})
