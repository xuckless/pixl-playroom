import { memo } from 'react'
import { LiquidGlass } from '../components/glass/LiquidGlass'
import { Icon } from '../components/icons'
import { useDevelop } from '../state/develop'
import { useLibrary, useVisible } from '../state/library'
import { useUi } from '../state/ui'

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
  const open = useDevelop((s) => s.open)
  const shown = useUi((s) => s.filmstrip)
  return (
    <div className={`filmstrip-wrap${shown ? ' open' : ''}`} aria-hidden={!shown}>
      <div className="filmstrip">
        {items.map((it, i) => (
          <div
            key={it.key}
            className={`film${it.key === focus ? ' focus' : ''}${selection.includes(it.key) ? ' selected' : ''}`}
            style={{ animationDelay: `${Math.min(i, 14) * 25}ms` }}
            onClick={(e) => {
              if (e.ctrlKey || e.metaKey || e.shiftKey) {
                select(it.key, e.shiftKey ? 'range' : 'toggle')
                return
              }
              select(it.key, 'only')
              void open(it.key)
            }}
            title={it.name}
          >
            {it.thumbUrl ? (
              <img src={it.thumbUrl} draggable={false} alt="" />
            ) : (
              <span>{it.ext.toUpperCase()}</span>
            )}
            {it.rating > 0 && <span className="film-rating">{'★'.repeat(it.rating)}</span>}
          </div>
        ))}
      </div>
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
