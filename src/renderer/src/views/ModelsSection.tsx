/**
 * Settings → AI models: each model under what it is for in Playroom, said
 * in plain words, with how long it takes on this computer; getting or
 * removing it; and a speed test that tells the times apart from a guess.
 * Models download on demand from models.pixlfoundation.com (see
 * `main/ai/models.ts`); nothing ships with the app.
 */
import { useEffect, useState } from 'react'
import type { ModelInfo, ProviderInfo } from '../../../shared/ipc'
import { pixlCpuAnswer, type AiSwitches, type PixlCpuAnswer } from '../../../shared/heavy'
import { TYPICAL_MP } from '../../../shared/modelSpeed'
import { offersPixlDemosaic } from '../../../shared/pixldemosaic'
import { GlassSelect } from '../components/GlassSelect'
import { Tabs } from '../components/ui'
import { api, errorText } from '../lib/api'
import { useLibrary } from '../state/library'
import { copyOf, duration, pace, PURPOSES, purposeOf, type Purpose } from './modelCopy'
import { AiKillswitch, HeavyModels } from './HeavyModels'
import { useSwitches } from '../lib/switches'
import { t, tk } from '../lib/i18n'

const mb = (bytes: number): string =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`

/** What the accelerator is, in words a person knows. */
const CHIP: Record<string, string> = {
  coreml: tk('the Neural Engine and graphics chip'),
  directml: tk('the graphics card')
}

const PACE_WORD = { quick: tk('Quick'), moment: tk('Takes a moment'), slow: tk('Slow') }

/** How long a model takes here, and how sure that is. */
function Speed({ m }: { m: ModelInfo }): React.JSX.Element | null {
  const s = m.speed
  if (!s) return null
  const time = duration(s.msPerPhoto)
  const took =
    m.role === 'segment'
      ? t('{{time}} per photo', { time })
      : t('{{time}} for a {{mp}}-megapixel photo', { time, mp: TYPICAL_MP })
  const basis =
    s.basis === 'runs'
      ? t('measured on this computer')
      : s.basis === 'test'
        ? t('estimated from this computer’s speed test')
        : t('a typical computer; test yours below')
  const p = pace(s.msPerPhoto)
  return (
    <div className={`model-speed ${p}`}>
      <span className="model-pace">{t(PACE_WORD[p])}</span>
      <span>{took}</span>
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
          {t(c.name)}
          {c.recommended && <span className="model-rec">{t('Recommended')}</span>}
        </div>
        <p className="model-what">{t(c.what)}</p>
        <Speed m={m} />
        {c.where && (
          <div className="model-where">{t('In Playroom: {{where}}', { where: t(c.where) })}</div>
        )}
        <div className="model-tech muted" title={m.caveat}>
          {m.title.split(':')[0]} · {mb(m.bytes)} · {m.licence}
        </div>
        {m.error && <div className="error micro">{m.error}</div>}
      </div>
      <div className="model-act">
        {m.progress !== null ? (
          <>
            <div className="model-bar" aria-label={t('Downloading')}>
              <span style={{ width: `${Math.round(m.progress * 100)}%` }} />
            </div>
            <button className="sm ghost" onClick={() => void api.models.cancel(m.id)}>
              {t('Cancel')}
            </button>
          </>
        ) : m.installed ? (
          <button className="sm ghost" onClick={() => void api.models.remove(m.id)}>
            {t('Remove')}
          </button>
        ) : (
          <button className="sm" onClick={() => void api.models.download(m.id)}>
            {t('Download')} · {mb(m.bytes)}
          </button>
        )}
      </div>
    </li>
  )
}

/**
 * "Use PIXL demosaic": a RAW's full-size develop with PIXL's own model (on
 * by default), or the develop of before. Shown where the roster offers the
 * model (engine 0.20.0's, or a development kit's).
 */
function PixlDemosaic({ s }: { s: AiSwitches | null }): React.JSX.Element {
  const say = useLibrary((x) => x.say)
  const on = s?.pixlDemosaic !== false
  const set = (to: boolean): void =>
    void api.ai.setPixlDemosaic(to).catch((err) => say(errorText(err), 'error'))
  return (
    <section className="model-group model-kill">
      <label className="check">
        <input type="checkbox" checked={on} disabled={!s} onChange={(e) => set(e.target.checked)} />
        <strong>{t('Use PIXL demosaic')}</strong>
      </label>
      <p className="muted small">
        {on
          ? t(
              'A RAW develops at full size with PIXL’s own model once it is downloaded. It takes out the grain as it develops, so “Denoise the RAW data” is not offered. Off goes back to the develop of before.'
            )
          : t(
              'RAW files develop as before PIXL’s own model. On, it develops them at full size and takes out the grain as it goes.'
            )}
      </p>
    </section>
  )
}

/** This computer, as main names it for answers kept per computer (`machineKey`). */
function useMachine(): string | null {
  const [m, setM] = useState<string | null>(null)
  useEffect(() => {
    void api.brain.status().then(
      (b) => setM(b.machine),
      () => undefined
    )
  }, [])
  return m
}

/**
 * "Run PIXL models on the processor": asked once per computer the first
 * time one would (main's ai/pixlcpu.ts), changed here. Shown where the
 * roster offers a PIXL model.
 */
function PixlCpu({ s }: { s: AiSwitches | null }): React.JSX.Element {
  const say = useLibrary((x) => x.say)
  const machine = useMachine()
  const answer: PixlCpuAnswer = s && machine !== null ? pixlCpuAnswer(s, machine) : 'ask'
  const set = (to: PixlCpuAnswer): void =>
    void api.ai.setPixlCpu(to).catch((err) => say(errorText(err), 'error'))
  return (
    <section className="model-group model-kill">
      <div className="row">
        <strong>{t('Run PIXL models on the processor')}</strong>
        <span className="spacer" />
        <Tabs
          value={answer}
          onChange={set}
          tabs={[
            { value: 'ask', label: t('Ask') },
            { value: 'yes', label: t('Yes') },
            { value: 'no', label: t('No') }
          ]}
        />
      </div>
      <p className="muted small">
        {t(
          'Where the graphics chip can’t run them. On the processor a RAW takes about 40 seconds to develop, and PIXL Enhance one to two minutes a photo; No develops RAWs as before and leaves Detail’s AI boxes waiting.'
        )}
      </p>
    </section>
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
  const switches = useSwitches()
  // SAM 3 is a heavy model: it has its own card below, behind its benchmark.
  // A borrowed model PIXL's own replaces is not listed (shared/borrowed.ts).
  const all = (models ?? []).filter((m) => m.id !== 'sam3' && m.listed)
  const installed = all.filter((m) => m.installed)
  const used = installed.reduce((s, m) => s + m.bytes, 0)
  const purposes = PURPOSES.filter((p) => all.some((m) => purposeOf(m.role) === p.id))
  const shown = show === 'all' ? purposes : purposes.filter((p) => p.id === show)
  const chip = provider?.accelerator
    ? t(CHIP[provider.accelerator] ?? tk('the graphics chip'))
    : null
  const onChip = provider?.choice === 'accelerated' && chip
  const measured = provider?.measured
  const sec = (ms: number): string => `${(ms / 1000).toFixed(2)} s`
  const fast = measured?.acceleratedMs ?? null
  const cpu = measured?.cpuMs ?? null
  const lastTest =
    fast !== null && chip && cpu !== null
      ? t(
          'In the last speed test, one test picture took {{fast}} on {{chip}} and {{cpu}} on the processor; Playroom uses the faster.',
          { fast: sec(fast), chip, cpu: sec(cpu) }
        )
      : fast !== null && chip
        ? t(
            'In the last speed test, one test picture took {{fast}} on {{chip}}; Playroom uses the faster.',
            { fast: sec(fast), chip }
          )
        : cpu !== null
          ? t(
              'In the last speed test, one test picture took {{cpu}} on the processor; Playroom uses the faster.',
              { cpu: sec(cpu) }
            )
          : null
  return (
    <fieldset className="models">
      <legend>{t('AI models')}</legend>
      <p className="muted small">
        {installed.length
          ? t(
              'Each one is downloaded only when you want it and kept on this computer ({{size}} in use). Pick what you want to do to see the models for it.',
              { size: mb(used) }
            )
          : t(
              'Each one is downloaded only when you want it and kept on this computer. Pick what you want to do to see the models for it.'
            )}
      </p>
      <AiKillswitch s={switches} />
      {offersPixlDemosaic(all) && <PixlDemosaic s={switches} />}
      {all.some((m) => m.id.startsWith('pixl-')) && <PixlCpu s={switches} />}
      <div className="models-filter">
        <GlassSelect
          label={t('Show models for')}
          prefix={t('Show')}
          value={show}
          options={[
            { value: 'all', label: t('Everything') },
            ...purposes.map((p) => ({ value: p.id, label: t(p.title) }))
          ]}
          onChange={setShow}
        />
      </div>
      {shown.map((p) => (
        <section key={p.id} className="model-group">
          <h4>{t(p.title)}</h4>
          <p className="muted small">{t(p.what)}</p>
          <ul>
            {all
              .filter((m) => purposeOf(m.role) === p.id)
              .sort((a, b) => Number(!!copyOf(b).recommended) - Number(!!copyOf(a).recommended))
              .map((m) => (
                <ModelRow key={m.id} m={m} />
              ))}
          </ul>
        </section>
      ))}
      <HeavyModels s={switches} models={models ?? []} />
      <section className="model-group model-device">
        <h4>{t('This computer')}</h4>
        <p className="small">
          {onChip ? t('AI runs on {{chip}}.', { chip }) : t('AI runs on the processor.')}
          {lastTest && <> {lastTest}</>}
        </p>
        <div className="prefs-row">
          <button
            disabled={testing || installed.length === 0}
            title={installed.length ? '' : t('Download a model first')}
            onClick={() => {
              setTesting(true)
              void api.models
                .benchmark()
                .then(setProvider, (e) => say(errorText(e), 'error'))
                .then(() => api.models.list().then(setModels))
                .finally(() => setTesting(false))
            }}
          >
            {testing ? t('Testing…') : t('Test this computer’s speed')}
          </button>
          <span className="muted small">
            {installed.length
              ? t('A few seconds. The times above then match this computer.')
              : t('Download any model first.')}
          </span>
        </div>
        <p className="muted micro">
          {t(
            'Each model’s licence is in the third-party notices. Hover a model’s technical name for what is known about the data it was trained on.'
          )}
        </p>
      </section>
    </fieldset>
  )
}
