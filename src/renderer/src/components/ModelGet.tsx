/**
 * A model a step needs, where the step is chosen: nothing once it is here,
 * otherwise its name and size with Download, or the download's progress.
 * Settings → AI models lists every model; this offers only the one in reach.
 */
import type { ModelInfo } from '../../../shared/ipc'
import { api, errorText } from '../lib/api'
import { mb } from '../lib/models'
import { useLibrary } from '../state/library'
import { t } from '../lib/i18n'

export function ModelGet({
  id,
  models
}: {
  id: string
  models: ModelInfo[]
}): React.JSX.Element | null {
  const say = useLibrary((s) => s.say)
  const m = models.find((x) => x.id === id)
  if (!m || m.installed) return null
  return (
    <div className="model-get">
      <span className="muted" title={m.caveat}>
        {m.title}
        {m.error && <span className="error"> · {m.error}</span>}
      </span>
      {m.progress !== null ? (
        <span className="model-bar" aria-label={t('Downloading')}>
          <span style={{ width: `${Math.round(m.progress * 100)}%` }} />
        </span>
      ) : (
        <button
          className="sm"
          onClick={() => void api.models.download(m.id).catch((e) => say(errorText(e), 'error'))}
        >
          {t('Download {{size}}', { size: mb(m.bytes) })}
        </button>
      )}
    </div>
  )
}
