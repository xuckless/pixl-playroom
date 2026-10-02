import type { ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Icon } from '../components/icons'
import { Mark } from '../components/Mark'
import { Spinner } from '../fx'
import { api } from '../lib/api'
import { useBusy } from '../state/busy'
import { liveJobs, useAiJobs } from '../state/jobs'
import { useDevelop } from '../state/develop'
import { useLibrary } from '../state/library'

/** The engine's state as a breathing dot; the last render's time on hover. */
export function EngineStatus(): React.JSX.Element {
  const engine = useLibrary((s) => s.engine)
  const ms = useDevelop((s) => (s.session ? (s.report?.totalMs ?? null) : null))
  const rendering = useDevelop((s) => s.rendering && s.session !== null)
  const status = engine?.status ?? 'starting'
  const ok = status === 'ready'
  return (
    <span
      className={`engine-status micro ${ok ? 'ok' : 'bad'}`}
      title={engine?.reason ?? (ok && ms !== null ? `Last render ${ms} ms` : '')}
    >
      <i className={`status-dot${rendering ? ' busy' : ''}${ok ? '' : ' bad'}`} />
      Engine {status}
    </span>
  )
}

/**
 * Work running in the background, as the inline loader and its latest word:
 * the busy jobs, and AI jobs on any photo (click one to go to its photo;
 * each can be stopped).
 */
export function BackgroundJobs(): React.JSX.Element | null {
  const jobs = useBusy(useShallow((s) => s.jobs.filter((j) => j.scope === 'global')))
  const ai = useAiJobs(useShallow((s) => liveJobs(s.jobs)))
  const shownKey = useDevelop((s) => s.session?.key ?? null)
  if (jobs.length === 0 && ai.length === 0) return null
  if (ai.length > 0) {
    const first = ai[0]
    const pct = first.progress === null ? null : Math.round(first.progress * 100)
    return (
      <span className="bg-jobs micro" title={first.message ?? first.title}>
        <Spinner size={14} />
        <button
          className="bg-job-link"
          title={first.key === shownKey ? first.name : `Go to ${first.name}`}
          onClick={() => {
            const lib = useLibrary.getState()
            lib.setFocus(first.key)
            lib.setView('develop')
            void useDevelop.getState().open(first.key)
          }}
        >
          {first.title}
          {first.subject ? ` ${first.subject}` : ''} · {first.name}
        </button>
        {pct !== null && <span className="t-num"> {pct}%</span>}
        {ai.length > 1 ? ` +${ai.length - 1} queued` : ''}
        <button className="icon sm" title="Stop" onClick={() => void api.ai.cancel(first.jobId)}>
          <Icon name="close" />
        </button>
      </span>
    )
  }
  const last = jobs[jobs.length - 1]
  return (
    <span className="bg-jobs micro" title={last.detail ?? last.title}>
      <Spinner size={14} />
      {last.title}
      {last.progress !== null && <span className="t-num"> {Math.round(last.progress * 100)}%</span>}
      {jobs.length > 1 ? ` ×${jobs.length}` : ''}
      {last.cancel && (
        <button className="icon sm" title="Stop" onClick={last.cancel}>
          <Icon name="close" />
        </button>
      )}
    </span>
  )
}

/** The first tier: who we are, what is open, and how the engine is. */
export function IdentityBar({
  children,
  facts
}: {
  children?: ReactNode
  facts?: ReactNode
}): React.JSX.Element {
  return (
    <header className="identity-bar">
      <span className="brand">
        <Mark size={16} detail="small" />
        <span className="wordmark">
          PIXL <em>PLAYROOM</em>
        </span>
      </span>
      <span className="vsep" />
      <span className="identity">{children}</span>
      <span className="spacer" />
      {facts && (
        <>
          <span className="micro facts">{facts}</span>
          <span className="vsep" />
        </>
      )}
      <BackgroundJobs />
      <EngineStatus />
    </header>
  )
}

/** The develop view's identity: file, kind, copy, and the frame's facts. */
export function DevelopIdentity(): React.JSX.Element {
  const session = useDevelop((s) => s.shown)
  if (!session) return <IdentityBar />
  const { item, info } = session
  const mp = (session.frameWidth * session.frameHeight) / 1e6
  const kind = session.isRaw ? 'RAW' : item.ext.toUpperCase()
  return (
    <IdentityBar
      facts={
        <>
          {Number.isFinite(mp) ? `${mp.toFixed(1)} MP · ` : ''}
          {info.color} · {info.bits}-bit{info.is_hdr ? ' · HDR' : ''}
        </>
      }
    >
      <span className="t-body file-name" title={item.path}>
        {item.name}
      </span>
      <span className="badge">{kind}</span>
      {(info.gain_map || info.is_hdr) && (
        <span
          className="badge hdr"
          title={
            info.gain_map
              ? session.isHdr
                ? 'Edited as HDR: the rendition its gain map lifts it to'
                : 'An SDR picture with a gain map: edit it as HDR from the toolbar'
              : 'An HDR (PQ/HLG) photo'
          }
        >
          HDR{info.gain_map ? (session.isHdr ? '' : ' · map') : ''}
        </span>
      )}
      {item.copyName && <span className="badge ghost">{item.copyName}</span>}
    </IdentityBar>
  )
}
