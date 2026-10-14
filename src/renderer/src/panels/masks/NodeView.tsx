/**
 * DaVinci Resolve's node view of the photo's grade, in the masks pane
 * (Settings → Interface → Node view, with the Resolve colour tools): the
 * layers the engine runs, in order, as a serial chain of nodes. 01 is the
 * photo's own grade, then each qualifier, each mask, and the advanced
 * layers. A node's eye switches it off and on; a click puts its correction
 * in the cards (the photo's for 01, the qualifier's card, the mask's
 * settings); its grip moves it within its own group. Not a free graph:
 * the stack as it is, seen as nodes.
 */
import { Icon } from '../../components/icons'
import { t, tk } from '../../lib/i18n'
import { readable } from '../../lib/frames'
import { jumpToCard } from '../../develop/tools'
import { useDevelop } from '../../state/develop'
import { moveMask, patchMask } from './model'
import { useReorder } from './useReorder'
import { moveItem } from '../../../../shared/masks'
import type { Recipe } from '../../../../shared/recipe'

interface NodeProps {
  n: number
  name: string
  kind: string
  thumb?: string
  swatch?: string
  enabled: boolean
  selected: boolean
  onPick: () => void
  onToggle?: () => void
  offset?: number
  dragging?: boolean
  onGrip?: (e: React.PointerEvent<HTMLElement>) => void
}

function Node(p: NodeProps): React.JSX.Element {
  return (
    <div
      className={`node${p.selected ? ' on' : ''}${p.enabled ? '' : ' off'}${p.dragging ? ' dragging' : ''}`}
      data-reorder
      style={p.offset ? { transform: `translateY(${p.offset}px)` } : undefined}
    >
      <span className="node-link" aria-hidden />
      {p.onGrip && (
        <span className="node-grip" onPointerDown={p.onGrip} aria-hidden>
          ⋮⋮
        </span>
      )}
      <button className="node-body" onClick={p.onPick}>
        <span className="node-n">{String(p.n).padStart(2, '0')}</span>
        <span
          className="node-thumb"
          style={
            p.thumb
              ? { backgroundImage: `url(${p.thumb})` }
              : p.swatch
                ? { background: p.swatch }
                : undefined
          }
        />
        <span className="node-text">
          <span className="node-name">{p.name}</span>
          <span className="node-kind">{p.kind}</span>
        </span>
      </button>
      {p.onToggle && (
        <button
          className="icon sm ghost"
          aria-label={p.enabled ? t('Switch off') : t('Switch on')}
          title={p.enabled ? t('Switch off') : t('Switch on')}
          onClick={p.onToggle}
        >
          <Icon name={p.enabled ? 'eye' : 'eyeOff'} />
        </button>
      )}
    </div>
  )
}

const hueOf = (h: number, on: boolean, l: number): string =>
  `hsl(${Math.round(h)} ${on ? 70 : 0}% ${Math.round(25 + l * 50)}%)`

