import { useEffect, useState } from 'react'
import { rawColourLabel, rawColourReason } from '../../../shared/rawcolour'
import { dependents, patchSummary, prerequisites, type Step } from '../../../shared/history'
import type { Preset, ProjectInfo } from '../../../shared/ipc'
import { GROUP_LABELS } from '../../../shared/recipe'
import { LOOK_BY_ID, LOOKS } from '../../../shared/looks/catalog'
import { searchLooks } from '../../../shared/looks/search'
import { Icon } from '../components/icons'
import { Slider } from '../components/ui'
import { api, errorText } from '../lib/api'
import {
  applyToPhoto,
  cancelLookRun,
  commitLookAmount,
  hoverLook,
  leaveLook,
  removeLook,
  setLookAmount,
  useApplied,
  useLookHoverCleanup
} from '../lib/applyLook'
import { presetsChanged } from '../lib/hooks'
import { useDevelop } from '../state/develop'
import { useLibrary } from '../state/library'
import { useLooks } from '../state/looks'
import { useAiJobs } from '../state/jobs'
import { formatEta, runProgress, runRemaining } from '../../../shared/looks/run'
import { MetadataEditor } from '../views/library/MetadataEditor'
import { useMaskPresets, useSelectedMask } from './masks/presets'
import { TechInfo } from '../components/TechInfo'
import { useReorder } from './masks/useReorder'
import { t, tk, tp } from '../lib/i18n'

/**
 * The left rail's panes. Each shows one list at a time under the rail's
 * head; the head's actions come from the pane's `Actions` component.
 */

export function PresetsActions(): React.JSX.Element {
  const setDialog = useLibrary((s) => s.setDialog)
  const hasPhoto = useDevelop((s) => s.session !== null)
  return (
    <span className="rail-actions">
      <button
        className="sm ghost"
        disabled={!hasPhoto}
        onClick={() => openLooks()}
        title={t('Browse every look, on this photo')}
      >
        <Icon name="search" />
        {t('Browse')}
      </button>
      <button className="sm ghost" onClick={() => setDialog('preset')} title={t('Save a preset')}>
        <Icon name="plus" />
        {t('Save')}
      </button>
    </span>
  )
}

/** The Looks browser, searching for `query` when one is given. */
function openLooks(query = ''): void {
  useLooks.setState({ browseQuery: query })
  useLibrary.getState().setDialog('looks')
}

