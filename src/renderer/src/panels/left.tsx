import { useState } from 'react'
import { usePresets } from '../lib/hooks'
import { applyGroups } from '../../../shared/recipe'
import { Section } from '../components/ui'
import { api, errorText } from '../lib/api'
import { useDevelop } from '../state/develop'
import { useLibrary } from '../state/library'

export function PresetsPanel(): React.JSX.Element | null {
  const recipe = useDevelop((s) => s.recipe)
  const replace = useDevelop((s) => s.replace)
  const setDialog = useLibrary((s) => s.setDialog)
  const [presets, reload] = usePresets(4000)
  const [hover, setHover] = useState<string | null>(null)
  if (!recipe) return null
  const groups = [...new Set(presets.map((p) => p.group))]
  return (
    <Section
      id="presets"
      title="Presets"
      right={<button onClick={() => setDialog('preset')}>+ Save</button>}
    >
      {groups.map((g) => (
        <div key={g} className="preset-group">
          <span className="group-label">{g}</span>
          {presets
            .filter((p) => p.group === g)
            .map((p) => (
              <div
                key={p.id}
                className={`preset ${hover === p.id ? 'hover' : ''}`}
                onMouseEnter={() => setHover(p.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() =>
                  replace(applyGroups(recipe, p.recipe, p.groups), `Preset: ${p.name}`)
                }
                title={`Carries: ${p.groups.join(', ')}`}
              >
                <span>{p.name}</span>
                {!p.builtin && (
                  <button
                    className="icon"
                    onClick={(e) => {
                      e.stopPropagation()
                      void api.presets.remove(p.id).then(reload)
                    }}
                  >
                    🗑
                  </button>
                )}
              </div>
            ))}
        </div>
      ))}
    </Section>
  )
}

export function SnapshotsPanel(): React.JSX.Element | null {
  const snapshots = useDevelop((s) => s.snapshots)
  const save = useDevelop((s) => s.saveSnapshot)
  const remove = useDevelop((s) => s.removeSnapshot)
  const replace = useDevelop((s) => s.replace)
  const [name, setName] = useState('')
  return (
    <Section id="snapshots" title="Snapshots" defaultOpen={false}>
      <div className="row">
        <input
          className="name"
          placeholder="Snapshot name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <button
          onClick={() => {
            void save(name.trim() || new Date().toLocaleString())
            setName('')
          }}
        >
          + Save
        </button>
      </div>
      {snapshots.map((s) => (
        <div
          key={s.id}
          className="preset"
          onClick={() => replace(structuredClone(s.recipe), `Snapshot: ${s.name}`)}
        >
          <span>{s.name}</span>
          <button
            className="icon"
            onClick={(e) => {
              e.stopPropagation()
              void remove(s.id)
            }}
          >
            🗑
          </button>
        </div>
      ))}
    </Section>
  )
}

export function HistoryPanel(): React.JSX.Element {
  const history = useDevelop((s) => s.history)
  const cursor = useDevelop((s) => s.cursor)
  const goto = useDevelop((s) => s.goto)
  return (
    <Section id="history" title="History" defaultOpen={false}>
      <div className="history">
        {[...history]
          .map((h, i) => ({ h, i }))
          .reverse()
          .map(({ h, i }) => (
            <div
              key={h.seq}
              className={`history-row ${i === cursor ? 'on' : ''} ${i > cursor ? 'future' : ''}`}
              onClick={() => goto(i)}
            >
              <span>{h.label}</span>
              <span className="muted small">{new Date(h.at).toLocaleTimeString()}</span>
            </div>
          ))}
      </div>
    </Section>
  )
}

function fmtShutter(t: number | null): string {
  if (!t) return '—'
  return t >= 1 ? `${t}s` : `1/${Math.round(1 / t)}s`
}

export function InfoPanel(): React.JSX.Element | null {
  const session = useDevelop((s) => s.session)
  if (!session) return null
  const { info, item } = session
  const c = item.camera
  return (
    <Section id="info" title="Info" defaultOpen={false}>
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
        onClick={() =>
          void api.app
            .reveal(item.path)
            .catch((e) => useLibrary.getState().say(errorText(e), 'error'))
        }
      >
        Show in folder
      </button>
    </Section>
  )
}
