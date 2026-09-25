import { useMemo, useState } from 'react'
import { compile, orientedFrame } from '../../../shared/compile'
import type { GradeLayer } from '../../../shared/engine-types'
import { newId } from '../../../shared/recipe'
import { Section, ToolPanel } from '../components/ui'
import { useDevelop } from '../state/develop'

const TEMPLATE: GradeLayer = {
  name: 'custom',
  enabled: true,
  opacity: 1,
  mask: null,
  blend: { mode: 'Normal', space: 'LinearWorking' },
  stages: [
    {
      space: {
        Encoded: { space: 'Srgb', intent: 'RelativeColorimetric', black_point_compensation: false }
      },
      ops: [
        {
          Cdl: {
            slope: { r: 1.05, g: 1, b: 0.95 },
            offset: { r: 0, g: 0, b: 0.01 },
            power: { r: 1, g: 1, b: 1 },
            saturation: 1
          }
        }
      ]
    }
  ]
}

function CustomLayers(): React.JSX.Element | null {
  const recipe = useDevelop((s) => s.recipe)
  const edit = useDevelop((s) => s.edit)
  const commit = useDevelop((s) => s.commit)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [bad, setBad] = useState<Record<string, string>>({})
  if (!recipe) return null
  return (
    <div className="custom-layers">
      <p className="muted small">
        Layers in the engine&apos;s own terms (a <code>GradeLayer</code> as JSON: stages in any
        space, any op — CDL, qualifiers, LUTs, blend modes). They run after the panels and masks.
        The engine names the field when one is wrong.
      </p>
      {recipe.custom.map((c, i) => {
        const text = draft[c.id] ?? JSON.stringify(c.layer, null, 2)
        return (
          <div key={c.id} className="custom-layer">
            <div className="row between">
              <label className="check">
                <input
                  type="checkbox"
                  checked={c.enabled}
                  onChange={(e) => {
                    edit((r) => (r.custom[i].enabled = e.target.checked))
                    commit('Toggle custom layer')
                  }}
                />
                {c.name}
              </label>
              <span>
                <button
                  onClick={() => {
                    try {
                      const layer = JSON.parse(text) as GradeLayer
                      edit((r) => {
                        r.custom[i].layer = layer
                        r.custom[i].name = layer.name || c.name
                      })
                      commit('Edit custom layer')
                      setBad((b) => ({ ...b, [c.id]: '' }))
                      setDraft((d) => {
                        const n = { ...d }
                        delete n[c.id]
                        return n
                      })
                    } catch (err) {
                      setBad((b) => ({ ...b, [c.id]: (err as Error).message }))
                    }
                  }}
                >
                  Apply
                </button>
                <button
                  className="icon"
                  onClick={() => {
                    edit((r) => r.custom.splice(i, 1))
                    commit('Remove custom layer')
                  }}
                >
                  🗑
                </button>
              </span>
            </div>
            <textarea
              spellCheck={false}
              value={text}
              rows={Math.min(24, text.split('\n').length + 1)}
              onChange={(e) => setDraft((d) => ({ ...d, [c.id]: e.target.value }))}
              onKeyDown={(e) => e.stopPropagation()}
            />
            {bad[c.id] && <p className="error small">{bad[c.id]}</p>}
          </div>
        )
      })}
      <button
        onClick={() => {
          edit((r) =>
            r.custom.push({
              id: newId(),
              name: 'custom',
              enabled: true,
              layer: structuredClone(TEMPLATE)
            })
          )
          commit('Add custom layer')
        }}
      >
        + Custom layer
      </button>
    </div>
  )
}

export function AdvancedPanel(): React.JSX.Element | null {
  const session = useDevelop((s) => s.session)
  const recipe = useDevelop((s) => s.recipe)
  const report = useDevelop((s) => s.report)
  const [show, setShow] = useState(false)
  const compiled = useMemo(() => {
    if (!session || !recipe || !show) return null
    const { user } = orientedFrame(recipe, session.frameWidth, session.frameHeight)
    void user
    return compile(recipe, {
      isRaw: session.isRaw,
      asShot: session.asShot,
      sourceOrientation: 'Normal',
      frameWidth: session.frameWidth,
      frameHeight: session.frameHeight,
      scale: 1,
      seed: session.seed,
      brushPaths: Object.fromEntries(
        recipe.layers.flatMap((l) =>
          l.components.filter((c) => c.kind === 'brush').map((c) => [c.id, `<brush ${c.id}>`])
        )
      ),
      applyCrop: true
    })
  }, [session, recipe, show])
  if (!session || !recipe) return null
  return (
    <ToolPanel>
      {report && (
        <Section id="advanced.report" title="Last render">
          <div className="muted small">
            {report.totalMs} ms · decode {report.decodeMs} · colour {report.colorMs} · encode{' '}
            {report.encodeMs}
          </div>
          <div className="muted small">
            out: {report.colorSpace} · {report.loss.source_bits}→{report.loss.output_bits} bits ·{' '}
            {report.loss.quantisations} rounding{report.loss.quantisations === 1 ? '' : 's'}
            {report.loss.single_float_pass ? ', one float pass' : ''}
            {report.clampedSamples > 0 ? ` · ${report.clampedSamples} samples clamped` : ''}
          </div>
          {report.notes.map((n) => (
            <p key={n} className="note small">
              {n}
            </p>
          ))}
          <pre className="report-lines">
            {report.gradeLines.join('\n') || 'no grade — the fast path'}
          </pre>
        </Section>
      )}
      <Section id="advanced.custom" title="Custom layers">
        <CustomLayers />
      </Section>
      <Section
        id="advanced.compiled"
        title="Compiled grade"
        right={
          <button className="sm" onClick={() => setShow(!show)}>
            {show ? 'Hide' : 'Show'}
          </button>
        }
      >
        <p className="muted small">What an export at full resolution sends to the engine.</p>
        {compiled && (
          <>
            <pre className="json">
              {JSON.stringify({ framing: compiled.framing, grade: compiled.grade }, null, 2)}
            </pre>
            <button
              onClick={() =>
                void navigator.clipboard.writeText(JSON.stringify(compiled.grade, null, 2))
              }
            >
              Copy grade JSON
            </button>
          </>
        )}
      </Section>
    </ToolPanel>
  )
}
