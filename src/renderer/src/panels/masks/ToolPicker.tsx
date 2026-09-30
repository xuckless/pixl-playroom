import { Icon } from '../../components/icons'
import { useDevelop } from '../../state/develop'
import { useAiJobs } from '../../state/jobs'
import { useLibrary } from '../../state/library'
import { MASK_TOOL_GROUPS, startMaskTool, type MaskToolInfo, type MaskToolKind } from './model'

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
  const caps = useAiJobs((s) => s.capabilities)
  // A model's tool is there when its model is downloaded; until then it
  // says why, and a click opens Settings to get it.
  const needs = (t: MaskToolInfo): string | undefined =>
    t.ai && caps?.[t.ai] ? undefined : ((t.ai && caps?.why[t.ai]) ?? t.needs)
  const downloadable = (t: MaskToolInfo): boolean => Boolean(t.ai && needs(t))
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
                disabled={Boolean(needs(t)) && !downloadable(t)}
                title={
                  needs(t)
                    ? `${t.label} — ${needs(t)}`
                    : `${t.label}${t.ai ? ' (found by a model)' : ''}${t.key ? ` (${t.key})` : ''}`
                }
                onClick={() => {
                  if (downloadable(t)) {
                    onDone?.()
                    return useLibrary.getState().setDialog('preferences')
                  }
                  pick(t.kind)
                }}
              >
                <Icon name={t.icon} />
                <span className="tp-label">{t.label}</span>
                {t.key && <span className="kbd">{t.key}</span>}
                {needs(t) && <span className="tp-needs">{downloadable(t) ? 'get' : 'soon'}</span>}
                {t.ai && !needs(t) && <span className="tp-needs ai">AI</span>}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
