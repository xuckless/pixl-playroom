/**
 * Settings → AI models: what each model does, its size and licence, and
 * getting or removing it; which provider runs them, and a test to choose.
 * Models download on demand from models.pixlfoundation.com (see
 * `main/ai/models.ts`); nothing ships with the app.
 */
import { useEffect, useState } from 'react'
import type { ModelInfo, ProviderInfo } from '../../../shared/ipc'
import { api, errorText } from '../lib/api'
import { useLibrary } from '../state/library'

const ROLE: Record<ModelInfo['role'], string> = {
  upscale: 'Upscale',
  denoise: 'Denoise',
  deblur: 'Deblur',
  restore: 'JPEG restore',
  segment: 'Subject masks',
  inpaint: 'Remove'
}

const mb = (bytes: number): string =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`

const ACCEL: Record<string, string> = {
  coreml: 'CoreML (Neural Engine / GPU)',
  directml: 'DirectML (GPU)'
}

export function ModelsSection(): React.JSX.Element {
  const say = useLibrary((s) => s.say)
  const [models, setModels] = useState<ModelInfo[] | null>(null)
  const [provider, setProvider] = useState<ProviderInfo | null>(null)
  const [testing, setTesting] = useState(false)
  useEffect(() => {
    void api.models.list().then(setModels, (e) => say(errorText(e), 'error'))
    void api.models.provider().then(setProvider, () => undefined)
    return api.models.onEvent(setModels)
  }, [say])
  const installed = models?.filter((m) => m.installed) ?? []
  const used = installed.reduce((s, m) => s + m.bytes, 0)
  const m = provider?.measured
  return (
    <fieldset className="models">
      <legend>AI models</legend>
      <p className="muted small">
        Downloaded when you want them, checked, and kept on this computer
        {installed.length ? ` (${mb(used)} in use)` : ''}.
      </p>
      <table className="models-table">
        <tbody>
          {(models ?? []).map((x) => (
            <tr key={x.id}>
              <td>
                <div className="model-title" title={x.caveat}>
                  {x.title}
                </div>
                <div className="muted micro">
                  {ROLE[x.role]} · {mb(x.bytes)} · {x.licence}
                </div>
                {x.error && <div className="error micro">{x.error}</div>}
              </td>
              <td className="model-act">
                {x.progress !== null ? (
                  <>
                    <div className="model-bar" aria-label="Downloading">
                      <span style={{ width: `${Math.round(x.progress * 100)}%` }} />
                    </div>
                    <button className="sm ghost" onClick={() => void api.models.cancel(x.id)}>
                      Cancel
                    </button>
                  </>
                ) : x.installed ? (
                  <button className="sm ghost" onClick={() => void api.models.remove(x.id)}>
                    Remove
                  </button>
                ) : (
                  <button className="sm" onClick={() => void api.models.download(x.id)}>
                    Download
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="prefs-status">
        Runs on{' '}
        {provider?.choice === 'accelerated' && provider.accelerator
          ? (ACCEL[provider.accelerator] ?? provider.accelerator)
          : 'the CPU'}
        {m
          ? ` · measured ${m.acceleratedMs !== null ? `${m.acceleratedMs} ms accelerated, ` : ''}${m.cpuMs !== null ? `${m.cpuMs} ms CPU` : 'CPU unavailable'}`
          : ''}
      </p>
      <div className="prefs-row">
        <button
          disabled={testing || installed.length === 0}
          title={installed.length ? '' : 'Download a model first'}
          onClick={() => {
            setTesting(true)
            void api.models
              .benchmark()
              .then(setProvider, (e) => say(errorText(e), 'error'))
              .finally(() => setTesting(false))
          }}
        >
          {testing ? 'Testing…' : 'Test performance'}
        </button>
      </div>
      <p className="muted micro">
        Each model&apos;s licence is in the third-party notices. Hover a model&apos;s name for what
        is known about the data it was trained on.
      </p>
    </fieldset>
  )
}
