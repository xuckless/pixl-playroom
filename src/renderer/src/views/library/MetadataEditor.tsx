import { useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { LibraryItem } from '../../../../shared/ipc'
import {
  keywordLabel,
  keywordPaths,
  parseKeywordInput,
  suggestKeywords
} from '../../../../shared/keywords'
import { cameraName } from '../../../../shared/smart'
import { Icon } from '../../components/icons'
import {
  keywordPresence,
  sharedText,
  textPatch,
  type Shared,
  type TextField
} from '../../lib/metadata'
import { useLibrary } from '../../state/library'

const LABELS: Record<TextField, string> = {
  title: 'Title',
  caption: 'Caption',
  copyright: 'Copyright'
}

/**
 * One text field over the selection. It saves when it loses focus or on
 * Enter (Shift+Enter is a new line in the caption); Escape puts it back.
 * Photos that differ show "Mixed" and are left alone unless typed over.
 */
function TextMeta({
  field,
  shared,
  onSave
}: {
  field: TextField
  shared: Shared
  onSave: (typed: string) => void
}): React.JSX.Element {
  const [text, setText] = useState(shared.value)
  const cancelled = useRef(false)
  const multiline = field === 'caption'
  const common = {
    id: `meta-${field}`,
    value: text,
    placeholder: shared.mixed ? 'Mixed' : field === 'copyright' ? '© ' : '',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setText(e.target.value),
    onBlur: () => {
      if (cancelled.current) cancelled.current = false
      else onSave(text)
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      e.stopPropagation()
      if (e.key === 'Enter' && !(multiline && e.shiftKey)) {
        e.preventDefault()
        e.currentTarget.blur()
      }
      if (e.key === 'Escape') {
        cancelled.current = true
        setText(shared.value)
        e.currentTarget.blur()
      }
    }
  }
  return (
    <div className={`meta-field${shared.mixed ? ' mixed' : ''}`}>
      <label htmlFor={common.id}>{LABELS[field]}</label>
      {multiline ? <textarea rows={3} {...common} /> : <input {...common} />}
    </div>
  )
}

/**
 * Keywords as tokens. Type "Places > Canada" (or Places|Canada; commas for
 * several) and press Enter; × takes one off every selected photo. A token
 * only some of them have is dashed, and a click gives it to all.
 */
function KeywordTokens({
  items,
  onPatch
}: {
  items: LibraryItem[]
  onPatch: (patch: { addKeywords?: string[]; removeKeywords?: string[] }) => void
}): React.JSX.Element {
  const tree = useLibrary((s) => s.keywords)
  const all = useMemo(() => keywordPaths(tree), [tree])
  const present = keywordPresence(items)
  const [text, setText] = useState('')
  const [hi, setHi] = useState(-1)
  const offers = suggestKeywords(
    all,
    text,
    present.filter((p) => p.all).map((p) => p.path),
    6
  )
  const add = (paths: string[]): void => {
    setText('')
    setHi(-1)
    if (paths.length) onPatch({ addKeywords: paths })
  }
  return (
    <div className="meta-field">
      <label htmlFor="meta-keywords">Keywords</label>
      <div className="kw-tokens">
        {present.map((k) => (
          <span
            key={k.path}
            className={`kw-token${k.all ? '' : ' partial'}`}
            title={
              k.all
                ? k.path.split('|').join(' › ')
                : `${keywordLabel(k.path)} — only some of the selection; click to add it to all`
            }
            onClick={k.all ? undefined : () => onPatch({ addKeywords: [k.path] })}
          >
            {keywordLabel(k.path)}
            <button
              className="icon"
              aria-label={`Remove ${keywordLabel(k.path)}`}
              title="Remove"
              onClick={(e) => {
                e.stopPropagation()
                onPatch({ removeKeywords: [k.path] })
              }}
            >
              <Icon name="close" />
            </button>
          </span>
        ))}
        <span className="kw-input">
          <input
            id="meta-keywords"
            value={text}
            placeholder={present.length ? 'Add…' : 'Add a keyword…'}
            title="Levels with > (Places > Canada), several with commas; Enter adds"
            autoComplete="off"
            role="combobox"
            aria-expanded={offers.length > 0}
            aria-controls="kw-offers"
            onChange={(e) => {
              setText(e.target.value)
              setHi(-1)
            }}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'ArrowDown' && offers.length) {
                setHi((hi + 1) % offers.length)
                e.preventDefault()
              } else if (e.key === 'ArrowUp' && offers.length) {
                setHi(hi <= 0 ? offers.length - 1 : hi - 1)
                e.preventDefault()
              } else if (e.key === 'Enter') {
                e.preventDefault()
                add(hi >= 0 && offers[hi] ? [offers[hi]] : parseKeywordInput(text))
              } else if (e.key === 'Escape') {
                setText('')
                setHi(-1)
              } else if (e.key === 'Backspace' && text === '' && present.length) {
                // Backspace in an empty field takes off the last token everyone has.
                const last = [...present].reverse().find((p) => p.all)
                if (last) onPatch({ removeKeywords: [last.path] })
              }
            }}
          />
          {offers.length > 0 && (
            <div className="kw-offers" id="kw-offers" role="listbox">
              {offers.map((o, i) => (
                <div
                  key={o}
                  role="option"
                  aria-selected={i === hi}
                  className={`kw-offer${i === hi ? ' on' : ''}`}
                  // Before the input's blur, so the pick lands.
                  onMouseDown={(e) => {
                    e.preventDefault()
                    add([o])
                  }}
                >
                  {keywordLabel(o)}
                </div>
              ))}
            </div>
          )}
        </span>
      </div>
    </div>
  )
}

