import type { ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useBusy } from '../state/busy'
import { useDevelop } from '../state/develop'
import { useLibrary } from '../state/library'

/** The engine's state as a breathing dot, with the last render's time when there is one. */
export function EngineStatus(): React.JSX.Element {
  const engine = useLibrary((s) => s.engine)
  const ms = useDevelop((s) => (s.session ? (s.report?.totalMs ?? null) : null))
  const rendering = useDevelop((s) => s.rendering && s.session !== null)
  const status = engine?.status ?? 'starting'
  const ok = status === 'ready'
  return (
    <span className={`engine-status micro ${ok ? 'ok' : 'bad'}`} title={engine?.reason ?? ''}>
      <i className={`status-dot${rendering ? ' busy' : ''}${ok ? '' : ' bad'}`} />
      Engine {status}
      {ok && ms !== null && <span className="t-num"> · {ms} ms</span>}
    </span>
  )
}

/** Work running in the background (an enhance), as a small orb and its latest word. */
export function BackgroundJobs(): React.JSX.Element | null {
  const jobs = useBusy(useShallow((s) => s.jobs.filter((j) => j.scope === 'global')))
  if (jobs.length === 0) return null
  const last = jobs[jobs.length - 1]
  return (
    <span className="bg-jobs micro" title={last.detail ?? last.title}>
      <i className="orb" />
      {last.title}
      {jobs.length > 1 ? ` ×${jobs.length}` : ''}
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
      <span className="wordmark">
        PIXL <em>PLAYROOM</em>
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
  const session = useDevelop((s) => s.session)
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
      {item.copyName && <span className="badge ghost">{item.copyName}</span>}
    </IdentityBar>
  )
}
