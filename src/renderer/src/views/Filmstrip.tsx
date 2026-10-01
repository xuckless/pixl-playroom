import { memo, useCallback, useRef, useState } from 'react'
import type { LibraryItem } from '../../../shared/ipc'
import { LiquidGlass } from '../components/glass/LiquidGlass'
import { Icon } from '../components/icons'
import { useThumbFirst } from '../lib/thumbs'
import { useDevelop } from '../state/develop'
import { selectionSet, useLibrary, useVisible } from '../state/library'
import { useUi } from '../state/ui'
import { AiChip } from '../fx/AiScan'

/**
 * The photos of the library under the loupe, in the library's order and
 * filters. A click opens a photo; Ctrl/Cmd-click and Shift-click change the
 * selection without opening. It is folded away until asked for.
 */
export const Filmstrip = memo(function Filmstrip(): React.JSX.Element {
  const items = useVisible()
  const focus = useLibrary((s) => s.focus)
  const selection = useLibrary((s) => s.selection)
  const select = useLibrary((s) => s.select)
  const chosen = selectionSet(selection)
  const open = useDevelop((s) => s.open)
  const pick = useCallback(
    (key: string, e: React.MouseEvent): void => {
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        select(key, e.shiftKey ? 'range' : 'toggle')
        return
      }
      select(key, 'only')
      void open(key)
    },
    [select, open]
  )
  const shown = useUi((s) => s.filmstrip)
  // Once opened, its pictures stay loaded.
  const [loaded, setLoaded] = useState(shown)
  if (shown && !loaded) setLoaded(true)
  return (
    <div className={`filmstrip-wrap${shown ? ' open' : ''}`} aria-hidden={!shown}>
      <div className="filmstrip">
        {items.map((it, i) => (
          <FilmTile
            key={it.key}
            item={it}
            index={i}
            focus={it.key === focus}
            selected={chosen.has(it.key)}
            // Folded away, it loads no pictures.
            load={loaded}
            onPick={pick}
          />
        ))}
      </div>
    </div>
  )
})

const FilmTile = memo(function FilmTile({
  item,
  index,
  focus,
  selected,
  load,
  onPick
}: {
  item: LibraryItem
  index: number
  focus: boolean
  selected: boolean
  load: boolean
  onPick: (key: string, e: React.MouseEvent) => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useThumbFirst(ref, item.key, load && !item.thumbUrl && !item.unreadable)
  return (
    <div
      ref={ref}
      className={`film${focus ? ' focus' : ''}${selected ? ' selected' : ''}`}
      style={{ animationDelay: `${Math.min(index, 14) * 25}ms` }}
      onClick={(e) => onPick(item.key, e)}
      title={item.name}
    >
      {load && item.thumbUrl ? (
        <img src={item.thumbUrl} loading="lazy" decoding="async" draggable={false} alt="" />
      ) : (
        <span>{item.unreadable ? '—' : item.ext.toUpperCase()}</span>
      )}
      {item.rating > 0 && <span className="film-rating">{'★'.repeat(item.rating)}</span>}
      <AiChip photoKey={item.key} />
    </div>
  )
})

/** The glass chip at the foot of the loupe: an up arrow brings the filmstrip, a down arrow puts it away. */
export function FilmToggle(): React.JSX.Element {
  const shown = useUi((s) => s.filmstrip)
  const setShown = useUi((s) => s.setFilmstrip)
  const count = useVisible().length
  return (
    <LiquidGlass
      as="button"
      className={`film-toggle${shown ? ' open' : ''}`}
      radius={2}
      bezel={8}
      aria-expanded={shown}
      title={shown ? 'Hide the filmstrip' : 'Show the filmstrip'}
      onClick={() => setShown(!shown)}
    >
      <Icon name="chevronUp" />
      <span>Filmstrip</span>
      <span className="t-num count">{count}</span>
    </LiquidGlass>
  )
}
