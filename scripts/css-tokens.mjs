#!/usr/bin/env node
/**
 * Colour literals in the renderer's stylesheets, and their move onto tokens
 * (styles/tokens.css), so a theme (styles/themes/) changes them in one place.
 *
 *   node scripts/css-tokens.mjs           count the literals left, per file and per value
 *   node scripts/css-tokens.mjs --fix     move the three families onto tokens (no visual change)
 *   node scripts/css-tokens.mjs --json    the per-file counts, as tests/fixtures/css-literals.json holds them
 *
 * The renderer's components (.tsx) are counted too, under `tsx:<path>`: a
 * colour drawn from code (an SVG's fill, a chart's line) takes a token's
 * var() in `style` as a stylesheet does. Data colours stay (a hue strip, a
 * gamut's outline), held by the count; Mark.tsx, the wordmark's own art, is
 * not counted.
 *
 * The families, each written so it renders exactly as before while the
 * tokens hold today's values:
 *   rgba(157, 139, 234, a)  →  color-mix(in srgb, var(--acc) a·100%, transparent)
 *   rgba(255, 255, 255, a)  →  rgb(var(--fg-rgb) / a)
 *   rgba(0, 0, 0, a)        →  rgb(var(--shade-rgb) / a)
 * Pure white and black (#fff, #000) stay: what is drawn over a photo is
 * white or black in any theme. tokens.css and styles/themes/ are where the
 * values live, and are not counted.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const RENDERER = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer', 'src')
const STYLES = join(RENDERER, 'styles')
const EXEMPT = new Set(['tokens.css'])
const TSX_EXEMPT = new Set(['components/Mark.tsx'])

/** A literal colour: rgb()/rgba() with numbers, or a hex (not #fff/#000). */
const LITERAL = /rgba?\(\s*\d[^)]*\)|#(?![fF]{3}\b|[fF]{6}\b|0{3}\b|0{6}\b)[0-9a-fA-F]{3,8}\b/g

const FAMILY = /rgba\(\s*(157|255|0)\s*,\s*(139|255|0)\s*,\s*(234|255|0)\s*,\s*(0?\.\d+|1|0)\s*\)/g

function fix(css) {
  return css.replace(FAMILY, (all, r, g, b, a) => {
    const alpha = Number(a)
    if (r === '157' && g === '139' && b === '234')
      return `color-mix(in srgb, var(--acc) ${+(alpha * 100).toFixed(2)}%, transparent)`
    if (r === '255' && g === '255' && b === '255') return `rgb(var(--fg-rgb) / ${a})`
    if (r === '0' && g === '0' && b === '0') return `rgb(var(--shade-rgb) / ${a})`
    return all
  })
}

/** CSS without its comments: a colour named in a comment is not one. */
const code = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

/** TSX without its comments (block, and line ones that start a line or follow code). */
const tsxCode = (src) => code(src).replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

function tsxFiles(dir, rel = '') {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...tsxFiles(join(dir, e.name), r))
    else if (e.name.endsWith('.tsx') && !TSX_EXEMPT.has(r)) out.push(r)
  }
  return out.sort()
}

export function counts() {
  const out = {}
  for (const f of readdirSync(STYLES)
    .filter((f) => f.endsWith('.css'))
    .sort()) {
    if (EXEMPT.has(f)) continue
    out[f] = (code(readFileSync(join(STYLES, f), 'utf8')).match(LITERAL) ?? []).length
  }
  for (const f of tsxFiles(RENDERER)) {
    const n = (tsxCode(readFileSync(join(RENDERER, f), 'utf8')).match(LITERAL) ?? []).length
    if (n > 0) out[`tsx:${f}`] = n
  }
  return out
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2)
  if (args.includes('--fix')) {
    for (const f of readdirSync(STYLES).filter((f) => f.endsWith('.css'))) {
      if (EXEMPT.has(f)) continue
      const path = join(STYLES, f)
      const before = readFileSync(path, 'utf8')
      const after = fix(before)
      if (after !== before) writeFileSync(path, after)
    }
  }
  const c = counts()
  if (args.includes('--json')) console.log(JSON.stringify(c, null, 2))
  else {
    for (const [f, n] of Object.entries(c)) console.log(`${String(n).padStart(4)}  ${f}`)
    console.log(`${String(Object.values(c).reduce((a, b) => a + b, 0)).padStart(4)}  in all`)
  }
}
