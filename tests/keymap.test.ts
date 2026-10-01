import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  allConflicts,
  chordLabel,
  chordOf,
  conflictOf,
  isModifierCode,
  type KeyLike,
  onLayout,
  parseChord,
  resolveBindings,
  sameChord,
  type CommandKey
} from '../src/renderer/src/lib/keys'

const ev = (
  code: string,
  key: string,
  m: Partial<Record<'ctrl' | 'meta' | 'shift' | 'alt', boolean>> = {}
): KeyLike => ({
  code,
  key,
  ctrlKey: !!m.ctrl,
  metaKey: !!m.meta,
  shiftKey: !!m.shift,
  altKey: !!m.alt
})

test('shorthand names letters, digits and codes', () => {
  assert.deepEqual(parseChord('Mod+Shift+Z'), { code: 'KeyZ', mod: true, shift: true, alt: false })
  assert.deepEqual(parseChord('5'), { code: 'Digit5', mod: false, shift: false, alt: false })
  assert.deepEqual(parseChord('Alt+M'), { code: 'KeyM', mod: false, shift: false, alt: true })
  assert.equal(parseChord('Backslash').code, 'Backslash')
})

test('a press matches by the physical key, whatever it types', () => {
  // ⌥M types µ on a Mac; Shift+1 types !.
  assert.ok(sameChord(chordOf(ev('KeyM', 'µ', { alt: true })), parseChord('Alt+M')))
  assert.ok(sameChord(chordOf(ev('Digit1', '!', { shift: true })), parseChord('Shift+1')))
  // ⌘ and Ctrl are both the modifier.
  assert.ok(sameChord(chordOf(ev('KeyZ', 'z', { meta: true })), parseChord('Mod+Z')))
  assert.ok(sameChord(chordOf(ev('KeyZ', 'z', { ctrl: true })), parseChord('Mod+Z')))
  // The keypad's digits are the main row's.
  assert.ok(sameChord(chordOf(ev('Numpad3', '3')), parseChord('3')))
  // Modifiers must match exactly.
  assert.ok(!sameChord(chordOf(ev('KeyZ', 'Z', { meta: true, shift: true })), parseChord('Mod+Z')))
})

test('an event without a code falls back to its character', () => {
  assert.equal(chordOf(ev('', 'q')).code, 'KeyQ')
  assert.equal(chordOf(ev('', ' ')).code, 'Space')
})

test('modifier keys alone are not chords', () => {
  assert.ok(isModifierCode('ShiftLeft'))
  assert.ok(isModifierCode('MetaRight'))
  assert.ok(!isModifierCode('KeyA'))
})

test('overrides replace a command’s keys, and [] unbinds it', () => {
  const defaults = { undo: [parseChord('Mod+Z')], redo: [parseChord('Mod+Shift+Z')] }
  const out = resolveBindings(defaults, {
    undo: [parseChord('U')],
    redo: [],
    stale: [parseChord('X')]
  })
  assert.deepEqual(out.undo, [parseChord('U')])
  assert.deepEqual(out.redo, [])
  // A command that no longer exists is dropped.
  assert.equal('stale' in out, false)
})

test('conflicts only count where both commands listen', () => {
  const cmds: CommandKey[] = [
    { id: 'rate', context: 'global' },
    { id: 'before', context: 'develop' },
    { id: 'sidebar', context: 'library' },
    { id: 'healDelete', context: 'develop.heal' },
    { id: 'maskDelete', context: 'develop.masks' }
  ]
  const b = {
    rate: [parseChord('1')],
    before: [parseChord('Backslash')],
    sidebar: [parseChord('Backslash')],
    healDelete: [parseChord('Delete')],
    maskDelete: [parseChord('Delete')]
  }
  // Library and develop never listen at once; nor do two tools' own keys.
  assert.deepEqual(allConflicts(cmds, b), [])
  // A global key clashes everywhere.
  assert.equal(conflictOf(cmds, b, 'before', parseChord('1')), 'rate')
  assert.equal(conflictOf(cmds, b, 'rate', parseChord('Backslash')), 'before')
  assert.equal(conflictOf(cmds, b, 'before', parseChord('Y')), null)
})

test('labels follow the platform', () => {
  assert.equal(chordLabel(parseChord('Mod+Shift+Z'), true), '⇧⌘Z')
  assert.equal(chordLabel(parseChord('Mod+Shift+Z'), false), 'Ctrl+Shift+Z')
  assert.equal(chordLabel(parseChord('Alt+M'), true), '⌥M')
  assert.equal(chordLabel(parseChord('Backslash'), false), '\\')
  assert.equal(chordLabel(parseChord('Mod+Quote'), false), "Ctrl+'")
  // A layout that moves the key shows its own character.
  assert.equal(
    chordLabel(parseChord('Mod+Z'), true, (c) => (c === 'KeyZ' ? 'y' : undefined)),
    '⌘Y'
  )
})

test('letter defaults follow the layout; other keys stay put', () => {
  // German: the key a US layout calls Y types z, and the one it calls Z types y.
  const de = (c: string): string | undefined =>
    c === 'KeyY'
      ? 'z'
      : c === 'KeyZ'
        ? 'y'
        : c.startsWith('Key')
          ? c.slice(3).toLowerCase()
          : undefined
  const out = onLayout({ undo: [parseChord('Mod+Z')], before: [parseChord('Backslash')] }, de)
  assert.equal(out.undo[0].code, 'KeyY')
  assert.equal(out.before[0].code, 'Backslash')
  assert.equal(chordLabel(out.undo[0], true, de), '⌘Z')
})
