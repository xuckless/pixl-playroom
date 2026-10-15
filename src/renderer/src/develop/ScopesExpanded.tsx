/**
 * The scopes at full size, as DaVinci Resolve shows them: one, two or four
 * at once, each place with its own ◀ ▶ through the histogram, RGB parade,
 * waveform, vectorscope, colour chart, CIE 1976 chart and the metrics. The
 * layout and what each place shows are kept (the ui store's `scopes`).
 */
import { t } from '../lib/i18n'
import { Modal, Segmented } from '../components/ui'
import { Icon } from '../components/icons'
import { cycleExpanded, type ExpandedScope } from '../../../shared/scopes'
import { useLibrary } from '../state/library'
import { useUi } from '../state/ui'
import { ScopeOptions, ScopeView } from './scopes/ScopeView'
import { SCOPE_LABEL } from './scopes/labels'

function Place({ index }: { index: number }): React.JSX.Element {
  const kind = useUi((s) => s.scopes.slots[index])
  const slots = useUi((s) => s.scopes.slots)
  const setScopes = useUi((s) => s.setScopes)
  const step = (d: 1 | -1): void => {
    const next = [...slots]
    next[index] = cycleExpanded(kind, d)
    setScopes({ slots: next })
  }
  return (
    <section className={`se-place se-${kind}`}>
      <div className="scope-head">
        <button className="icon sm" aria-label={t('Previous scope')} onClick={() => step(-1)}>
          <Icon name="chevronLeft" />
        </button>
        <span className="scope-name">{t(SCOPE_LABEL[kind as ExpandedScope])}</span>
        <button className="icon sm" aria-label={t('Next scope')} onClick={() => step(1)}>
          <Icon name="chevronRight" />
        </button>
        <span className="spacer" />
        <ScopeOptions kind={kind} />
      </div>
      <div className="se-body">
        <ScopeView kind={kind} expanded />
      </div>
    </section>
  )
}

export function ScopesExpandedDialog(): React.JSX.Element {
  const setDialog = useLibrary((s) => s.setDialog)
  const layout = useUi((s) => s.scopes.layout)
  const setScopes = useUi((s) => s.setScopes)
  const close = (): void => setDialog(null)
  return (
    <Modal
      title={t('Scopes')}
      onClose={close}
      icon="info"
      className={`scopes-expanded se-layout-${layout}`}
      footer={
        <button className="primary" autoFocus onClick={close}>
          {t('Done')}
        </button>
      }
    >
      <div className="se-tabs">
        <Segmented
          label={t('Scopes at once')}
          value={layout}
          onChange={(n) => setScopes({ layout: n })}
          options={([1, 2, 4] as const).map((n) => ({
            value: n,
            label: n === 1 ? t('One') : n === 2 ? t('Two') : t('Four')
          }))}
        />
      </div>
      <div className="se-grid">
        {Array.from({ length: layout }, (_, i) => (
          <Place key={i} index={i} />
        ))}
      </div>
    </Modal>
  )
}
