import { useRef, useState, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Icon } from '../components/icons'
import { Mark } from '../components/Mark'
import { Popover } from '../components/Popover'
import { Spinner } from '../fx'
import { activities, activitySummary, overall, type Activity } from '../lib/activity'
import { api } from '../lib/api'
import { useModels } from '../lib/models'
import { useBusy } from '../state/busy'
import { liveJobs, useAiJobs } from '../state/jobs'
import { useDevelop } from '../state/develop'
import { useLibrary } from '../state/library'
import { t, tk } from '../lib/i18n'
import { WindowMenus } from './WindowMenus'
import type { EngineStatus as EngineState } from '../../../shared/ipc'

/** The engine's state, as the top bar says it ("offline" while resting). */
const ENGINE_SAYS: Record<EngineState['status'], string> = {
  starting: tk('Engine starting'),
  ready: tk('Engine ready'),
  resting: tk('Engine offline'),
  unavailable: tk('Engine unavailable'),
  crashed: tk('Engine crashed')
}

/** The engine's state as a breathing dot; the last render's time on hover. */
export function EngineStatus(): React.JSX.Element {
  const engine = useLibrary((s) => s.engine)
  const ms = useDevelop((s) => (s.session ? (s.report?.totalMs ?? null) : null))
  const rendering = useDevelop((s) => s.rendering && s.session !== null)
  const status = engine?.status ?? 'starting'
  const ok = status === 'ready'
  // Let go while Playroom is behind (the safe-shutdown rest): yellow, not an error.
  const resting = status === 'resting'
  const tone = ok ? 'ok' : resting ? 'rest' : 'bad'
  return (
    <span
      className={`engine-status micro ${tone}`}
      title={
        resting
          ? t(
              'Resting while Playroom is in the background, to spare the battery and memory. It starts again with the next thing you do.'
            )
          : (engine?.reason ?? (ok && ms !== null ? t('Last render {{ms}} ms', { ms }) : ''))
      }
    >
      <i className={`status-dot${rendering ? ' busy' : ''}${ok ? '' : ` ${tone}`}`} />
      {t(ENGINE_SAYS[status])}
    </span>
  )
}

/** Go to an AI job's photo, in Develop. */
function goTo(key: string): void {
  const lib = useLibrary.getState()
  lib.setFocus(key)
  lib.setView('develop')
  void useDevelop.getState().open(key)
}

function stop(a: Activity): void {
  if (!a.stop) return
  if ('ai' in a.stop) void api.ai.cancel(a.stop.ai)
  else a.stop.job()
}

/**
 * In the top bar, the aperture: spinning while how far is unknown, its ring
 * filling once known. In the queue, a slim bar (sweeping while unknown).
 */
function ActivityMeter({
  progress,
  inList = false
}: {
  progress: number | null
  inList?: boolean
}): React.JSX.Element {
  if (!inList) return <Spinner size={16} progress={progress} />
  return (
    <span className={`activity-track${progress === null ? ' sweep' : ''}`} aria-hidden>
      <i style={progress === null ? undefined : { width: `${Math.round(progress * 100)}%` }} />
    </span>
  )
}

/**
 * Work running in the background (lib/activity.ts), never in the way: the
 * aperture and what runs first; hover names everything that
 * runs and how far, and a click opens the queue, where each piece goes to its
 * photo or stops.
 */
export function BackgroundJobs(): React.JSX.Element | null {
  const jobs = useBusy(useShallow((s) => s.jobs.filter((j) => j.scope === 'global')))
  const ai = useAiJobs(useShallow((s) => liveJobs(s.jobs)))
  const models = useModels()
  const shownKey = useDevelop((s) => s.session?.key ?? null)
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const list = activities(ai, jobs, models)
  if (list.length === 0) return null
  const first = list[0]
  const progress = list.length === 1 ? first.progress : overall(list)
  const pct = progress === null ? null : Math.round(progress * 100)
  return (
    <span className="bg-jobs micro">
      <button
        ref={anchor}
        className={`bg-job-link${open ? ' on' : ''}`}
        title={activitySummary(list)}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <ActivityMeter progress={progress} />
        <span className="bg-job-title">{first.title}</span>
        {pct !== null && <span className="t-num">{pct}%</span>}
        {list.length > 1 && <span className="t-num muted">+{list.length - 1}</span>}
      </button>
      {open && (
        <Popover
          className="activity-pop"
          anchor={anchor}
          align="right"
          onClose={() => setOpen(false)}
        >
          <ul className="activity-list">
            {list.map((a) => (
              <li key={a.id} className={a.queued ? 'queued' : ''}>
                <span className="activity-what">
                  {a.key ? (
                    <button
                      className="bg-job-link"
                      title={a.key === shownKey ? a.name : t('Go to {{name}}', { name: a.name })}
                      onClick={() => {
                        setOpen(false)
                        goTo(a.key as string)
                      }}
                    >
                      {a.title}
                      {a.name ? ` · ${a.name}` : ''}
                    </button>
                  ) : (
                    <span>
                      {a.title}
                      {a.name ? ` · ${a.name}` : ''}
                    </span>
                  )}
                  <span className="t-num muted">
                    {a.queued
                      ? t('Queued')
                      : a.progress === null
                        ? ''
                        : `${Math.round(a.progress * 100)}%`}
                  </span>
                  {a.stop && (
                    <button className="icon sm" title={t('Stop')} onClick={() => stop(a)}>
                      <Icon name="close" />
                    </button>
                  )}
                </span>
                {!a.queued && <ActivityMeter progress={a.progress} inList />}
              </li>
            ))}
          </ul>
        </Popover>
      )}
    </span>
  )
}

/** Settings, in reach on every platform (Windows has no app menu to hold it). */
function SettingsButton(): React.JSX.Element {
  const setDialog = useLibrary((s) => s.setDialog)
  const mac = /Mac/.test(navigator.platform)
  return (
    <button
      className="icon ghost settings-button"
      title={t('Settings ({{key}})', { key: mac ? '⌘,' : 'Ctrl+,' })}
      aria-label={t('Settings')}
      onClick={() => setDialog('preferences')}
    >
      <Icon name="settings" />
    </button>
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
      <WindowMenus />
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
      <SettingsButton />
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
          {info.color} · {t('{{bits}}-bit', { bits: info.bits })}
          {info.is_hdr ? ' · HDR' : ''}
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
                ? t('Edited as HDR: the rendition its gain map lifts it to')
                : t('An SDR picture with a gain map: edit it as HDR from the toolbar')
              : t('An HDR (PQ/HLG) photo')
          }
        >
          HDR{info.gain_map ? (session.isHdr ? '' : ` · ${t('map')}`) : ''}
        </span>
      )}
      {item.copyName && <span className="badge ghost">{item.copyName}</span>}
    </IdentityBar>
  )
}
