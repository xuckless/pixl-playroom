import { CARDS } from '../../../shared/cards'
import { GlassSelect } from '../components/GlassSelect'
import { Icon, PathIcon } from '../components/icons'
import { useKeyHint } from '../lib/commands'
import { useDevelop } from '../state/develop'
import { useScope } from '../state/scope'
import { useUi } from '../state/ui'
import { jumpToCard, STRIP_ICONS, toggleDrawer, toggleMasks } from './tools'

/** One card shown open, the rest folded: the solo switch. */
const SOLO_ICON = 'M4 4h16M4 8h16v12H4zM4 20'

/**
 * Above the cards: the canvas tools Lightroom keeps in its strip (Crop,
 * Heal, Masks), then Jump to, which opens a card and scrolls to it, and the
 * solo switch, under which opening a card folds the others.
 */
export function ToolStrip(): React.JSX.Element {
  const drawer = useUi((s) => s.drawer)
  const masksUp = useUi((s) => s.masksWin.open)
  const focus = useUi((s) => s.focusCard)
  const solo = useUi((s) => s.cardSolo)
  const setSolo = useUi((s) => s.setCardSolo)
  const maskCount = useDevelop((s) => s.recipe?.layers.length ?? 0)
  const session = useDevelop((s) => s.session)
  const inMask = useScope().layer !== null
  const key = useKeyHint()
  const label = (name: string, id: string): string => {
    const k = key(id)
    return k ? `${name} (${k})` : name
  }
  const options = CARDS.filter((c) => !inMask || c.inMask).map((c) => ({
    value: c.id,
    label: c.title,
    hint: key(`card.${c.id}`)
  }))
  return (
    <div className="tool-strip">
      <div className="ts-tools" role="toolbar" aria-label="Tools">
        <button
          className={`ts-tool${drawer === 'crop' ? ' on' : ''}`}
          aria-pressed={drawer === 'crop'}
          disabled={!session}
          title={label('Crop & straighten', 'tool.crop')}
          onClick={() => toggleDrawer('crop')}
        >
          <PathIcon d={STRIP_ICONS.crop} />
          Crop
        </button>
        <button
          className={`ts-tool${drawer === 'heal' ? ' on' : ''}`}
          aria-pressed={drawer === 'heal'}
          disabled={!session}
          title={label('Heal, clone and remove spots', 'tool.heal')}
          onClick={() => toggleDrawer('heal')}
        >
          <PathIcon d={STRIP_ICONS.heal} />
          Heal
        </button>
        <button
          className={`ts-tool${masksUp ? ' on' : ''}`}
          aria-pressed={masksUp}
          disabled={!session}
          title={label('Masks', 'masks.toggle')}
          onClick={toggleMasks}
        >
          <Icon name="overlay" />
          Masks
          {maskCount > 0 && <span className="ts-count">{maskCount}</span>}
        </button>
      </div>
      <div className="ts-jump">
        <GlassSelect
          label="Jump to a panel"
          prefix="Jump to"
          value={drawer === 'adjust' ? focus : null}
          options={options}
          onChange={jumpToCard}
        />
        <button
          className={`icon ts-solo${solo ? ' on' : ''}`}
          aria-pressed={solo}
          aria-label="Solo mode"
          title={solo ? 'Solo: one panel open at a time' : 'Solo: open one panel at a time'}
          onClick={() => setSolo(!solo)}
        >
          <PathIcon d={SOLO_ICON} />
        </button>
      </div>
    </div>
  )
}