export function PresetsPane(): React.JSX.Element | null {
  const recipe = useDevelop((s) => s.recipe)
  const mine = useLooks((s) => s.mine)
  const user = useLooks((s) => s.user)
  const applied = useApplied()
  const [query, setQuery] = useState('')
  useEffect(() => {
    if (useLooks.getState().mine === null) void useLooks.getState().load()
  }, [])
  useLookHoverCleanup()
  const myLooks = (mine ?? []).flatMap((id) => LOOK_BY_ID.get(id) ?? [])
  const reorder = useReorder((from, to) => useLooks.getState().move(myLooks[from].id, to))
  if (!recipe) return <p className="rail-empty">{t('Open a photo to use presets.')}</p>
  // Alt (Option) puts a look on top of the applied one instead of in its place.
  const apply = (p: Preset, stack: boolean): void => {
    leaveLook(true)
    void applyToPhoto(p, { stack })
  }
  const q = query.trim()
  const shownMine = q ? searchLooks(myLooks, q) : myLooks
  const shownUser = q ? searchLooks(user, q) : user
  // While searching, the rest of the catalog answers too, ready to add.
  const found = q
    ? searchLooks(LOOKS, q, {})
        .filter((l) => !(mine ?? []).includes(l.id))
        .slice(0, CATALOG_HITS)
    : []
  // Saved presets keep the groups they were saved under.
  const userGroups = [...new Set(shownUser.map((p) => p.group))]
  const row = (
    p: Preset,
    action: React.ReactNode,
    order?: { index: number }
  ): React.JSX.Element => {
    const offset = order ? reorder.offset(order.index) : 0
    const dragging = order !== undefined && reorder.drag?.from === order.index
    return (
      <div
        key={p.id}
        role="button"
        tabIndex={0}
        data-reorder={order ? '' : undefined}
        className={`preset rail-item${applied?.lookId === p.id ? ' on' : ''}${dragging ? ' dragging' : ''}`}
        style={offset ? { transform: `translateY(${offset}px)` } : undefined}
        onClick={(e) => apply(p, e.altKey)}
        onMouseEnter={(e) => {
          if (!reorder.drag) hoverLook(p, e.altKey)
        }}
        onMouseLeave={() => leaveLook()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') apply(p, e.altKey)
        }}
        title={describe(p)}
      >
        <span className="rail-label">
          {order ? (
            <span
              className="rail-grip"
              title={t('Drag to reorder')}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => {
                leaveLook(true)
                reorder.start(e, order.index)
              }}
            >
              <Icon name="grip" />
            </span>
          ) : (
            <i className="dot" />
          )}
          {p.name}
        </span>
        {action}
      </div>
    )
  }
  const nothing = q && shownMine.length + shownUser.length + found.length === 0
  return (
    <div className="rail-list">
      <label className="search-field rail-search">
        <Icon name="search" />
        <input
          className="search"
          placeholder={t('Search looks · Enter to browse')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Escape') setQuery('')
            if (e.key === 'Enter') openLooks(query.trim())
          }}
        />
      </label>
      {applied && <AppliedLookBar />}
      <MaskPresetsGroup />
      {shownMine.length > 0 && (
        <Group label={t('My Looks')}>
          {shownMine.map((p, i) =>
            row(
              p,
              <button
                className="icon sm"
                title={t('Remove from My Looks')}
                onClick={(e) => {
                  e.stopPropagation()
                  useLooks.getState().remove(p.id)
                }}
              >
                <Icon name="minus" />
              </button>,
              // Reordered by dragging, while the whole list shows.
              q ? undefined : { index: i }
            )
          )}
        </Group>
      )}
      {userGroups.map((g) => (
        <Group key={g} label={g}>
          {shownUser
            .filter((p) => p.group === g)
            .map((p) =>
              row(
                p,
                <button
                  className="icon sm"
                  title={t('Delete preset')}
                  onClick={(e) => {
                    e.stopPropagation()
                    void api.presets.remove(p.id).then(presetsChanged)
                  }}
                >
                  <Icon name="trash" />
                </button>
              )
            )}
        </Group>
      ))}
      {found.length > 0 && (
        <Group label={t('From the catalog')}>
          {found.map((p) =>
            row(
              p,
              <button
                className="icon sm"
                title={t('Add to My Looks')}
                onClick={(e) => {
                  e.stopPropagation()
                  useLooks.getState().add(p.id)
                }}
              >
                <Icon name="plus" />
              </button>
            )
          )}
        </Group>
      )}
      {nothing && <p className="rail-empty">{t('No look matches “{{query}}”.', { query: q })}</p>}
      {!q && mine !== null && myLooks.length === 0 && user.length === 0 && (
        <p className="rail-empty">
          {t('No looks kept yet. Search above to find one in the catalog and add it.')}
        </p>
      )}
    </div>
  )
}

/**
 * The look applied last, at the top of the rail while its step is the
 * newest: its Amount, taking it off, or keeping it as it is (the next look
 * then goes on top of it).
 */
function AppliedLookBar(): React.JSX.Element | null {
  const applied = useApplied()
  if (!applied) return null
  return (
    <div className="applied-look">
      <div className="applied-look-head">
        <strong title={t('Applied: {{look}}', { look: applied.label })}>{applied.name}</strong>
        <button className="icon sm" title={t('Take the look off')} onClick={removeLook}>
          <Icon name="reset" />
        </button>
        <button
          className="icon sm"
          title={t('Keep it as it is: the next look goes on top')}
          onClick={() => useLooks.setState({ applied: null })}
        >
          <Icon name="check" />
        </button>
      </div>
      <Slider
        label={t('Amount')}
        value={applied.amount}
        min={0}
        max={100}
        def={100}
        format={(v) => `${Math.round(v)}%`}
        onChange={(v, live) => setLookAmount(Math.round(v), live)}
        onCommit={commitLookAmount}
      />
      {applied.runId && <LookRunProgress runId={applied.runId} />}
    </div>
  )
}

