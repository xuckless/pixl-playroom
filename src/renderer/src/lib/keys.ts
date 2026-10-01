/**
 * Key chords, as the rebindable shortcuts store and match them. Pure (no DOM,
 * no stores), so it runs under `node --test`.
 *
 * A chord names the physical key (`KeyboardEvent.code`), not the character it
 * types: ⌥M types "µ" on a Mac and Shift+1 types "!", but both stay the key
 * the user pressed, and a binding means the same key on every layout. The
 * label shows the layout's own character where the platform can tell us it.
 */

export interface Chord {
  code: string
  /** ⌘ on a Mac, Ctrl elsewhere (either counts, as the shortcuts always have). */
  mod: boolean
  shift: boolean
  alt: boolean
}

/**
 * Where a command listens. `global` works in both views; the develop
 * sub-contexts (`develop.heal` …) are commands that only act while that tool is
 * up, so they may share a key with a general develop command (the more specific
 * one is listed first and wins while its tool is showing).
 */
export type KeyContext =
  | 'global'
  | 'library'
  | 'develop'
  | 'develop.heal'
  | 'develop.masks'
  | 'develop.crop'
  | 'develop.curve'

export type Bindings = Record<string, Chord[]>

/** The keys the numeric keypad doubles, matched as the main row's. */
const ALIAS: Record<string, string> = {
  Numpad0: 'Digit0',
  Numpad1: 'Digit1',
  Numpad2: 'Digit2',
  Numpad3: 'Digit3',
  Numpad4: 'Digit4',
  Numpad5: 'Digit5',
  Numpad6: 'Digit6',
  Numpad7: 'Digit7',
  Numpad8: 'Digit8',
  Numpad9: 'Digit9',
  NumpadEnter: 'Enter'
}

export function normCode(code: string): string {
  return ALIAS[code] ?? code
}

/**
 * A chord from shorthand: `"Mod+Shift+Z"`, `"Alt+M"`, `"Escape"`,
 * `"Backslash"`. A single letter or digit is that key; anything longer is a
 * `KeyboardEvent.code` as written.
 */
export function parseChord(spec: string): Chord {
  const parts = spec.split('+')
  const key = parts.pop() ?? ''
  const has = (m: string): boolean => parts.includes(m)
  const code = /^[A-Z]$/.test(key) ? `Key${key}` : /^[0-9]$/.test(key) ? `Digit${key}` : key
  return { code, mod: has('Mod'), shift: has('Shift'), alt: has('Alt') }
}

