import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { listMove, rovingNext, typeAhead } from '../src/renderer/src/lib/roving'
import { modifierKey, modifierName } from '../src/renderer/src/lib/keys'

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

test('one dropdown: no native select is left, the Select row is the glass one', () => {
  for (const f of tsx())
    assert.doesNotMatch(src(f), /<select\b|<option\b/, `${f} has a native select`)
  assert.match(src('components/ui.tsx'), /<GlassSelect\b/)
})

test('a segmented control or tabs: arrows wrap past the greyed, Home and End go to the ends', () => {
  const all = [true, true, true]
  assert.equal(rovingNext('ArrowRight', 0, all), 1)
  assert.equal(rovingNext('ArrowRight', 2, all), 0)
  assert.equal(rovingNext('ArrowLeft', 0, all), 2)
  assert.equal(rovingNext('ArrowDown', 1, all), 2)
  assert.equal(rovingNext('ArrowRight', 0, [true, false, true]), 2)
  assert.equal(rovingNext('Home', 2, [false, true, true]), 1)
  assert.equal(rovingNext('End', 0, [true, true, false]), 1)
  assert.equal(rovingNext('Enter', 0, all), -1)
  // A column takes Up and Down only (Left and Right are the app's).
  assert.equal(rovingNext('ArrowRight', 0, all, true), -1)
  assert.equal(rovingNext('ArrowUp', 0, all, true), 2)
  // Nothing chosen yet: the first (or the last, going back).
  assert.equal(rovingNext('ArrowRight', -1, all), 0)
  assert.equal(rovingNext('ArrowLeft', -1, all), 2)
})

test('the dropdown’s list: arrows and pages stop at the ends and skip what cannot be chosen', () => {
  const on = [true, false, true, true, true, true, true, true, true, true, true, true, false]
  assert.equal(listMove('ArrowDown', 0, on), 2)
  assert.equal(listMove('ArrowUp', 2, on), 0)
  assert.equal(listMove('ArrowUp', 0, on), 0)
  assert.equal(listMove('PageDown', 0, on), 10)
  assert.equal(listMove('PageDown', 8, on), 11)
  assert.equal(listMove('End', 0, on), 11)
  assert.equal(listMove('Home', 5, on), 0)
  assert.equal(listMove('ArrowDown', -1, on), 0)
  assert.equal(listMove('a', 0, on), -1)
})

test('type-ahead: letters jump to a choice, the same letter steps through them', () => {
  const labels = ['sRGB', 'Display P3', 'Rec. 2020', 'ProPhoto RGB', 'Écran']
  const on = labels.map(() => true)
  assert.equal(typeAhead(labels, on, 0, 'p'), 3)
  assert.equal(typeAhead(labels, on, 3, 'p'), 3)
  assert.equal(typeAhead(labels, on, 3, 'pp'), 3)
  assert.equal(typeAhead(labels, on, 0, 'dis'), 1)
  assert.equal(typeAhead(labels, on, 1, 'display p'), 1)
  // Accents and case aside.
  assert.equal(typeAhead(labels, on, 0, 'ecr'), 4)
  assert.equal(typeAhead(labels, on, 0, 'zzz'), 0)
  assert.equal(typeAhead(labels, [true, false, true, true, true], 0, 'd'), 0)
})

test('modifier names follow the platform', () => {
  assert.equal(modifierName('alt', true), 'Option')
  assert.equal(modifierName('alt', false), 'Alt')
  assert.equal(modifierName('mod', false), 'Ctrl')
  assert.equal(modifierKey('alt', true), '⌥')
  assert.equal(modifierKey('alt', false), 'Alt+')
})

test('no hint names a modifier in one platform’s words', () => {
  for (const f of tsx()) {
    const code = src(f)
    for (const m of code.matchAll(/\b(?:t|tk|rich)\(\s*(['"`])((?:(?!\1).)*)\1/g))
      assert.doesNotMatch(
        m[2],
        /\bAlt\b|\bCtrl\b|\bOption\b|⌥/,
        `${f}: "${m[2]}" names a modifier: use {{alt}} with modName()`
      )
  }
})

test('a modal keeps focus: aria-modal, Tab held inside, focus handed back', () => {
  const ui = src('components/ui.tsx')
  const modal = ui.slice(ui.indexOf('export function Modal('))
  assert.match(modal, /aria-modal="true"/)
  assert.match(modal, /aria-labelledby=\{titleId\}/)
  assert.match(modal, /e\.key !== 'Tab'/)
  assert.match(modal, /opener\.focus\(/)
  // A destructive confirm leaves Return on Cancel.
  const confirm = src('components/ConfirmHost.tsx')
  assert.match(confirm, /autoFocus=\{!!open\.danger\}/)
  assert.match(confirm, /autoFocus=\{!open\.danger\}/)
})

test('folding headers are buttons that say whether they are open', () => {
  const ui = src('components/ui.tsx')
  assert.equal((ui.match(/className="fold-btn"/g) ?? []).length, 2)
  assert.match(ui, /aria-expanded=\{open\}/)
  assert.match(ui, /aria-expanded=\{fold\.open\}/)
  assert.doesNotMatch(src('develop/AdjustStack.tsx'), /className="card-dot"/)
})

test('the folded rail is inert, its glyphs tabs', () => {
  const rail = src('shell/LeftRail.tsx')
  assert.match(rail, /inert=\{!open\}/)
  assert.doesNotMatch(rail, /aria-hidden=\{!open\}/)
  assert.match(rail, /role="tabpanel"/)
})
