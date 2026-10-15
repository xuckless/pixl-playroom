import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const STYLES = join(import.meta.dirname, '..', 'src', 'renderer', 'src', 'styles')
const read = (f: string): string => readFileSync(join(STYLES, f), 'utf8')

/** The #rrggbb tokens a block sets (`--name: #rrggbb`). */
function hexTokens(css: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of css.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)) out[m[1]] = m[2]
  return out
}

/** A theme's first block, :root[data-theme='id'] { … }, over the base tokens. */
function themeTokens(id: string): Record<string, string> {
  const css = read(`themes/${id}.css`)
  const block = css.match(new RegExp(`:root\\[data-theme='${id}'\\] \\{([\\s\\S]*?)\\n\\}`))?.[1]
  assert.ok(block, `${id}.css has its :root block`)
  return { ...hexTokens(read('tokens.css')), ...hexTokens(block!) }
}

const channel = (c: number): number => {
  const v = c / 255
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}
const luminance = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16)))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
/** WCAG 2.2's contrast ratio between two colours. */
export const contrast = (a: string, b: string): number => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

const THEMES = ['calm', 'bold', 'studio', 'contrast']
const SURFACES = ['--s1', '--s2', '--s3', '--s4']

test('the contrast sum is WCAG’s', () => {
  assert.equal(contrast('#000000', '#ffffff'), 21)
  assert.equal(contrast('#777777', '#777777'), 1)
  assert.ok(Math.abs(contrast('#767676', '#ffffff') - 4.54) < 0.01)
})

test('every theme’s text, even the quietest, reads at 4.5:1 on every surface (WCAG 2.2 AA)', () => {
  for (const id of THEMES) {
    const tk = themeTokens(id)
    for (const ink of ['--text', '--text2', '--muted'])
      for (const s of SURFACES) {
        const r = contrast(tk[ink], tk[s])
        assert.ok(r >= 4.5, `${id}: ${ink} ${tk[ink]} on ${s} ${tk[s]} is ${r.toFixed(2)}:1`)
      }
  }
})

test('the accent (focus rings, what is chosen) stands at 3:1 on every surface (WCAG 1.4.11)', () => {
  for (const id of THEMES) {
    const tk = themeTokens(id)
    for (const s of SURFACES) {
      const r = contrast(tk['--acc'], tk[s])
      assert.ok(r >= 3, `${id}: --acc ${tk['--acc']} on ${s} is ${r.toFixed(2)}:1`)
    }
  }
})

test('a focused slider’s ring is the solid accent, and an unrated star is seen', () => {
  const css = read('primitives.css')
  const ring = css.match(/\.slider:focus-visible \{([^}]*)\}/)?.[1] ?? ''
  assert.match(ring, /inset 0 0 0 2px var\(--acc\)/)
  // An unrated star is white over the surface at this alpha: 0.4 is 3.7:1 on Signature's black.
  const star = css.match(/\.stars button \{[^}]*color: rgb\(var\(--fg-rgb\) \/ ([\d.]+)\)/)?.[1]
  assert.ok(star && Number(star) >= 0.4, `unrated stars at ${star} alpha`)
})
