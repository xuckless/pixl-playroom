/**
 * Settings → AI models: each model under what it is for in Playroom, said
 * in plain words, with how long it takes on this computer; getting or
 * removing it; and a speed test that tells the times apart from a guess.
 * Models download on demand from models.pixlfoundation.com (see
 * `main/ai/models.ts`); nothing ships with the app.
 */
import { useEffect, useState } from 'react'
import type { ModelInfo, ProviderInfo } from '../../../shared/ipc'
import { TYPICAL_MP } from '../../../shared/modelSpeed'
import { GlassSelect } from '../components/GlassSelect'
import { api, errorText } from '../lib/api'
import { useLibrary } from '../state/library'
import { copyOf, duration, MODEL_COPY, pace, PURPOSES, type Purpose } from './modelCopy'

const mb = (bytes: number): string =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`

/** What the accelerator is, in words a person knows. */
const CHIP: Record<string, string> = {
  coreml: 'the Neural Engine and graphics chip',
  directml: 'the graphics card'
}

const PACE_WORD = { quick: 'Quick', moment: 'Takes a moment', slow: 'Slow' }

/** How long a model takes here, and how sure that is. */
function Speed({ m }: { m: ModelInfo }): React.JSX.Element | null {
  const s = m.speed
  if (!s) return null
  const per = m.role === 'segment' ? 'per photo' : `for a ${TYPICAL_MP}-megapixel photo`
  const basis =
    s.basis === 'runs'
      ? 'measured on this computer'
      : s.basis === 'test'
        ? 'estimated from this computer’s speed test'
        : 'a typical computer; test yours below'
  const p = pace(s.msPerPhoto)
  return (
    <div className={`model-speed ${p}`}>
      <span className="model-pace">{PACE_WORD[p]}</span>
      <span>
        {duration(s.msPerPhoto)} {per}
      </span>
      <span className="muted"> · {basis}</span>
    </div>
  )
}

function ModelRow({ m }: { m: ModelInfo }): React.JSX.Element {
  const c = copyOf(m)
  return (
    <li className="model-row">
      <div className="model-main">
        <div className="model-name">
          {c.name}
          {m.retiring ? (
            <span className="model-rec retiring">Being retired</span>
          ) : (
            c.recommended && <span className="model-rec">Recommended</span>
          )}
        </div>
        <p className="model-what">{c.what}</p>
        {m.retiring && m.replacedBy && (
          <div className="model-where">
            Replaced by {MODEL_COPY[m.replacedBy]?.name ?? m.replacedBy} in the next update
          </div>
        )}
        <Speed m={m} />
        {c.where && <div className="model-where">In Playroom: {c.where}</div>}
        <div className="model-tech muted" title={m.caveat}>
          {m.title.split(':')[0]} · {mb(m.bytes)} · {m.licence}
        </div>
        {m.error && <div className="error micro">{m.error}</div>}
      </div>
      <div className="model-act">
        {m.progress !== null ? (
          <>
            <div className="model-bar" aria-label="Downloading">
              <span style={{ width: `${Math.round(m.progress * 100)}%` }} />
            </div>
            <button className="sm ghost" onClick={() => void api.models.cancel(m.id)}>
              Cancel
            </button>
          </>
        ) : m.installed ? (
          <button className="sm ghost" onClick={() => void api.models.remove(m.id)}>
            Remove
          </button>
        ) : (
          <button className="sm" onClick={() => void api.models.download(m.id)}>
            Download · {mb(m.bytes)}
          </button>
        )}
      </div>
    </li>
  )
}

export function ModelsSection(): React.JSX.Element {
  const say = useLibrary((s) => s.say)
  const [models, setModels] = useState<ModelInfo[] | null>(null)
  const [provider, setProvider] = useState<ProviderInfo | null>(null)
  const [testing, setTesting] = useState(false)
  const [show, setShow] = useState<Purpose | 'all'>('all')
  useEffect(() => {
    void api.models.list().then(setModels, (e) => say(errorText(e), 'error'))
    void api.models.provider().then(setProvider, () => undefined)
    return api.models.onEvent(setModels)
  }, [say])
  const all = models ?? []
  const installed = all.filter((m) => m.installed)
  const used = installed.reduce((s, m) => s + m.bytes, 0)
  const purposes = PURPOSES.filter((p) => all.some((m) => m.role === p.id))
  const shown = show === 'all' ? purposes : purposes.filter((p) => p.id === show)
  const chip = provider?.accelerator ? (CHIP[provider.accelerator] ?? 'the graphics chip') : null
  const onChip = provider?.choice === 'accelerated' && chip
  const t = provider?.measured
  const sec = (ms: number): string => `${(ms / 1000).toFixed(2)} s`
  return (
    <fieldset className="models">
      <legend>AI models</legend>
      <p className="muted small">
        Each one is downloaded only when you want it and kept on this computer
        {installed.length ? ` (${mb(used)} in use)` : ''}. Pick what you want to do to see the
        models for it.
      </p>
      <div className="models-filter">
        <GlassSelect
          label="Show models for"
          prefix="Show"
          value={show}
          options={[
            { value: 'all', label: 'Everything' },
            ...purposes.map((p) => ({ value: p.id, label: p.title }))
          ]}
          onChange={setShow}
        />
      </div>
      {shown.map((p) => (
        <section key={p.id} className="model-group">
          <h4>{p.title}</h4>
          <p className="muted small">{p.what}</p>
          <ul>
            {all
              .filter((m) => m.role === p.id)
              .sort(
                (a, b) =>
                  Number(!!a.retiring) - Number(!!b.retiring) ||
                  Number(!!copyOf(b).recommended) - Number(!!copyOf(a).recommended)
              )
              .map((m) => (
                <ModelRow key={m.id} m={m} />
              ))}
          </ul>
        </section>
      ))}
      <section className="model-group model-device">
        <h4>This computer</h4>
        <p className="small">
          {onChip ? `AI runs on ${chip}.` : 'AI runs on the processor.'}
          {t && (t.acceleratedMs !== null || t.cpuMs !== null) && (
            <>
              {' '}
              In the last speed test, one test picture took
              {t.acceleratedMs !== null && chip ? ` ${sec(t.acceleratedMs)} on ${chip}` : ''}
              {t.acceleratedMs !== null && chip && t.cpuMs !== null ? ' and' : ''}
              {t.cpuMs !== null ? ` ${sec(t.cpuMs)} on the processor` : ''}; Playroom uses the
              faster.
            </>
          )}
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
                .then(() => api.models.list().then(setModels))
                .finally(() => setTesting(false))
            }}
          >
            {testing ? 'Testing…' : 'Test this computer’s speed'}
          </button>
          <span className="muted small">
            {installed.length
              ? 'A few seconds. The times above then match this computer.'
              : 'Download any model first.'}
          </span>
        </div>
        <p className="muted micro">
          Each model’s licence is in the third-party notices. Hover a model’s technical name for
          what is known about the data it was trained on.
        </p>
      </section>
    </fieldset>
  )
}
