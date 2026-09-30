import type { AiJobEvent } from '../../../shared/ai'
import { stageStates } from '../../../shared/ai'
import type { Rect } from '../../../shared/view'
import { LiquidGlass } from '../components/glass/LiquidGlass'
import { Mark } from '../components/Mark'
import { api } from '../lib/api'
import { useDevelop } from '../state/develop'
import { jobFor, useAiJobs } from '../state/jobs'
import { useFxMode } from './mode'

/** Loose pixels lighting up over the photo while a model looks at it (x, y, delay). */
const SPARKS: [number, number, number][] = [
  [0.18, 0.3, 0],
  [0.72, 0.22, 0.6],
  [0.44, 0.64, 1.1],
  [0.86, 0.7, 0.3],
  [0.3, 0.82, 1.6],
  [0.6, 0.44, 2.0],
  [0.1, 0.58, 2.4],
  [0.52, 0.12, 1.4]
]

/**
 * An AI job on the photo in view, as the loupe shows it: the photo dims
 * under a pixel-stepped scan line that sweeps it (a model reading it), loose
 * pixels light up where it looks, and a glass card says what is happening —
 * the task and its subject, its stages as pixels (done, now, to come), how
 * far along it is, and Cancel. The photo stays yours: the veil lets the
 * pointer through, and switching photos leaves the job running (its chip
 * shows on the filmstrip).
 */
export function AiScan({ rect }: { rect: Rect }): React.JSX.Element | null {
  const key = useDevelop((s) => s.session?.key ?? null)
  const job = useAiJobs((s) => jobFor(s.jobs, key))
  const fx = useFxMode()
  if (!job) return null
  const ended = job.phase === 'done' || job.phase === 'error' || job.phase === 'cancelled'
  // AI denoise shows its preview while the full resolution is made, and
  // Enhance makes another file: the photo is not dimmed then, only the card
  // says it goes on.
  const quiet =
    job.task === 'enhance' ||
    (job.task === 'denoise' && job.stage !== 'model' && job.stage !== 'preview')
  if (quiet) return <AiCard job={job} ended={ended} />
  return (
    <>
      <div
        className={`ai-veil${ended ? ' ended' : ''}${fx === 'static' ? ' still' : ''}`}
        style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
        aria-hidden
      >
        <div className="ai-band" />
        {fx !== 'static' &&
          SPARKS.map(([x, y, d], i) => (
            <i
              key={i}
              className="ai-spark"
              style={{ left: `${x * 100}%`, top: `${y * 100}%`, animationDelay: `${d}s` }}
            />
          ))}
      </div>
      <AiCard job={job} ended={ended} />
    </>
  )
}

function AiCard({ job, ended }: { job: AiJobEvent; ended: boolean }): React.JSX.Element {
  const states = stageStates(job.stages, job.stage, job.phase)
  const pct = job.progress === null ? null : Math.round(job.progress * 100)
  const word =
    job.phase === 'queued'
      ? 'Waiting its turn'
      : job.phase === 'done'
        ? 'Done'
        : job.phase === 'cancelled'
          ? 'Cancelled'
          : job.phase === 'error'
            ? (job.message ?? 'Failed')
            : (job.message ?? job.stages.find((s) => s.id === job.stage)?.label)
  return (
    <LiquidGlass
      className={`ai-card ${job.phase}`}
      radius={2}
      bezel={10}
      frost={8}
      role="status"
      aria-live="polite"
    >
      <Mark size={30} drift={!ended} glow={job.phase === 'running'} />
      <div className="ai-body">
        <span className="ai-title micro">
          {job.title}
          {job.subject && <em> · {job.subject}</em>}
        </span>
        <span className="ai-stages">
          {job.stages.map((s, i) => (
            <span key={s.id} className={`ai-stage ${states[i]}`}>
              <i />
              {s.label}
            </span>
          ))}
        </span>
        <span className="ai-track">
          <span
            className={`ai-fill${pct === null ? ' unknown' : ''}`}
            style={pct === null ? undefined : { width: `${pct}%` }}
          />
        </span>
        <span className="ai-foot">
          <span className={`ai-word${job.phase === 'error' ? ' error' : ''}`}>{word}</span>
          {pct !== null && !ended && (
            <span
              className="t-num"
              title={job.estimated ? 'Estimated from earlier runs' : undefined}
            >
              {job.estimated ? '~' : ''}
              {pct}%
            </span>
          )}
        </span>
      </div>
      {!ended && (
        <button className="sm ghost ai-cancel" onClick={() => void api.ai.cancel(job.jobId)}>
          Cancel
        </button>
      )}
    </LiquidGlass>
  )
}

/** A job's chip on a filmstrip tile: how far its photo's job is, or that it waits. */
export function AiChip({ photoKey }: { photoKey: string }): React.JSX.Element | null {
  const job = useAiJobs((s) => jobFor(s.jobs, photoKey))
  if (!job || (job.phase !== 'running' && job.phase !== 'queued')) return null
  const pct = job.progress === null ? null : Math.round(job.progress * 100)
  return (
    <span
      className={`ai-chip ${job.phase}`}
      title={`${job.title}${job.subject ? ` · ${job.subject}` : ''}`}
    >
      <i />
      {job.phase === 'queued' ? '···' : pct === null ? '' : `${pct}%`}
    </span>
  )
}
