import { useEffect, useState } from 'react'
import { dependents, patchSummary, prerequisites, type Step } from '../../../shared/history'
import type { Preset, ProjectInfo } from '../../../shared/ipc'
import { applyGroups } from '../../../shared/recipe'
import { wbFromSaved } from '../../../shared/wbconvert'
import { Icon } from '../components/icons'
import { api, errorText } from '../lib/api'
import { usePresets } from '../lib/hooks'
import { useDevelop } from '../state/develop'
import { useLibrary } from '../state/library'
import { MetadataEditor } from '../views/library/MetadataEditor'

/**
 * The left rail's panes. Each shows one list at a time under the rail's
 * head; the head's actions come from the pane's `Actions` component.
 */

export function PresetsActions(): React.JSX.Element {
  const setDialog = useLibrary((s) => s.setDialog)
  return (
    <button className="sm ghost" onClick={() => setDialog('preset')} title="Save a preset">
      <Icon name="plus" />
      Save
    </button>
  )
}

export function PresetsPane(): React.JSX.Element | null {
  const recipe = useDevelop((s) => s.recipe)
  const session = useDevelop((s) => s.session)
  const replace = useDevelop((s) => s.replace)
  const [presets, reload] = usePresets(4000)
  const [applied, setApplied] = useState<string | null>(null)
  if (!recipe) return <p className="rail-empty">Open a photo to use presets.</p>
  const apply = (p: Preset): void => {
    setApplied(p.id)
    // A saved custom white balance is in the units of the photo it was made
    // on; on a photo of the other kind it goes through the engine's white.
    const from =
      p.wbOp && session ? { ...p.recipe, wb: wbFromSaved(p.recipe.wb, p.wbOp, session) } : p.recipe
    replace(applyGroups(recipe, from, p.groups), `Preset: ${p.name}`)
  }
  // Presets keep the groups they were saved under.
  const groups = [...new Set(presets.map((p) => p.group))]
  return (
    <div className="rail-list">
      {groups.map((g) => (
        <div key={g} className="preset-group">
          <div className="rail-group">
            <span className="micro">{g}</span>
            <span className="line" />
          </div>
          <div className="stagger">
            {presets
              .filter((p) => p.group === g)
              .map((p) => (
                <div
                  key={p.id}
                  role="button"
                  tabIndex={0}
                  className={`preset rail-item${applied === p.id ? ' on' : ''}`}
                  onClick={() => apply(p)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') apply(p)
                  }}
                  title={`Carries: ${p.groups.join(', ')}`}
                >
                  <span className="rail-label">
                    <i className="dot" />
                    {p.name}
                  </span>
                  {p.builtin ? (
                    <span className="t">{p.groups.length}</span>
                  ) : (
                    <button
                      className="icon sm"
                      title="Delete preset"
                      onClick={(e) => {
                        e.stopPropagation()
                        void api.presets.remove(p.id).then(reload)
                      }}
                    >
                      <Icon name="trash" />
                    </button>
                  )}
                </div>
              ))}
          </div>
        </div>
      ))}
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
          placeholder="Snapshot name"
          value={name}
          disabled={!session}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') add()
          }}
        />
        <button className="sm" disabled={!session} onClick={add} title="Save a snapshot">
          <Icon name="plus" />
          Save
        </button>
      </div>
      {snapshots.length === 0 && (
        <p className="rail-empty">A snapshot keeps the recipe as it is now, to come back to.</p>
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
              title="Delete snapshot"
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
  if (!base) return <p className="rail-empty">Nothing has happened yet.</p>
  const labelOf = (seq: number): string => steps.find((s) => s.seq === seq)?.label ?? ''
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
        <div className="history-ask" role="alertdialog" aria-label="Confirm">
          <p>
            {ask.kind === 'hide' ? 'Hiding' : 'Deleting'} “{labelOf(ask.seq)}” also{' '}
            {ask.kind === 'hide' ? 'hides' : 'deletes'} {ask.seqs.length - 1} later{' '}
            {ask.seqs.length === 2 ? 'step that uses' : 'steps that use'} what it made:
          </p>
          <ul>
            {ask.seqs.slice(1).map((seq) => (
              <li key={seq}>{labelOf(seq)}</li>
            ))}
          </ul>
          <div className="row">
            <button className={ask.kind === 'delete' ? 'danger' : 'primary'} onClick={confirm}>
              {ask.kind === 'hide' ? 'Hide' : 'Delete'} {ask.seqs.length} steps
            </button>
            <button className="ghost" onClick={() => setAsk(null)}>
              Cancel
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
                {step.label}
              </span>
              <span className="t">{clock(step.at)}</span>
              <button
                className="icon sm eye"
                title={step.hidden ? 'Show this step' : 'Hide this step'}
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
                title="Delete this step"
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
                {patchSummary(step.patch).join(' · ') || 'No visible change'}
                {step.hidden ? ' — hidden' : ''}
              </p>
            )}
          </div>
        )
      })}
      <div className="history-row rail-item base" title="Where the history starts">
        <span className="rail-label">
          <i className="dot" />
          {base.label}
        </span>
        <span className="t">{clock(base.at)}</span>
      </div>
    </div>
  )
}

