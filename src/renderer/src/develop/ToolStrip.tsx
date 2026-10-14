import { Icon, PathIcon } from '../components/icons'
import { useKeyHint } from '../lib/commands'
import { t } from '../lib/i18n'
import { useDevelop } from '../state/develop'
import { useUi } from '../state/ui'
import { STRIP_ICONS, toggleDrawer, toggleMasks } from './tools'

/**
 * Above the column: the canvas tools Lightroom keeps in its strip (Crop,
 * Heal, Masks). Which section shows is the dropdown under Treatment and
 * Profile (develop/AdjustStack.tsx).
 */
export function ToolStrip(): React.JSX.Element {
  const drawer = useUi((s) => s.drawer)
  const masksUp = useUi((s) => s.masksWin.open)
  const maskCount = useDevelop((s) => s.recipe?.layers.length ?? 0)
  const session = useDevelop((s) => s.session)
  const key = useKeyHint()
  const label = (name: string, id: string): string => {
    const k = key(id)
    return k ? `${name} (${k})` : name
  }
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
    </div>
  )
}
