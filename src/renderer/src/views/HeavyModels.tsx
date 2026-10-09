/**
 * Settings → AI models: the killswitch ("Use AI models") and the heavy
 * models (shared/heavy.ts). Gemma and SAM 3 start off; each turns on only
 * after a sustained-load benchmark passes on this computer, its result
 * shown in plain words either way.
 */
import { useEffect, useState } from 'react'
import { SAM3_PHRASE } from '../../../shared/ai'
import type { BrainStatus, ModelInfo } from '../../../shared/ipc'
import type { AiSwitches, HeavyBenchmark, HeavyModel } from '../../../shared/heavy'
import { api, errorText } from '../lib/api'
import { useLibrary } from '../state/library'
import { t, tp } from '../lib/i18n'

const mb = (bytes: number): string =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`

/** "Use AI models": the killswitch. */
export function AiKillswitch({ s }: { s: AiSwitches | null }): React.JSX.Element {
  const say = useLibrary((x) => x.say)
  const on = s?.enabled !== false
  return (
    <section className="model-group model-kill">
      <label className="check">
        <input
          type="checkbox"
          checked={on}
          disabled={!s}
          onChange={(e) =>
            void api.ai.setEnabled(e.target.checked).catch((err) => say(errorText(err), 'error'))
          }
        />
        <strong>{t('Use AI models')}</strong>
      </label>
      <p className="muted small">
        {on
          ? t(
              'Off stops every AI model at once: masks found by a model, AI denoise, Enhance, Find by name and Gemma. RAW files still develop with their model.'
            )
          : t(
              'AI models are off. Nothing below runs until you turn them back on; RAW files still develop with their model.'
            )}
      </p>
    </section>
  )
}

function BenchResult({ b, machine }: { b: HeavyBenchmark; machine: string }): React.JSX.Element {
  const here = b.machine === machine
  return (
    <div className={`heavy-result ${b.passed && here ? 'ok' : 'no'}`}>
      <strong>
        {!here
          ? t('Benchmarked on another computer: run it again here')
          : b.passed
            ? t('Passed: this computer can keep it up')
            : t('Not passed: this computer can’t keep it up')}
      </strong>
      <ul>
        {b.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <span className="muted micro">
        {new Date(b.at).toLocaleString()} · {tp('{{count}} run', '{{count}} runs', b.runs.length)} ·{' '}
        {t('loaded in {{seconds}} s', { seconds: (b.readyMs / 1000).toFixed(1) })}
      </span>
    </div>
  )
}

/** One heavy model: get it, benchmark it, then turn it on. */
function HeavyCard({
  model,
  name,
  what,
  installed,
  bytes,
  progress,
  error,
  licence,
  s,
  machine,
  download,
  cancel,
  remove
}: {
  model: HeavyModel
  name: string
  what: string
  installed: boolean
  bytes: number
  progress: number | null
  error: string | null
  licence: string
  s: AiSwitches | null
  machine: string
  download: () => void
  cancel: () => void
  remove: () => void
}): React.JSX.Element {
  const say = useLibrary((x) => x.say)
  const [bench, setBench] = useState<{ progress: number; note: string } | null>(null)
  useEffect(
    () =>
      api.ai.onBenchmark((p) => {
        if (p.model === model) setBench(p.progress >= 1 ? null : p)
      }),
    [model]
  )
  const h = s?.heavy[model]
  const passed = !!h?.benchmark?.passed && h.benchmark.machine === machine
  const aiOn = s?.enabled !== false
  const run = (): void => {
    setBench({ progress: 0, note: t('Starting') })
    void api.ai
      .benchmark(model)
      .catch((err) => say(errorText(err), 'error'))
      .finally(() => setBench(null))
  }
  return (
    <li className="model-row heavy">
      <div className="model-main">
        <div className="model-name">
          {name}
          <span className="model-rec">
            {h?.on ? t('On') : t('Off until benchmarked and turned on')}
          </span>
        </div>
        <p className="model-what">{what}</p>
        <div className="model-tech muted">
          {mb(bytes)} · {licence}
        </div>
        {error && <div className="error micro">{error}</div>}
        {h?.benchmark && <BenchResult b={h.benchmark} machine={machine} />}
        {bench && (
          <div className="heavy-bench">
            <div className="model-bar" aria-label={t('Benchmarking')}>
              <span style={{ width: `${Math.round(bench.progress * 100)}%` }} />
            </div>
            <span className="muted micro">
              {t('Benchmark: {{note}}. It works at full load for about a minute.', {
                note: bench.note
              })}
            </span>
          </div>
        )}
      </div>
      <div className="model-act">
        {progress !== null ? (
          <>
            <div className="model-bar" aria-label={t('Downloading')}>
              <span style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <button className="sm ghost" onClick={cancel}>
              {t('Cancel')}
            </button>
          </>
        ) : !installed ? (
          <button className="sm" onClick={download}>
            {t('Download')} · {mb(bytes)}
          </button>
        ) : (
          <>
            <label
              className="check"
              title={passed ? '' : t('Run the benchmark first: it has to pass on this computer')}
            >
              <input
                type="checkbox"
                checked={h?.on === true}
                disabled={!passed || !aiOn || !!bench}
                onChange={(e) =>
                  void api.ai
                    .setHeavy(model, e.target.checked)
                    .catch((err) => say(errorText(err), 'error'))
                }
              />
              {t('On')}
            </label>
            <button className="sm" disabled={!!bench || !aiOn} onClick={run}>
              {h?.benchmark ? t('Benchmark again') : t('Run the benchmark')}
            </button>
            <button className="sm ghost" disabled={!!bench} onClick={remove}>
              {t('Remove')}
            </button>
          </>
        )}
      </div>
    </li>
  )
}

/** The heavy models' section. */
export function HeavyModels({
  s,
  models
}: {
  s: AiSwitches | null
  models: ModelInfo[]
}): React.JSX.Element | null {
  const [brain, setBrain] = useState<BrainStatus | null>(null)
  useEffect(() => {
    void api.brain.status().then(setBrain, () => undefined)
    return api.brain.onEvent(setBrain)
  }, [])
  const sam3 = models.find((m) => m.id === 'sam3')
  // Neither in this build (0.4.0-beta ships without them): no section at all.
  if (!brain?.supported && !(SAM3_PHRASE && sam3)) return null
  return (
    <section className="model-group">
      <h4>{t('Heavy models')}</h4>
      <p className="muted small">
        {t(
          'Large models that work your computer hard. Each stays off until a benchmark shows this computer can keep it up, and you turn it on.'
        )}
      </p>
      <ul>
        {brain?.supported && (
          <HeavyCard
            model="gemma"
            name={t('Gemma, the local assistant')}
            what={t(
              'A small language model that looks at your photos on this computer, nothing sent anywhere: it will name what is in each one, so masks are a tap away. It will work in the background only while the computer is idle and plugged in.'
            )}
            installed={brain.installed}
            bytes={brain.bytes}
            progress={brain.progress}
            error={brain.error}
            licence={brain.licence}
            s={s}
            machine={brain.machine}
            download={() => void api.brain.download()}
            cancel={() => void api.brain.cancel()}
            remove={() => void api.brain.remove()}
          />
        )}
        {SAM3_PHRASE && sam3 && brain && (
          <HeavyCard
            model="sam3"
            name={t('SAM 3, Find by name at its best')}
            what={t(
              'The larger, surer model behind Find by name: it finds more, and says “nothing” rather than guess. It needs a lot of memory while it reads a photo.'
            )}
            installed={sam3.installed}
            bytes={sam3.bytes}
            progress={sam3.progress}
            error={sam3.error ?? null}
            licence={sam3.licence}
            s={s}
            machine={brain.machine}
            download={() => void api.models.download('sam3')}
            cancel={() => void api.models.cancel('sam3')}
            remove={() => void api.models.remove('sam3')}
          />
        )}
      </ul>
    </section>
  )
}