/** A smart look's model work under way: one bar for all its parts, what it is on, time left. */
function LookRunProgress({ runId }: { runId: string }): React.JSX.Element | null {
  const run = useLooks((s) => s.runs[runId])
  // The model job under way, if one is: its own progress moves the bar between parts.
  const job = useAiJobs((s) =>
    Object.values(s.jobs).find((j) => j.group === runId && j.phase === 'running')
  )
  if (!run) return null
  const p = run.phase === 'running' ? (job?.progress ?? 0) : 0
  const done = runProgress(run.parts, run.index, p)
  const left = runRemaining(run.parts, run.index, p)
  // The English label names what to point at; another language's shows as it is.
  const target = run.label.match(/^Pointing at the (.+)$/)?.[1]
  return (
    <div className="look-run" title={run.parts.map((x) => x.label).join(' → ')}>
      <div className="look-run-bar">
        <i style={{ width: `${Math.round(done * 100)}%` }} />
      </div>
      <div className="look-run-text">
        <span>
          {run.phase === 'pick' && target
            ? t('Point at the {{target}} on the photo', { target })
            : run.label}
        </span>
        {run.phase === 'running' && <span className="t">{formatEta(left)}</span>}
        <button className="sm ghost" onClick={cancelLookRun} title={t("Stop the look's AI work")}>
          {t('Cancel')}
        </button>
      </div>
    </div>
  )
}

/** How many catalog looks a rail search lists beside the user's own. */
const CATALOG_HITS = 30

/** A row's tooltip: what the look is like and what inspired it, or what a preset carries. */
function describe(p: Preset): string {
  if (!p.meta) {
    const makes = p.smart
      ? [
          ...p.smart.masks.map((m) => t('{{name}} mask', { name: m.name })),
          ...p.smart.steps.map((x) => (x.kind === 'denoise' ? t('AI denoise') : t('AI deblur')))
        ]
      : []
    return [
      p.groups.length
        ? t('Carries: {{groups}}', { groups: p.groups.map((g) => t(GROUP_LABELS[g])).join(', ') })
        : '',
      makes.length ? t('Makes on each photo: {{makes}}', { makes: makes.join(', ') }) : ''
    ]
      .filter(Boolean)
      .join('\n')
  }
  return [p.meta.description, p.meta.inspiredBy && t('Inspired by {{who}}', { who: p.meta.inspiredBy })]
    .filter(Boolean)
    .join('\n')
}

function Group({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="preset-group">
      <div className="rail-group">
        <span className="micro">{label}</span>
        <span className="line" />
      </div>
      <div className="stagger">{children}</div>
    </div>
  )
}

/**
 * While a mask is selected, its own presets head the list: a mask's sliders
 * and Amount saved under a name, applied to whichever mask is selected.
 */
