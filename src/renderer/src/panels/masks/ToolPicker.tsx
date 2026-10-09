import { Icon } from '../../components/icons'
import { useDevelop } from '../../state/develop'
import { useAiJobs } from '../../state/jobs'
import { useModels } from '../../lib/models'
import { keyHint } from '../../lib/commands'
import { t } from '../../lib/i18n'
import { useState } from 'react'
import { PHRASE_MODELS } from '../../../../shared/ai'
import {
  MASK_TOOL_GROUPS,
  startMaskTool,
  startPhrase,
  type MaskToolInfo,
  type MaskToolKind
} from './model'

/**
 * Lightroom's "Create new mask" menu: every tool a mask can be made with.
 * A tool whose model is not downloaded says "get", and picking it offers
 * that model there and then (state/modelPrompt.ts) before it starts; one
 * the engine cannot run yet (a depth map) says "soon".
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
  const models = useModels()
  const [phrase, setPhrase] = useState('')
  // No phrase model yet: Enter offers SAM 3 (or a box with Objects).
  const phraseGet =
    models.length > 0 && !PHRASE_MODELS.some((id) => models.find((m) => m.id === id)?.installed)
  // A named mask's model not downloaded yet: the tool offers it when picked.
  const toGet = (tool: MaskToolInfo): boolean =>
    !!tool.model && models.length > 0 && models.find((m) => m.id === tool.model)?.installed !== true
  // A model's tool is there when its model is downloaded; until then it
  // says why, and picking it offers the model.
  const needs = (tool: MaskToolInfo): string | undefined =>
    tool.model
      ? caps?.denoise
        ? undefined
        : (caps?.why.denoise ?? t('this engine build runs no models'))
      : tool.ai && caps?.[tool.ai]
        ? undefined
        : ((tool.ai && caps?.why[tool.ai]) ?? (tool.needs ? t(tool.needs) : undefined))
  const downloadable = (tool: MaskToolInfo): boolean =>
    Boolean(tool.ai && needs(tool) && caps?.get?.[tool.ai])
  const pick = (kind: MaskToolKind): void => {
    startMaskTool(kind)
    onDone?.()
  }
  return (
    <div className={`tool-picker${inline ? ' inline' : ''}`}>
      {addMode && (
        <div className="tp-mode micro">
          {addMode === 'Add'
            ? t('Add to the mask')
            : addMode === 'Subtract'
              ? t('Subtract from the mask')
              : t('Intersect with the mask')}
        </div>
      )}
      <form
        className="tp-find"
        onSubmit={(e) => {
          e.preventDefault()
          if (!phrase.trim()) return
          startPhrase(phrase)
          setPhrase('')
          onDone?.()
        }}
      >
        <Icon name="search" />
        <input
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          placeholder={t('Find by name: red car, the dog…')}
          aria-label={t('Find by name')}
          maxLength={80}
          spellCheck={false}
        />
        {phraseGet && <span className="tp-needs">{t('get')}</span>}
      </form>
      {MASK_TOOL_GROUPS.map((g) => (
        <div key={g.title} className="tp-group">
          <span className="micro">{t(g.title)}</span>
          <div className="tp-grid">
            {g.tools.map((tool) => (
              <button
                key={tool.kind}
                className="tp-tool"
                disabled={Boolean(needs(tool)) && !downloadable(tool)}
                title={
                  needs(tool)
                    ? `${t(tool.label)} — ${needs(tool)}`
                    : `${t(tool.label)}${tool.hint ? `: ${t(tool.hint)}` : tool.ai ? ` (${t('found by a model')})` : ''}${tool.command && keyHint(tool.command) ? ` (${keyHint(tool.command)})` : ''}`
                }
                onClick={() => pick(tool.kind)}
              >
                <Icon name={tool.icon} />
                <span className="tp-label">{t(tool.label)}</span>
                {tool.command && keyHint(tool.command) && (
                  <span className="kbd">{keyHint(tool.command)}</span>
                )}
                {needs(tool) && (
                  <span className="tp-needs">{downloadable(tool) ? t('get') : t('soon')}</span>
                )}
                {!needs(tool) && toGet(tool) && <span className="tp-needs">{t('get')}</span>}
                {(tool.ai || tool.model) && !needs(tool) && !toGet(tool) && (
                  <span className="tp-needs ai">{tool.badge ? t(tool.badge) : t('AI')}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
