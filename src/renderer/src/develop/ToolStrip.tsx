import { CARDS } from '../../../shared/cards'
import { GlassSelect } from '../components/GlassSelect'
import { Icon, PathIcon } from '../components/icons'
import { useKeyHint } from '../lib/commands'
import { t } from '../lib/i18n'
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
    label: t(c.title),
    hint: key(`card.${c.id}`)
  }))
  return (
    <div className="tool-strip">
      <div className="ts-tools" role="toolbar" aria-label={t('Tools')}>
        <button
          className={`ts-tool${drawer === 'crop' ? ' on' : ''}`}
          aria-pressed={drawer === 'crop'}
          disabled={!session}
          title={label(t('Crop & straighten'), 'tool.crop')}
          onClick={() => toggleDrawer('crop')}
        >
          <PathIcon d={STRIP_ICONS.crop} />
          {t('Crop')}
        </button>
        <button
          className={`ts-tool${drawer === 'heal' ? ' on' : ''}`}
          aria-pressed={drawer === 'heal'}
          disabled={!session}
          title={label(t('Heal, clone and remove spots'), 'tool.heal')}
          onClick={() => toggleDrawer('heal')}
        >
          <PathIcon d={STRIP_ICONS.heal} />
          {t('Heal')}
        </button>
        <button
          className={`ts-tool${masksUp ? ' on' : ''}`}
          aria-pressed={masksUp}
          disabled={!session}
          title={label(t('Masks'), 'masks.toggle')}
          onClick={toggleMasks}
        >
          <Icon name="overlay" />
          {t('Masks')}
          {maskCount > 0 && <span className="ts-count">{maskCount}</span>}
        </button>
      </div>
      <div className="ts-jump">
        <GlassSelect
          label={t('Jump to a panel')}
          prefix={t('Jump to')}
          value={drawer === 'adjust' ? focus : null}
          options={options}
          onChange={jumpToCard}
        />
        <button
          className={`icon ts-solo${solo ? ' on' : ''}`}
          aria-pressed={solo}
          aria-label={t('Solo mode')}
          title={solo ? t('Solo: one panel open at a time') : t('Solo: open one panel at a time')}
          onClick={() => setSolo(!solo)}
        >
          <PathIcon d={SOLO_ICON} />
        </button>
      </div>
    </div>
  )
}