export function NodeView(): React.JSX.Element | null {
  const recipe = useDevelop((s) => s.recipe)
  const layerId = useDevelop((s) => s.layerId)
  const qualifierId = useDevelop((s) => s.qualifierId)
  const thumbs = useDevelop((s) => s.maskThumbs)
  const picture = useDevelop((s) => s.picture)
  const qualifiers = useReorder((from, to) => {
    const d = useDevelop.getState()
    if (d.recipe)
      void d.replace(
        { ...d.recipe, qualifiers: moveItem(d.recipe.qualifiers, from, to) },
        tk('Reorder qualifiers')
      )
  })
  const masks = useReorder((from, to) => {
    const l = useDevelop.getState().recipe?.layers[from]
    if (l) moveMask(l.id, to)
  })
  const custom = useReorder((from, to) => {
    const d = useDevelop.getState()
    if (d.recipe)
      void d.replace(
        { ...d.recipe, custom: moveItem(d.recipe.custom, from, to) },
        tk('Reorder advanced layers')
      )
  })
  if (!recipe) return null
  const d = useDevelop.getState()
  let n = 1
  const edit = (label: string, fn: (r: Recipe) => void): void => {
    d.edit(fn)
    d.commit(label)
  }
  return (
    <div className="node-view" aria-label={t('Nodes')}>
      <Node
        n={n++}
        name={t('Photo')}
        kind={t('Primaries, curves and the rest')}
        thumb={picture ? readable(picture) : undefined}
        enabled
        selected={layerId === null}
        onPick={() => {
          d.setLayer(null)
          jumpToCard('primaries')
        }}
      />
      {recipe.qualifiers.length > 0 && (
        <div className={`node-group${qualifiers.drag ? ' sorting' : ''}`}>
          {recipe.qualifiers.map((q, i) => (
            <Node
              key={q.id}
              n={n++}
              name={t('Qualifier {{n}}', { n: i + 1 })}
              kind={t('Qualifier')}
              swatch={hueOf(q.keyHue.centre, q.keyHue.on, q.keyLum.centre)}
              enabled={q.enabled}
              selected={layerId === null && q.id === qualifierId}
              onPick={() => {
                d.setLayer(null)
                d.setQualifier(q.id)
                jumpToCard('qualifier')
              }}
              onToggle={() =>
                edit(tk('Qualifier: on/off'), (r) => {
                  const x = r.qualifiers.find((y) => y.id === q.id)
                  if (x) x.enabled = !x.enabled
                })
              }
              offset={qualifiers.offset(i)}
              dragging={qualifiers.drag?.from === i}
              onGrip={(e) => qualifiers.start(e, i)}
            />
          ))}
        </div>
      )}
      {recipe.layers.length > 0 && (
        <div className={`node-group${masks.drag ? ' sorting' : ''}`}>
          {recipe.layers.map((l, i) => [
            <Node
              key={l.id}
              n={n++}
              name={l.name}
              kind={t('Mask')}
              thumb={thumbs[l.id]?.url}
              enabled={l.enabled}
              selected={l.id === layerId}
              onPick={() => d.setLayer(l.id)}
              onToggle={() =>
                patchMask(l.id, l.enabled ? tk('Hide mask') : tk('Show mask'), (x) => {
                  x.enabled = !x.enabled
                })
              }
              offset={masks.offset(i)}
              dragging={masks.drag?.from === i}
              onGrip={(e) => masks.start(e, i)}
            />,
            // The mask's own qualifiers run right after it, keyed inside it.
            ...(l.settings.qualifiers ?? []).map((q, j) => (
              <Node
                key={q.id}
                n={n++}
                name={t('Qualifier {{n}}', { n: j + 1 })}
                kind={t('Qualifier in {{mask}}', { mask: l.name })}
                swatch={hueOf(q.keyHue.centre, q.keyHue.on, q.keyLum.centre)}
                enabled={l.enabled && q.enabled}
                selected={l.id === layerId && q.id === qualifierId}
                onPick={() => {
                  d.setLayer(l.id)
                  d.setQualifier(q.id)
                  jumpToCard('qualifier')
                }}
                onToggle={() =>
                  patchMask(l.id, tk('Qualifier: on/off'), (x) => {
                    const y = x.settings.qualifiers.find((z) => z.id === q.id)
                    if (y) y.enabled = !y.enabled
                  })
                }
              />
            ))
          ])}
        </div>
      )}
      {recipe.custom.length > 0 && (
        <div className={`node-group${custom.drag ? ' sorting' : ''}`}>
          {recipe.custom.map((c, i) => (
            <Node
              key={c.id}
              n={n++}
              name={c.name}
              kind={t('Advanced layer')}
              enabled={c.enabled}
              selected={false}
              onPick={() => undefined}
              onToggle={() =>
                edit(tk('Advanced layer: on/off'), (r) => {
                  const x = r.custom.find((y) => y.id === c.id)
                  if (x) x.enabled = !x.enabled
                })
              }
              offset={custom.offset(i)}
              dragging={custom.drag?.from === i}
              onGrip={(e) => custom.start(e, i)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
