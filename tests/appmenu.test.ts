import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SEPARATOR, tidyMenu } from '../src/shared/appmenu.ts'
import { chordAccelerator, parseChord } from '../src/renderer/src/lib/keys.ts'

test('a chord reads as the accelerator a menu shows', () => {
  const a = (spec: string): string | null => chordAccelerator(parseChord(spec))
  assert.equal(a('Mod+Shift+E'), 'CmdOrCtrl+Shift+E')
  assert.equal(a('P'), 'P')
  assert.equal(a('Mod+1'), 'CmdOrCtrl+1')
  assert.equal(a('Alt+M'), 'Alt+M')
  assert.equal(a('Mod+Equal'), 'CmdOrCtrl+=')
  assert.equal(a('Mod+Minus'), 'CmdOrCtrl+-')
  assert.equal(a('Backslash'), '\\')
  assert.equal(a('Mod+ArrowUp'), 'CmdOrCtrl+Up')
  assert.equal(a('Mod+Quote'), "CmdOrCtrl+'")
  assert.equal(a('BracketLeft'), '[')
  assert.equal(a('F5'), 'F5')
  // A key no menu can show.
  assert.equal(a('IntlRo'), null)
})

test("the accelerator takes the layout's own letter", () => {
  // German: the key a US layout calls Y types z.
  const de = (code: string): string | undefined => ({ KeyY: 'z', KeyZ: 'y' })[code]
  assert.equal(chordAccelerator(parseChord('Mod+Y'), de), 'CmdOrCtrl+Z')
  // Digits stay digits whatever the layout types (French types &).
  assert.equal(
    chordAccelerator(parseChord('Mod+1'), () => '&'),
    'CmdOrCtrl+1'
  )
})

test('a menu leaves no stray separators or empty submenus', () => {
  const out = tidyMenu([
    SEPARATOR,
    { id: 'a', label: 'A' },
    SEPARATOR,
    SEPARATOR,
    { label: 'Empty', submenu: [SEPARATOR] },
    { id: 'b', label: 'B' },
    SEPARATOR
  ])
  assert.deepEqual(
    out.map((n) => n.label ?? n.type),
    ['A', 'separator', 'B']
  )
  const nested = tidyMenu([{ label: 'Sub', submenu: [{ id: 'x', label: 'X' }, SEPARATOR] }])
  assert.deepEqual(
    nested[0].submenu?.map((n) => n.label),
    ['X']
  )
})
