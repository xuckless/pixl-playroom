import { useState } from 'react'
import { applyGroups } from '../../../shared/recipe'
import { Icon } from '../components/icons'
import { api, errorText } from '../lib/api'
import { usePresets } from '../lib/hooks'
import { useDevelop } from '../state/develop'
import { useLibrary } from '../state/library'

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
  const replace = useDevelop((s) => s.replace)
  const [presets, reload] = usePresets(4000)
  const [applied, setApplied] = useState<string | null>(null)
  if (!recipe) return <p className="rail-empty">Open a photo to use presets.</p>
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
                  onClick={() => {
                    setApplied(p.id)
                    replace(applyGroups(recipe, p.recipe, p.groups), `Preset: ${p.name}`)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      setApplied(p.id)
                      replace(applyGroups(recipe, p.recipe, p.groups), `Preset: ${p.name}`)
                    }
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

export function HistoryPane(): React.JSX.Element {
  const history = useDevelop((s) => s.history)
  const cursor = useDevelop((s) => s.cursor)
  const goto = useDevelop((s) => s.goto)
  if (history.length === 0) return <p className="rail-empty">Nothing has happened yet.</p>
  return (
    <div className="rail-list history">
      {[...history]
        .map((h, i) => ({ h, i }))
        .reverse()
        .map(({ h, i }) => (
          <div
            key={h.seq}
            role="button"
            tabIndex={0}
            className={`history-row rail-item${i === cursor ? ' on' : ''}${i > cursor ? ' future' : ''}`}
            onClick={() => goto(i)}
          >
            <span className="rail-label">
              <i className="dot" />
              {h.label}
            </span>
            <span className="t">
              {new Date(h.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        ))}
    </div>
  )
}

function fmtShutter(t: number | null): string {
  if (!t) return '—'
  return t >= 1 ? `${t}s` : `1/${Math.round(1 / t)}s`
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
    </div>
  )
}