function MaskPresetsGroup(): React.JSX.Element | null {
  const layer = useSelectedMask()
  const { presets, save, apply, remove } = useMaskPresets()
  const [naming, setNaming] = useState<string | null>(null)
  if (!layer) return null
  const finish = (): void => {
    const name = naming?.trim()
    if (name) void save(layer, name)
    setNaming(null)
  }
  return (
    <div className="preset-group">
      <div className="rail-group">
        <span className="micro">
          {t('Mask')} · {layer.name}
        </span>
        <span className="line" />
      </div>
      <div className="stagger">
        {presets.map((p) => (
          <div
            key={p.name}
            role="button"
            tabIndex={0}
            className="preset rail-item"
            onClick={() => apply(layer, p)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') apply(layer, p)
            }}
            title={t('Apply to {{mask}}', { mask: layer.name })}
          >
            <span className="rail-label">
              <i className="dot" />
              {p.name}
            </span>
            <button
              className="icon sm"
              title={t('Delete mask preset')}
              onClick={(e) => {
                e.stopPropagation()
                void remove(p.name)
              }}
            >
              <Icon name="trash" />
            </button>
          </div>
        ))}
        {naming === null ? (
          <div
            role="button"
            tabIndex={0}
            className="preset rail-item muted"
            onClick={() => setNaming('')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setNaming('')
            }}
          >
            <span className="rail-label">
              <Icon name="plus" />
              {t("Save this mask's settings…")}
            </span>
          </div>
        ) : (
          <div className="rail-form">
            <input
              className="name"
              autoFocus
              placeholder={t('Mask preset name')}
              value={naming}
              onChange={(e) => setNaming(e.target.value)}
              onBlur={finish}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') finish()
                if (e.key === 'Escape') setNaming(null)
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

export function SnapshotsPane(): React.JSX.Element {
  const snapshots = useDevelop((s) => s.snapshots)
  const save = useDevelop((s) => s.saveSnapshot)
  const remove = useDevelop((s) => s.removeSnapshot)
  const replace = useDevelop((s) => s.replace)
  const session = useDevelop((s) => s.session)
  const [name, setName] = useState('')
  const add = (): void => {
    void save(name.trim() || new Date().toLocaleString())
    setName('')
  }
  return (
    <div className="rail-list">
      <div className="rail-form">
        <input
          className="name"
          placeholder={t('Snapshot name')}
          value={name}
          disabled={!session}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') add()
          }}
        />
        <button className="sm" disabled={!session} onClick={add} title={t('Save a snapshot')}>
          <Icon name="plus" />
          {t('Save')}
        </button>
      </div>
      {snapshots.length === 0 && (
        <p className="rail-empty">
          {t('A snapshot keeps the recipe as it is now, to come back to.')}
        </p>
      )}
      <div className="stagger">
        {snapshots.map((s) => (
          <div
            key={s.id}
            role="button"
            tabIndex={0}
            className="preset rail-item"
            onClick={() => replace(structuredClone(s.recipe), `Snapshot: ${s.name}`)}
            title={new Date(s.at).toLocaleString()}
          >
            <span className="rail-label">
              <i className="dot" />
              {s.name}
            </span>
            <button
              className="icon sm"
              title={t('Delete snapshot')}
              onClick={(e) => {
                e.stopPropagation()
                void remove(s.id)
              }}
            >
              <Icon name="trash" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

const clock = (at: string): string =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** A hide or delete that takes later steps with it, waiting for a yes. */
interface Cascade {
  kind: 'hide' | 'delete'
  seq: number
  /** The step and its dependents. */
  seqs: number[]
}

/**
 * The edit history as steps, newest first. Every step can be hidden (the
 * photo shows without it; the eye), shown again, or deleted. A step that made
 * a mask takes the later steps that use that mask with it, after asking.
 * Selecting a step shows what it changed.
 */
export function HistoryPane(): React.JSX.Element {
  const history = useDevelop((s) => s.history)
  const setStepsHidden = useDevelop((s) => s.setStepsHidden)
  const deleteSteps = useDevelop((s) => s.deleteSteps)
  const [selected, setSelected] = useState<number | null>(null)
  const [ask, setAsk] = useState<Cascade | null>(null)
  const { base, steps } = history
  if (!base) return <p className="rail-empty">{t('Nothing has happened yet.')}</p>
  const labelOf = (seq: number): string => t(steps.find((s) => s.seq === seq)?.label ?? '')
  const toggle = (step: Step): void => {
    setAsk(null)
    if (step.hidden) {
      void setStepsHidden([step.seq, ...prerequisites(steps, step.seq)], false)
      return
    }
    const deps = dependents(steps, step.seq, (s) => !s.hidden)
    if (deps.length > 0) setAsk({ kind: 'hide', seq: step.seq, seqs: [step.seq, ...deps] })
    else void setStepsHidden([step.seq], true)
  }
  const remove = (step: Step): void => {
    setAsk(null)
    const deps = dependents(steps, step.seq)
    if (deps.length > 0) setAsk({ kind: 'delete', seq: step.seq, seqs: [step.seq, ...deps] })
    else void deleteSteps([step.seq])
  }
  const confirm = (): void => {
    if (!ask) return
    setAsk(null)
    if (ask.kind === 'hide') void setStepsHidden(ask.seqs, true)
    else void deleteSteps(ask.seqs)
  }
  return (
    <div className="rail-list history">
      {ask && (
        <div className="history-ask" role="alertdialog" aria-label={t('Confirm')}>
          <p>
            {ask.kind === 'hide'
              ? tp(
                  'Hiding “{{step}}” also hides {{count}} later step that uses what it made:',
                  'Hiding “{{step}}” also hides {{count}} later steps that use what it made:',
                  ask.seqs.length - 1,
                  { step: labelOf(ask.seq) }
                )
              : tp(
                  'Deleting “{{step}}” also deletes {{count}} later step that uses what it made:',
                  'Deleting “{{step}}” also deletes {{count}} later steps that use what it made:',
                  ask.seqs.length - 1,
                  { step: labelOf(ask.seq) }
                )}
          </p>
          <ul>
            {ask.seqs.slice(1).map((seq) => (
              <li key={seq}>{labelOf(seq)}</li>
            ))}
          </ul>
          <div className="row">
            <button className={ask.kind === 'delete' ? 'danger' : 'primary'} onClick={confirm}>
              {ask.kind === 'hide'
                ? tp('Hide {{count}} step', 'Hide {{count}} steps', ask.seqs.length)
                : tp('Delete {{count}} step', 'Delete {{count}} steps', ask.seqs.length)}
            </button>
            <button className="ghost" onClick={() => setAsk(null)}>
              {t('Cancel')}
            </button>
          </div>
        </div>
      )}
      {[...steps].reverse().map((step) => {
        const on = selected === step.seq
        const pick = (): void => setSelected(on ? null : step.seq)
        return (
          <div key={step.seq} className="history-step">
            <div
              role="button"
              tabIndex={0}
              aria-expanded={on}
              className={`history-row rail-item${on ? ' on' : ''}${step.hidden ? ' hidden' : ''}`}
              onClick={pick}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  pick()
                }
              }}
            >
              <span className="rail-label">
                <i className="dot" />
                {t(step.label)}
              </span>
              <span className="t">{clock(step.at)}</span>
              <button
                className="icon sm eye"
                title={step.hidden ? t('Show this step') : t('Hide this step')}
                aria-pressed={!step.hidden}
                onClick={(e) => {
                  e.stopPropagation()
                  toggle(step)
                }}
              >
                <Icon name={step.hidden ? 'eyeOff' : 'eye'} />
              </button>
              <button
                className="icon sm"
                title={t('Delete this step')}
                onClick={(e) => {
                  e.stopPropagation()
                  remove(step)
                }}
              >
                <Icon name="trash" />
              </button>
            </div>
            {on && (
              <p className="history-changed">
                {patchSummary(step.patch).join(' · ') || t('No visible change')}
                {step.hidden ? ` — ${t('hidden')}` : ''}
              </p>
            )}
          </div>
        )
      })}
      <div className="history-row rail-item base" title={t('Where the history starts')}>
        <span className="rail-label">
          <i className="dot" />
          {t(base.label)}
        </span>
        <span className="t">{clock(base.at)}</span>
      </div>
    </div>
  )
}

function fmtShutter(secs: number | null): string {
  if (!secs) return '—'
  return secs >= 1 ? `${secs}s` : `1/${Math.round(1 / secs)}s`
}

const ORIGINAL_KIND: Record<string, string> = {
  dng: tk('lossless DNG'),
  'jxl-jpeg': tk('JPEG repacked in JPEG XL (bit-exact)'),
  'jxl-lossless': tk('lossless JPEG XL'),
  verbatim: tk('as it is')
}

/** The photo's project, and the copy of its original it carries. */
function ProjectRows({ sessionKey }: { sessionKey: string }): React.JSX.Element | null {
  const [info, setInfo] = useState<ProjectInfo | null>(null)
  // A first edit makes the project: looked at again as the history grows.
  const steps = useDevelop((s) => s.history.steps.length)
  useEffect(() => {
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = (): void =>
      void api.library
        .projectInfo(sessionKey)
        .then((i) => {
          if (!live) return
          setInfo(i)
          // The original is embedded in the background: look again only while it is.
          if (i.project && i.state !== 'ready' && i.state !== 'failed') timer = setTimeout(load, 4000)
        })
        .catch(() => undefined)
    load()
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [sessionKey, steps])
  if (!info?.project) return null
  const original =
    info.state === 'ready'
      ? `${ORIGINAL_KIND[info.kind ?? ''] ? t(ORIGINAL_KIND[info.kind ?? '']) : info.kind}${
          info.bytes ? ` · ${(info.bytes / 1024 / 1024).toFixed(1)} MB` : ''
        }`
      : info.state === 'failed'
        ? t('could not be embedded')
        : t('being embedded…')
  return (
    <>
      <dt>{t('Project')}</dt>
      <dd title={info.project}>
        <button
          className="link"
          onClick={() => void api.app.reveal(info.project!).catch(() => undefined)}
        >
          {info.project.split(/[\\/]/).pop()}
        </button>
      </dd>
      <dt>{t('Original')}</dt>
      <dd>{original}</dd>
    </>
  )
}

export function InfoPane(): React.JSX.Element {
  const session = useDevelop((s) => s.shown)
  if (!session) return <p className="rail-empty">{t('Open a photo to see its details.')}</p>
  const { info, item } = session
  const c = item.camera
  return (
    <div className="rail-list">
      <dl className="kv">
        <dt>{t('File')}</dt>
        <dd>{item.name}</dd>
        <dt>{t('Format')}</dt>
        <dd>
          {info.format.toUpperCase()} · {t('{{bits}}-bit', { bits: info.bits })}
        </dd>
        <dt>{t('Pixels')}</dt>
        <dd>
          {session.frameWidth} × {session.frameHeight} (
          {((session.frameWidth * session.frameHeight) / 1e6).toFixed(1)} MP)
        </dd>
        <dt>{t('Colour')}</dt>
        <dd>
          {info.color}
          {info.is_hdr ? ` · HDR${info.peak_nits ? ` ${info.peak_nits} nits` : ''}` : ''}
        </dd>
        {session.asShot && (
          <>
            <dt>{t('As shot')}</dt>
            <dd>
              {t('{{kelvin}} K, tint {{tint}}', {
                kelvin: Math.round(session.asShot.temperature_kelvin),
                tint: (session.asShot.tint * 3000).toFixed(0)
              })}
            </dd>
          </>
        )}
        <dt>{t('Camera')}</dt>
        <dd>{[c.make, c.model].filter(Boolean).join(' ') || '—'}</dd>
        {session.rawColour && (
          <>
            <dt>{t('Camera colour')}</dt>
            <dd title={rawColourReason(info) ?? undefined}>
              {rawColourLabel(info, session.rawColour)}
              {session.rawColour === 'container' && rawColourReason(info) ? ' *' : ''}
            </dd>
          </>
        )}
        <dt>{t('Lens')}</dt>
        <dd>{c.lens ?? '—'}</dd>
        <dt>{t('Exposure')}</dt>
        <dd>
          {fmtShutter(c.exposureTime)} · f/{c.fNumber ?? '—'} · ISO {c.iso ?? '—'} ·{' '}
          {c.focalLength ? `${c.focalLength} mm` : '—'}
        </dd>
        <dt>{t('Taken')}</dt>
        <dd>{c.capturedAt ? new Date(c.capturedAt).toLocaleString() : '—'}</dd>
        <ProjectRows sessionKey={session.key} />
      </dl>
      <div className="row">
        <button
          className="sm"
          onClick={() =>
            void api.app
              .reveal(item.path)
              .catch((e) => useLibrary.getState().say(errorText(e), 'error'))
          }
        >
          <Icon name="folder" />
          {t('Show in folder')}
        </button>
        <span className="spacer" />
        <TechInfo title={t('File details')}>
          <p>
            {tp('{{count}} channel · colour from {{source}}', '{{count}} channels · colour from {{source}}', info.channels, {
              source: info.color_source
            })}
          </p>
          <p>
            {t('Working copy {{width}} × {{height}}', {
              width: session.proxyWidth,
              height: session.proxyHeight
            })}
          </p>
        </TechInfo>
      </div>
      <div className="rail-group">
        <span className="micro">{t('Metadata')}</span>
        <span className="line" />
      </div>
      <MetadataEditor keys={[session.key]} facts={false} />
    </div>
  )
}
