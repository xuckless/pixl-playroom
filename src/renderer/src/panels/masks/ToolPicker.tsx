import { Icon } from '../../components/icons'
import { useDevelop } from '../../state/develop'
import { MASK_TOOL_GROUPS, startMaskTool, type MaskToolKind } from './model'

/**
 * Lightroom's "Create new mask" menu: every tool a mask can be made with.
 * The automatic ones wait on a segmentation model and a depth map; they are
 * here, and say so, rather than missing.
 */
export function ToolPicker({
  onDone,
  inline = false
}: {
  onDone?: () => void
  inline?: boolean
}): React.JSX.Element {
  const addMode = useDevelop((s) => s.addMode)
  const pick = (kind: MaskToolKind): void => {
    startMaskTool(kind)
    onDone?.()
  }
  return (
    <div className={`tool-picker${inline ? ' inline' : ''}`}>
      {addMode && (
        <div className="tp-mode micro">
          {addMode === 'Add'
            ? 'Add to'
            : addMode === 'Subtract'
              ? 'Subtract from'
              : 'Intersect with'}{' '}
          the mask
        </div>
      )}
      {MASK_TOOL_GROUPS.map((g) => (
        <div key={g.title} className="tp-group">
          <span className="micro">{g.title}</span>
          <div className="tp-grid">
            {g.tools.map((t) => (
              <button
                key={t.kind}
                className="tp-tool"
                disabled={Boolean(t.needs)}
                title={
                  t.needs ? `${t.label} — ${t.needs}` : `${t.label}${t.key ? ` (${t.key})` : ''}`
                }
                onClick={() => pick(t.kind)}
              >
                <Icon name={t.icon} />
                <span className="tp-label">{t.label}</span>
                {t.key && <span className="kbd">{t.key}</span>}
                {t.needs && <span className="tp-needs">soon</span>}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