const fmtShutter = (t: number | null): string =>
  t === null ? '—' : t >= 1 ? `${t} s` : `1/${Math.round(1 / t)} s`

/** What the camera said, for one photo. */
function CameraFacts({ item }: { item: LibraryItem }): React.JSX.Element {
  const c = item.camera
  return (
    <dl className="kv">
      <dt>File</dt>
      <dd>{item.copyName ? `${item.name} · ${item.copyName}` : item.name}</dd>
      <dt>Folder</dt>
      <dd title={item.folder}>{item.folder.split(/[\\/]/).filter(Boolean).pop() ?? item.folder}</dd>
      <dt>Camera</dt>
      <dd>{cameraName(item) || '—'}</dd>
      <dt>Lens</dt>
      <dd>{c.lens ?? '—'}</dd>
      <dt>Exposure</dt>
      <dd>
        {fmtShutter(c.exposureTime)} · f/{c.fNumber ?? '—'} · ISO {c.iso ?? '—'} ·{' '}
        {c.focalLength ? `${c.focalLength} mm` : '—'}
      </dd>
      <dt>Taken</dt>
      <dd>{c.capturedAt ? new Date(c.capturedAt).toLocaleString() : '—'}</dd>
      <dt>Size</dt>
      <dd>
        {(item.size / 1e6).toFixed(1)} MB{item.offline ? ' · offline' : ''}
      </dd>
    </dl>
  )
}

/**
 * Title, caption, copyright and keywords of the given photos, written to
 * each photo's .xmp (a virtual copy shares its photo's). With several
 * photos only the fields that were changed are sent.
 */
export function MetadataEditor({
  keys,
  facts = true
}: {
  keys: string[]
  /** Also show the camera's facts (for one photo). */
  facts?: boolean
}): React.JSX.Element {
  // A set, not `keys.includes` per item: a big selection over a big folder was N·K.
  const want = useMemo(() => new Set(keys), [keys])
  const items = useLibrary(useShallow((s) => s.items.filter((i) => want.has(i.key))))
  const setMetadata = useLibrary((s) => s.setMetadata)
  if (items.length === 0)
    return <p className="rail-empty">Select a photo to see and edit its details.</p>
  const shown = items.map((i) => i.key)
  // A new selection (or new values from the file) starts each field afresh.
  const sig = (s: Shared): string => `${shown.join(',')}|${s.mixed}|${s.value}`
  return (
    <div className="meta-editor">
      {items.length > 1 && (
        <p className="meta-count micro">{items.length} photos · edits apply to all</p>
      )}
      {(['title', 'caption', 'copyright'] as const).map((f) => {
        const shared = sharedText(items, f)
        return (
          <TextMeta
            key={`${f}:${sig(shared)}`}
            field={f}
            shared={shared}
            onSave={(typed) => {
              const patch = textPatch(shared, typed, f)
              if (patch) void setMetadata(shown, patch)
            }}
          />
        )
      })}
      <KeywordTokens items={items} onPatch={(patch) => void setMetadata(shown, patch)} />
      {facts && items.length === 1 && <CameraFacts item={items[0]} />}
    </div>
  )
}
