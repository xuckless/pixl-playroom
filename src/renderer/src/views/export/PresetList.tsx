/**
 * The export sheet's presets: the previous export first, Playroom's own,
 * then the person's, by name. ↑ and ↓ move through them and apply each;
 * a preset whose settings were changed since reads "(edited)", with Update
 * (the person's own) and Save as new beneath it. Right-click renames,
 * duplicates or deletes. Enter exports.
 */
import { useEffect, useRef, useState } from 'react'
import { exportPresetMenu } from '../../lib/menus'
import { t, tk } from '../../lib/i18n'

export interface PresetRow {
  id: string
  /** As shown (translated). */
  name: string
  group: 'previous' | 'builtin' | 'yours'
  /** What it was made with, under the previous export's name. */
  note?: string
}

/** The name being typed: a new preset's, or a rename of one of the person's. */
export type Naming = { kind: 'new' } | { kind: 'rename'; id: string }

const GROUP_TITLES: Record<PresetRow['group'], string> = {
  previous: tk('Presets'),
  builtin: tk('Built in'),
  yours: tk('Yours')
}

export function PresetList({
  rows,
  selected,
  edited,
  naming,
  onSelect,
  onExport,
  onUpdate,
  onNaming,
  onName,
  onDuplicate,
  onDelete
}: {
  rows: PresetRow[]
  selected: string | null
  /** The selected preset's settings were changed since it was chosen. */
  edited: boolean
  naming: Naming | null
  onSelect: (id: string) => void
  onExport: () => void
  onUpdate: () => void
  onNaming: (n: Naming | null) => void
  onName: (name: string) => void
  onDuplicate: (id: string) => void
  onDelete: (id: string) => void
}): React.JSX.Element {
  const list = useRef<HTMLUListElement>(null)
  const at = rows.findIndex((r) => r.id === selected)
  const current = at >= 0 ? rows[at] : null
  // The sheet opens with the keyboard here, on the preset chosen.
  useEffect(() => list.current?.focus(), [])
  useEffect(() => {
    list.current
      ?.querySelector(`[data-preset="${CSS.escape(selected ?? '')}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [selected])
  const move = (by: number): void => {
    if (rows.length === 0) return
    const next = at < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, at + by))
    if (rows[next].id !== selected) onSelect(rows[next].id)
  }
  const onKey = (e: React.KeyboardEvent): void => {
    if (e.target !== list.current) return
    if (e.key === 'ArrowDown') move(1)
    else if (e.key === 'ArrowUp') move(-1)
    else if (e.key === 'Home') move(-rows.length)
    else if (e.key === 'End') move(rows.length)
    else if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) onExport()
    else return
    e.preventDefault()
  }
  const groups = (['previous', 'builtin', 'yours'] as const).filter((g) =>
    rows.some((r) => r.group === g)
  )
  return (
    <div className="es-presets">
      <ul
        ref={list}
        className="es-preset-list"
        role="listbox"
        tabIndex={0}
        aria-label={t('Presets')}
        aria-activedescendant={current ? `es-preset-${current.id}` : undefined}
        onKeyDown={onKey}
      >
        {groups.map((g) => (
          <li key={g} role="presentation">
            <span className="es-group micro">{t(GROUP_TITLES[g])}</span>
            <ul role="presentation">
              {rows
                .filter((r) => r.group === g)
                .map((r) => {
                  const on = r.id === selected
                  const renaming = naming?.kind === 'rename' && naming.id === r.id
                  return (
                    <li
                      key={r.id}
                      id={`es-preset-${r.id}`}
                      data-preset={r.id}
                      role="option"
                      aria-selected={on}
                      className={`es-preset${on ? ' on' : ''}`}
                      onClick={() => {
                        onSelect(r.id)
                        list.current?.focus()
                      }}
                      onContextMenu={(e) =>
                        exportPresetMenu(e, {
                          rename:
                            r.group === 'yours'
                              ? () => onNaming({ kind: 'rename', id: r.id })
                              : undefined,
                          duplicate: () => onDuplicate(r.id),
                          remove: r.group === 'yours' ? () => onDelete(r.id) : undefined
                        })
                      }
                    >
                      {renaming ? (
                        <NameField
                          initial={r.name}
                          onDone={(name) => (name ? onName(name) : onNaming(null))}
                        />
                      ) : (
                        <>
                          <span className="es-preset-name">
                            {on && edited ? t('{{name}} (edited)', { name: r.name }) : r.name}
                          </span>
                          {r.note && <span className="es-preset-note muted">{r.note}</span>}
                        </>
                      )}
                    </li>
                  )
                })}
            </ul>
          </li>
        ))}
      </ul>
      {naming?.kind === 'new' ? (
        <div className="es-preset-acts">
          <NameField initial="" onDone={(name) => (name ? onName(name) : onNaming(null))} />
        </div>
      ) : (
        edited && (
          <div className="es-preset-acts">
            {current?.group === 'yours' && (
              <button
                className="sm"
                title={t('Keep these settings in “{{name}}”', { name: current.name })}
                onClick={onUpdate}
              >
                {t('Update')}
              </button>
            )}
            <button className="sm" onClick={() => onNaming({ kind: 'new' })}>
              {t('Save as new…')}
            </button>
          </div>
        )
      )}
    </div>
  )
}

/** A preset's name, typed: Enter keeps it, Escape (or an empty name) lets it go. */
function NameField({
  initial,
  onDone
}: {
  initial: string
  onDone: (name: string | null) => void
}): React.JSX.Element {
  const [value, setValue] = useState(initial)
  const done = useRef(false)
  const finish = (name: string | null): void => {
    if (done.current) return
    done.current = true
    onDone(name?.trim() || null)
  }
  return (
    <input
      className="es-name"
      autoFocus
      value={value}
      placeholder={t('Preset name')}
      aria-label={t('Preset name')}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => finish(value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // The sheet's own keys (Escape closes it) wait for the name.
        e.stopPropagation()
        if (e.key === 'Enter') finish(value)
        else if (e.key === 'Escape') finish(null)
      }}
    />
  )
}