function fmtShutter(t: number | null): string {
  if (!t) return '—'
  return t >= 1 ? `${t}s` : `1/${Math.round(1 / t)}s`
}

const ORIGINAL_KIND: Record<string, string> = {
  dng: 'lossless DNG',
  'jxl-jpeg': 'JPEG repacked in JPEG XL (bit-exact)',
  'jxl-lossless': 'lossless JPEG XL',
  verbatim: 'as it is'
}

/** The photo's project, and the copy of its original it carries. */
function ProjectRows({ sessionKey }: { sessionKey: string }): React.JSX.Element | null {
  const [info, setInfo] = useState<ProjectInfo | null>(null)
  useEffect(() => {
    let live = true
    const load = (): void =>
      void api.library
        .projectInfo(sessionKey)
        .then((i) => live && setInfo(i))
        .catch(() => undefined)
    load()
    // The original is embedded in the background: look again while it is.
    const t = setInterval(load, 4000)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [sessionKey])
  if (!info?.project) return null
  const original =
    info.state === 'ready'
      ? `${ORIGINAL_KIND[info.kind ?? ''] ?? info.kind}${
          info.bytes ? ` · ${(info.bytes / 1024 / 1024).toFixed(1)} MB` : ''
        }`
      : info.state === 'failed'
        ? 'could not be embedded'
        : 'being embedded…'
  return (
    <>
      <dt>Project</dt>
      <dd title={info.project}>
        <button
          className="link"
          onClick={() => void api.app.reveal(info.project!).catch(() => undefined)}
        >
          {info.project.split(/[\\/]/).pop()}
        </button>
      </dd>
      <dt>Original</dt>
      <dd>{original}</dd>
    </>
  )
}

export function InfoPane(): React.JSX.Element {
  const session = useDevelop((s) => s.session)
  if (!session) return <p className="rail-empty">Open a photo to see its details.</p>
  const { info, item } = session
  const c = item.camera
  return (
    <div className="rail-list">
      <dl className="kv">
        <dt>File</dt>
        <dd>{item.name}</dd>
        <dt>Format</dt>
        <dd>
          {info.format.toUpperCase()} · {info.bits}-bit · {info.channels} ch
        </dd>
        <dt>Pixels</dt>
        <dd>
          {session.frameWidth} × {session.frameHeight} (
          {((session.frameWidth * session.frameHeight) / 1e6).toFixed(1)} MP)
        </dd>
        <dt>Colour</dt>
        <dd>
          {info.color} ({info.color_source})
          {info.is_hdr ? ` · HDR${info.peak_nits ? ` ${info.peak_nits} nits` : ''}` : ''}
        </dd>
        {session.asShot && (
          <>
            <dt>As shot</dt>
            <dd>
              {Math.round(session.asShot.temperature_kelvin)} K, tint{' '}
              {(session.asShot.tint * 3000).toFixed(0)}
            </dd>
          </>
        )}
        <dt>Camera</dt>
        <dd>{[c.make, c.model].filter(Boolean).join(' ') || '—'}</dd>
        <dt>Lens</dt>
        <dd>{c.lens ?? '—'}</dd>
        <dt>Exposure</dt>
        <dd>
          {fmtShutter(c.exposureTime)} · f/{c.fNumber ?? '—'} · ISO {c.iso ?? '—'} ·{' '}
          {c.focalLength ? `${c.focalLength} mm` : '—'}
        </dd>
        <dt>Taken</dt>
        <dd>{c.capturedAt ? new Date(c.capturedAt).toLocaleString() : '—'}</dd>
        <dt>Proxy</dt>
        <dd>
          {session.proxyWidth} × {session.proxyHeight}
        </dd>
        <ProjectRows sessionKey={session.key} />
      </dl>
      <button
        className="sm"
        onClick={() =>
          void api.app
            .reveal(item.path)
            .catch((e) => useLibrary.getState().say(errorText(e), 'error'))
        }
      >
        <Icon name="folder" />
        Show in folder
      </button>
      <div className="rail-group">
        <span className="micro">Metadata</span>
        <span className="line" />
      </div>
      <MetadataEditor keys={[session.key]} facts={false} />
    </div>
  )
}
