/**
 * Settings → Key bindings: every shortcut, grouped and searchable, each
 * rebindable the way a game's controls are: click a key, press the new one.
 * A key another command already answers in the same place asks before taking
 * it over. Only changes from the defaults are kept (`useUi().keyBindings`).
 */
import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../components/icons'
import {
  COMMANDS,
  GROUPS,
  IS_MAC,
  layoutDefaults,
  layoutKey,
  useKeyHint,
  type KeyCommand
} from '../lib/commands'
import {
  chordLabel,
  chordOf,
  conflictOf,
  isModifierCode,
  resolveBindings,
  sameChord,
  type Chord
} from '../lib/keys'
import { useUi } from '../state/ui'

/** Which key is waiting for a press: one of a command's, or a new one (`index` = its count). */
interface Capture {
  id: string
  index: number
}

interface Pending {
  id: string
  index: number
  chord: Chord
  other: string
}

const label = (c: Chord): string => chordLabel(c, IS_MAC, layoutKey)
const byId = new Map(COMMANDS.map((c) => [c.id, c]))

function sameKeys(a: Chord[], b: Chord[]): boolean {
  return a.length === b.length && a.every((c, i) => sameChord(c, b[i]))
}

export function KeyBindingsSection(): React.JSX.Element {
  useKeyHint()
  const overrides = useUi((s) => s.keyBindings)
  const setKeyBinding = useUi((s) => s.setKeyBinding)
  const resetKeyBindings = useUi((s) => s.resetKeyBindings)
  const defaults = layoutDefaults()
  const bindings = useMemo(() => resolveBindings(defaults, overrides), [defaults, overrides])
  const [query, setQuery] = useState('')
  const [capture, setCapture] = useState<Capture | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)

  /** Set a command's keys, dropping the override when they are the defaults again. */
  const put = (id: string, keys: Chord[]): void =>
    setKeyBinding(id, sameKeys(keys, defaults[id] ?? []) ? null : keys)

  const assign = (id: string, index: number, chord: Chord | null): void => {
    const keys = [...(bindings[id] ?? [])]
    if (chord === null) keys.splice(index, 1)
    else keys[index] = chord
    // The same key twice on one command is once.
    put(
      id,
      keys.filter((c, i) => keys.findIndex((d) => sameChord(c, d)) === i)
    )
  }

  // While capturing, the next key press is the binding (and nothing else sees it).
  useEffect(() => {
    if (!capture) return
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (isModifierCode(e.code)) return
      const noMods = !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey
      if (e.key === 'Escape' && noMods) return setCapture(null)
      if ((e.key === 'Backspace' || e.key === 'Delete') && noMods) {
        assign(capture.id, capture.index, null)
        return setCapture(null)
      }
      const chord = chordOf(e)
      const trial = { ...bindings, [capture.id]: [] }
      const other = conflictOf(COMMANDS, trial, capture.id, chord)
      setCapture(null)
      if (other) setPending({ ...capture, chord, other })
      else assign(capture.id, capture.index, chord)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capture, bindings])

  const takeOver = (p: Pending): void => {
    put(
      p.other,
      (bindings[p.other] ?? []).filter((c) => !sameChord(c, p.chord))
    )
    assign(p.id, p.index, p.chord)
    setPending(null)
  }

  const q = query.trim().toLowerCase()
  const shown = (c: KeyCommand): boolean =>
    !q ||
    c.label.toLowerCase().includes(q) ||
    c.group.toLowerCase().includes(q) ||
    (bindings[c.id] ?? []).some((k) => label(k).toLowerCase().includes(q))

  return (
    <div className="keybinds">
      <div className="keybinds-bar">
        <label className="keybinds-search">
          <Icon name="search" />
          <input
            value={query}
            placeholder="Search commands or keys"
            aria-label="Search commands or keys"
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </label>
        <button
          disabled={Object.keys(overrides).length === 0}
          onClick={() => {
            resetKeyBindings()
            setPending(null)
          }}
        >
          Reset all
        </button>
      </div>
      <p className="muted small">
        Click a key to change it, then press the new one. Esc cancels; Backspace removes it.
      </p>

      {pending && (
        <div className="keybinds-conflict" role="alert">
          <span>
            <span className="kbd">{label(pending.chord)}</span> already does “
            {byId.get(pending.other)?.label}”.
          </span>
          <div className="prefs-row">
            <button className="primary" onClick={() => takeOver(pending)}>
              Use it for “{byId.get(pending.id)?.label}”
            </button>
            <button onClick={() => setPending(null)}>Cancel</button>
          </div>
        </div>
      )}

      {GROUPS.map((group) => {
        const rows = COMMANDS.filter((c) => c.group === group && shown(c))
        if (!rows.length) return null
        return (
          <section key={group} className="keybinds-group">
            <h3>{group}</h3>
            {rows.map((c) => {
              const keys = bindings[c.id] ?? []
              const changed = c.id in overrides
              return (
                <div key={c.id} className={`keybind${changed ? ' changed' : ''}`}>
                  <span className="keybind-label">{c.label}</span>
                  <span className="keybind-keys">
                    {keys.map((k, i) => {
                      const waiting = capture?.id === c.id && capture.index === i
                      return (
                        <button
                          key={i}
                          className={`kbd keybind-key${waiting ? ' waiting' : ''}`}
                          title="Click, then press a new key"
                          onClick={() => {
                            setPending(null)
                            setCapture(waiting ? null : { id: c.id, index: i })
                          }}
                        >
                          {waiting ? 'Press a key…' : label(k)}
                        </button>
                      )
                    })}
                    {capture?.id === c.id && capture.index === keys.length ? (
                      <button className="kbd keybind-key waiting" onClick={() => setCapture(null)}>
                        Press a key…
                      </button>
                    ) : (
                      <button
                        className="icon ghost keybind-add"
                        title="Add a key"
                        aria-label={`Add a key for ${c.label}`}
                        onClick={() => {
                          setPending(null)
                          setCapture({ id: c.id, index: keys.length })
                        }}
                      >
                        <Icon name="plus" />
                      </button>
                    )}
                    <button
                      className="icon ghost keybind-reset"
                      title="Back to the default"
                      aria-label={`Reset ${c.label}`}
                      disabled={!changed}
                      onClick={() => setKeyBinding(c.id, null)}
                    >
                      <Icon name="reset" />
                    </button>
                  </span>
                </div>
              )
            })}
          </section>
        )
      })}
    </div>
  )
}
