import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
// @ts-expect-error: a plain .mjs module, no types
import { extract } from '../scripts/i18n-extract.mjs'
import { OP_LABEL } from '../src/shared/invariant'
import { CARDS } from '../src/shared/cards'

const SRC = join(import.meta.dirname, '..', 'src', 'renderer', 'src')
const src = (f: string): string => readFileSync(join(SRC, f), 'utf8')

function tsx(dir = SRC, rel = ''): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...tsx(join(dir, e.name), r))
    else if (e.name.endsWith('.tsx')) out.push(r)
  }
  return out
}

test('copy: curly apostrophes and quotes in every line the app says', () => {
  const { en } = extract() as { en: Record<string, string> }
  const straight = Object.keys(en).filter((k) => /[A-Za-z]'[A-Za-z]|s'\s|"/.test(k))
  assert.deepEqual(straight, [], 'use ’ and “ ” (the copy style)')
})

test('an engine problem names the card as the column does, in house spelling', () => {
  const titles = new Set(CARDS.map((c) => c.title))
  for (const [op, label] of Object.entries(OP_LABEL)) {
    assert.doesNotMatch(label!, /\bColor\b|\bcolor\b|Tone curve|Color mixer/, `${op}: ${label}`)
  }
  assert.ok(titles.has(OP_LABEL.HslBands!), 'HslBands is the HSL card')
  assert.ok(titles.has(OP_LABEL.Curves!), 'Curves is the Curves card')
  assert.ok(titles.has(OP_LABEL.ColorGrade!), 'ColorGrade is the Colour grading card')
})

test('icons are the app’s own: no text glyphs for the eyedropper, the key or a menu’s check', () => {
  for (const f of tsx()) assert.doesNotMatch(src(f), /[⌖◐]/, `${f} draws a glyph for an icon`)
  assert.doesNotMatch(src('components/Popover.tsx'), /'●'/)
  assert.match(src('components/Popover.tsx'), /menuitemcheckbox/)
})

test('a button that opens a dialog says so with an ellipsis', () => {
  assert.match(src('shell/DevelopToolbar.tsx'), /\{t\('Export…'\)\}/)
  assert.match(src('views/Library.tsx'), /\{t\('Export…'\)\}/)
})

test('every icon-only button has a name of its own, not only a title', () => {
  const missing: string[] = []
  for (const f of tsx()) {
    const sf = ts.createSourceFile(f, src(f), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const visit = (node: ts.Node): void => {
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        const open = ts.isJsxElement(node) ? node.openingElement : node
        if (open.tagName.getText() === 'button') {
          const attrs = open.attributes.properties.filter(ts.isJsxAttribute)
          const get = (n: string): ts.JsxAttribute | undefined =>
            attrs.find((a) => a.name.getText() === n)
          const icon = /\bicon\b/.test(get('className')?.initializer?.getText() ?? '')
          const text =
            ts.isJsxElement(node) &&
            node.children.some(
              (c) =>
                (ts.isJsxText(c) && c.text.trim() !== '') ||
                (ts.isJsxExpression(c) && !!c.expression)
            )
          if (icon && !text && !get('aria-label') && !get('aria-labelledby'))
            missing.push(`${f}:${sf.getLineAndCharacterOfPosition(open.getStart()).line + 1}`)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  assert.deepEqual(missing, [])
})

test('one tooltip: titles, hints and the (i) open on keyboard focus and describe their control', () => {
  const tip = src('components/Tooltip.tsx')
  assert.match(tip, /role="tooltip"/)
  assert.match(tip, /'focusin'/)
  assert.match(tip, /aria-describedby/)
  const hint = src('components/HoverHint.tsx')
  assert.match(hint, /from '\.\/Tooltip'/)
  assert.match(hint, /onFocus=/)
  assert.match(hint, /aria-describedby/)
  assert.doesNotMatch(hint, /from '\.\/Popover'/)
  const info = src('components/InfoTip.tsx')
  assert.match(info, /TIP_MS/)
  assert.match(info, /onFocus=/)
  assert.match(src('App.tsx'), /<TooltipHost \/>/)
})

test('errors are announced, toasts kept, progress is a progressbar', () => {
  const toasts = src('components/Toasts.tsx')
  assert.match(toasts, /role="alert"/)
  assert.match(toasts, /role="status" aria-live="polite"/)
  assert.match(toasts, /aria-label=\{t\('Dismiss'\)\}/)
  assert.match(src('lib/commands.ts'), /id: 'view\.messages'/)
  assert.match(src('lib/menus.ts'), /cmd\('view\.messages'/)
  for (const f of tsx()) {
    const code = src(f)
    assert.doesNotMatch(
      code,
      /className="model-bar" aria-label/,
      `${f}: a progress bar without its role (use Progress)`
    )
    assert.doesNotMatch(
      code,
      /\{\w+(\.\w+)? && <(p|div) className="error[^"]*">/,
      `${f}: an error with no role="alert"`
    )
  }
  assert.match(src('components/ui.tsx'), /role="progressbar"/)
})
