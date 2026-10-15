import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  gridTakesFocus,
  listMove,
  ratingAsk,
  ratingFrom,
  rovingNext,
  typeAhead
} from '../src/renderer/src/lib/roving'
import { giveTitle, takeTitle, type Titled } from '../src/renderer/src/lib/titles'
import { ERROR_MS, INFO_MS, toastLife } from '../src/renderer/src/lib/toasts'
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

test('rating keys outrunning the store count on; a run that has shown, or was left, starts again', () => {
  // Three fast ArrowRights from none: the store still shows 0, then 1.
  let asked: number[] = []
  asked = ratingAsk(asked, 0, ratingFrom(asked, 0) + 1)
  asked = ratingAsk(asked, 0, ratingFrom(asked, 0) + 1)
  assert.equal(ratingFrom(asked, 1), 2)
  asked = ratingAsk(asked, 1, ratingFrom(asked, 1) + 1)
  assert.deepEqual(asked, [0, 1, 2, 3])
  // What shows is none of the run's (a rating key elsewhere): from what shows.
  assert.equal(ratingFrom(asked, 5), 5)
  assert.deepEqual(ratingAsk(asked, 5, 4), [5, 4])
  // The component ends a run once its last shows (and after a pause), so a
  // later change to one of its values counts from what shows.
  const ui = src('components/ui.tsx')
  assert.match(ui, /run\.current\.asked\[run\.current\.asked\.length - 1\] === value/)
  assert.match(ui, /RATING_RUN_MS/)
})

test('a library tile’s stars stay out of the Tab order and leave focus on the grid', () => {
  const ui = src('components/ui.tsx')
  assert.match(ui, /tabIndex=\{!compact && n === Math\.max\(1, value\) \? 0 : -1\}/)
  assert.match(ui, /onMouseDown=\{compact \? \(e\) => e\.preventDefault\(\) : undefined\}/)
  assert.match(src('views/Library.tsx'), /<Stars\s+compact/)
})

test('a toast times out unless it has an action or is held; a hold is the toast’s own', () => {
  assert.equal(toastLife(null, null), null)
  assert.equal(toastLife({ id: 1, tone: 'info' }, null), INFO_MS)
  assert.equal(toastLife({ id: 1, tone: 'error' }, null), ERROR_MS)
  assert.equal(toastLife({ id: 1, tone: 'info', action: {} }, null), null)
  assert.equal(toastLife({ id: 1, tone: 'info' }, 1), null)
  // Held, then gone without a leave (its action used): the next one still times out.
  assert.equal(toastLife({ id: 2, tone: 'info' }, 1), INFO_MS)
})

/** An element as the titles see it. */
function el(attrs: Record<string, string>, text = ''): Titled & { attrs: Record<string, string> } {
  const a = { ...attrs }
  return {
    attrs: a,
    tagName: 'BUTTON',
    textContent: text,
    dataset: {},
    getAttribute: (n) => a[n] ?? null,
    setAttribute: (n, v) => void (a[n] = v),
    removeAttribute: (n) => void delete a[n],
    hasAttribute: (n) => n in a
  }
}

test('a title set aside lends its name only while it is away, and a new title replaces it', () => {
  const icon = el({ title: 'Turn off' })
  assert.equal(takeTitle(icon), 'Turn off')
  assert.deepEqual(icon.attrs, { 'aria-label': 'Turn off' })
  // The state changed under the pointer: React sets a new title.
  icon.setAttribute('title', 'Turn on')
  assert.equal(takeTitle(icon), 'Turn on')
  assert.equal(icon.attrs['aria-label'], 'Turn on')
  giveTitle(icon)
  // Back as it was: named by its title again, no stale label left behind.
  assert.deepEqual(icon.attrs, { title: 'Turn on' })
  // An element with a name of its own keeps it, and gets its title back.
  const named = el({ title: 'Why', 'aria-label': 'Export' })
  takeTitle(named)
  giveTitle(named)
  assert.deepEqual(named.attrs, { title: 'Why', 'aria-label': 'Export' })
  const worded = el({ title: 'More' }, 'Export…')
  takeTitle(worded)
  assert.equal(worded.attrs['aria-label'], undefined)
})

test('the focused tile takes keyboard focus only from the grid, or from a tile that scrolled away', () => {
  assert.equal(gridTakesFocus(true, false, true), true)
  assert.equal(gridTakesFocus(true, true, false), true)
  // Focus went to the search field (from nowhere, so the grid never heard it leave).
  assert.equal(gridTakesFocus(true, false, false), false)
  assert.equal(gridTakesFocus(false, true, false), false)
})
