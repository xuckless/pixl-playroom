import { Icon } from '../../components/icons'
import { useDevelop } from '../../state/develop'
import { useAiJobs } from '../../state/jobs'
import { useModels } from '../../lib/models'
import { keyHint } from '../../lib/commands'
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
  const toGet = (t: MaskToolInfo): boolean =>
    !!t.model && models.length > 0 && models.find((m) => m.id === t.model)?.installed !== true
  // A model's tool is there when its model is downloaded; until then it
  // says why, and picking it offers the model.
  const needs = (t: MaskToolInfo): string | undefined =>
    t.model
      ? caps?.denoise
        ? undefined
        : (caps?.why.denoise ?? 'this engine build runs no models')
      : t.ai && caps?.[t.ai]
        ? undefined
        : ((t.ai && caps?.why[t.ai]) ?? t.needs)
  const downloadable = (t: MaskToolInfo): boolean => Boolean(t.ai && needs(t) && caps?.get?.[t.ai])
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
          placeholder="Find by name: red car, the dog…"
          aria-label="Find by name"
          maxLength={80}
          spellCheck={false}
        />
        {phraseGet && <span className="tp-needs">get</span>}
      </form>
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
                    : `${t.label}${t.hint ? `: ${t.hint}` : t.ai ? ' (found by a model)' : ''}${t.command && keyHint(t.command) ? ` (${keyHint(t.command)})` : ''}`
                }
                onClick={() => pick(t.kind)}
              >
                <Icon name={t.icon} />
                <span className="tp-label">{t.label}</span>
                {t.command && keyHint(t.command) && (
                  <span className="kbd">{keyHint(t.command)}</span>
                )}
                {needs(t) && <span className="tp-needs">{downloadable(t) ? 'get' : 'soon'}</span>}
                {!needs(t) && toGet(t) && <span className="tp-needs">get</span>}
                {(t.ai || t.model) && !needs(t) && !toGet(t) && (
                  <span className="tp-needs ai">{t.badge ?? 'AI'}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