/** The event's code from its character, for the rare event that carries none. */
function codeOfKey(key: string): string {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`
  if (/^[0-9]$/.test(key)) return `Digit${key}`
  if (key === ' ') return 'Space'
  return key
}

export interface KeyLike {
  code?: string
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}

export function chordOf(e: KeyLike): Chord {
  return {
    code: normCode(e.code || codeOfKey(e.key)),
    mod: e.ctrlKey || e.metaKey,
    shift: e.shiftKey,
    alt: e.altKey
  }
}

export function sameChord(a: Chord, b: Chord): boolean {
  return a.code === b.code && a.mod === b.mod && a.shift === b.shift && a.alt === b.alt
}

/** A pressed modifier on its own is never a chord (the capture waits for the key). */
export function isModifierCode(code: string): boolean {
  return (
    /^(Shift|Control|Alt|Meta|OS)(Left|Right)?$/.test(code) || code === 'CapsLock' || code === 'Fn'
  )
}

/** Two contexts can both be listening at once. */
export function overlaps(a: KeyContext, b: KeyContext): boolean {
  return a === b || a === 'global' || b === 'global'
}

/** The defaults with the user's overrides on top (an override of `[]` unbinds). */
export function resolveBindings(defaults: Bindings, overrides: Bindings | undefined): Bindings {
  const out: Bindings = {}
  for (const id of Object.keys(defaults)) out[id] = overrides?.[id] ?? defaults[id]
  return out
}

export interface CommandKey {
  id: string
  context: KeyContext
}

/** The other command that already answers `chord` where `id` would listen, if any. */
export function conflictOf(
  commands: CommandKey[],
  bindings: Bindings,
  id: string,
  chord: Chord
): string | null {
  const me = commands.find((c) => c.id === id)
  if (!me) return null
  for (const c of commands) {
    if (c.id === id || !overlaps(c.context, me.context)) continue
    if ((bindings[c.id] ?? []).some((b) => sameChord(b, chord))) return c.id
  }
  return null
}

/** Every pair of commands that answer the same chord in the same place. */
export function allConflicts(
  commands: CommandKey[],
  bindings: Bindings
): { a: string; b: string; chord: Chord }[] {
  const out: { a: string; b: string; chord: Chord }[] = []
  for (let i = 0; i < commands.length; i++)
    for (let j = i + 1; j < commands.length; j++) {
      const a = commands[i]
      const b = commands[j]
      if (!overlaps(a.context, b.context)) continue
      for (const ca of bindings[a.id] ?? [])
        if ((bindings[b.id] ?? []).some((cb) => sameChord(ca, cb)))
          out.push({ a: a.id, b: b.id, chord: ca })
    }
  return out
}

const NAMES: Record<string, [mac: string, other: string]> = {
  Backslash: ['\\', '\\'],
  BracketLeft: ['[', '['],
  BracketRight: [']', ']'],
  Quote: ["'", "'"],
  Equal: ['=', '='],
  Minus: ['−', '−'],
  Comma: [',', ','],
  Period: ['.', '.'],
  Slash: ['/', '/'],
  Semicolon: [';', ';'],
  Backquote: ['`', '`'],
  ArrowUp: ['↑', '↑'],
  ArrowDown: ['↓', '↓'],
  ArrowLeft: ['←', '←'],
  ArrowRight: ['→', '→'],
  Escape: ['Esc', 'Esc'],
  Enter: ['↩', 'Enter'],
  Space: ['Space', 'Space'],
  Tab: ['⇥', 'Tab'],
  Delete: ['⌦', 'Del'],
  Backspace: ['⌫', 'Backspace'],
  NumpadAdd: ['Num +', 'Num +'],
  NumpadSubtract: ['Num −', 'Num −'],
  Home: ['Home', 'Home'],
  End: ['End', 'End'],
  PageUp: ['PgUp', 'PgUp'],
  PageDown: ['PgDn', 'PgDn']
}

/** The key's face: the layout's own character when known, else its name. */
export function keyName(
  code: string,
  mac: boolean,
  layout?: (code: string) => string | undefined
): string {
  // Letters and punctuation move between layouts (Z is Y on German keys).
  const fromLayout = code.startsWith('Digit') ? undefined : layout?.(code)
  if (fromLayout && fromLayout.trim().length === 1) return fromLayout.toUpperCase()
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (/^F[0-9]{1,2}$/.test(code)) return code
  const n = NAMES[code]
  if (n) return mac ? n[0] : n[1]
  return code
}

/** How a chord reads: `⇧⌘Z` on a Mac, `Ctrl+Shift+Z` elsewhere. */
export function chordLabel(
  c: Chord,
  mac: boolean,
  layout?: (code: string) => string | undefined
): string {
  const key = keyName(c.code, mac, layout)
  if (mac) return `${c.alt ? '⌥' : ''}${c.shift ? '⇧' : ''}${c.mod ? '⌘' : ''}${key}`
  return [c.mod && 'Ctrl', c.shift && 'Shift', c.alt && 'Alt', key].filter(Boolean).join('+')
}

/**
 * The defaults moved onto the keyboard's own layout: a default of ⌘Z means the
 * key that types "z" (on a German layout that is the key a US one calls Y).
 * Only letters move; a binding the user pressed is already the right key.
 */
export function onLayout(
  defaults: Bindings,
  layout: (code: string) => string | undefined
): Bindings {
  const codeOf = new Map<string, string>()
  for (let i = 0; i < 26; i++) {
    const code = `Key${String.fromCharCode(65 + i)}`
    const ch = layout(code)?.toLowerCase()
    if (ch && /^[a-z]$/.test(ch) && !codeOf.has(ch)) codeOf.set(ch, code)
  }
  if (codeOf.size === 0) return defaults
  const out: Bindings = {}
  for (const [id, chords] of Object.entries(defaults))
    out[id] = chords.map((c) => {
      if (!/^Key[A-Z]$/.test(c.code)) return c
      const code = codeOf.get(c.code.slice(3).toLowerCase())
      return code ? { ...c, code } : c
    })
  return out
}
