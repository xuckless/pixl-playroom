/**
 * The engine report: what the last render did (timings, where precision
 * went, the grade line by line), the grade an export sends, and custom
 * layers written in the engine's own terms. A dialog, from View ▸ Engine
 * Report… (Ctrl+Alt+E) or the develop toolbar; it once was the wheel's last
 * tool.
 */
import { useMemo, useState } from 'react'
import { compile } from '../../../shared/compile'
import { rasterGradient } from '../../../shared/gradients'
import type { GradeLayer } from '../../../shared/engine-types'
import { fromExif } from '../../../shared/orientation'
import { newId } from '../../../shared/recipe'
import { Icon } from '../components/icons'
import { Modal, Section } from '../components/ui'
import { useDevelop } from '../state/develop'
import { useLibrary } from '../state/library'
import { rich, t, tk, tp } from '../lib/i18n'

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
        {rich(
          "Layers in the engine's own terms (a {{type}} as JSON: stages in any space, any op — CDL, qualifiers, LUTs, blend modes). They run after the panels and masks. The engine names the field when one is wrong.",
          { type: <code>GradeLayer</code> }
        )}
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
                    commit(tk('Toggle custom layer'))
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
                      commit(tk('Edit custom layer'))
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
                  {t('Apply')}
                </button>
                <button
                  className="icon"
                  title={t('Remove this layer')}
                  aria-label={t('Remove this layer')}
                  onClick={() => {
                    edit((r) => r.custom.splice(i, 1))
                    commit(tk('Remove custom layer'))
                  }}
                >
                  <Icon name="trash" />
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
          commit(tk('Add custom layer'))
        }}
      >
        + {t('Custom layer')}
      </button>
    </div>
  )
}

export function EngineReportDialog(): React.JSX.Element | null {
  const session = useDevelop((s) => s.session)
  const recipe = useDevelop((s) => s.recipe)
  const report = useDevelop((s) => s.report)
  const engine = useLibrary((s) => s.engine)
  const setDialog = useLibrary((s) => s.setDialog)
  const [show, setShow] = useState(false)
  const compiled = useMemo(() => {
    if (!session || !recipe || !show) return null
    // As the exporter compiles it: the original, turned by its own
    // orientation (a developed RAW is already upright), at full size.
    return compile(recipe, {
      isRaw: session.isRaw,
      asShot: session.asShot,
      sourceOrientation: session.isRaw ? 'Normal' : fromExif(session.info.orientation),
      frameWidth: session.frameWidth,
      frameHeight: session.frameHeight,
      scale: 1,
      seed: session.seed,
      brushPaths: Object.fromEntries(
        recipe.layers.flatMap((l) =>
          l.components
            .filter(
              (c) =>
                c.kind === 'brush' ||
                ((c.kind === 'linear' || c.kind === 'radial' || c.kind === 'bidirectional') &&
                  rasterGradient(c))
            )
            .map((c) => [c.id, `<${c.kind} plane ${c.id}>`])
        )
      ),
      applyCrop: true,
      hdr: session.isHdr
    })
  }, [session, recipe, show])
  if (!session || !recipe) return null
  return (
    <Modal
      title={t('Engine report')}
      icon="engine"
      wide
      className="engine-report"
      onClose={() => setDialog(null)}
    >
      <p className="muted small engine-line">
        {t('PIXL engine {{version}}', { version: engine?.version ?? '—' })}
        {engine?.runtime
          ? ` · ONNX Runtime ${engine.runtime.version} (${engine.runtime.providers.join(', ')})`
          : ''}
        {' · '}
        {session.item.name}
      </p>
      <div className="engine-cols">
        <div>
          <Section id="engine.report" title={t('Last render')}>
            {report ? (
              <>
                <div className="muted small">
                  {t('{{total}} ms · decode {{decode}} · colour {{color}} · encode {{encode}}', {
                    total: report.totalMs,
                    decode: report.decodeMs,
                    color: report.colorMs,
                    encode: report.encodeMs
                  })}
                </div>
                <div className="muted small">
                  {t('out: {{space}} · {{from}}→{{to}} bits', {
                    space: report.colorSpace,
                    from: report.loss.source_bits,
                    to: report.loss.output_bits
                  })}
                  {' · '}
                  {report.loss.single_float_pass
                    ? tp(
                        '{{count}} rounding, one float pass',
                        '{{count}} roundings, one float pass',
                        report.loss.quantisations
                      )
                    : tp('{{count}} rounding', '{{count}} roundings', report.loss.quantisations)}
                  {report.clampedSamples > 0 && (
                    <>
                      {' · '}
                      {tp(
                        '{{count}} sample clamped',
                        '{{count}} samples clamped',
                        report.clampedSamples
                      )}
                    </>
                  )}
                </div>
                {report.notes.map((n) => (
                  <p key={n} className="note small">
                    {n}
                  </p>
                ))}
                <pre className="report-lines">
                  {report.gradeLines.join('\n') || t('no grade — the fast path')}
                </pre>
              </>
            ) : (
              <p className="muted small">{t('Nothing rendered yet.')}</p>
            )}
          </Section>
          <Section
            id="engine.compiled"
            title={t('Compiled grade')}
            right={
              <button className="sm" onClick={() => setShow(!show)}>
                {show ? t('Hide') : t('Show')}
              </button>
            }
          >
            <p className="muted small">
              {t('What an export at full resolution sends to the engine.')}
            </p>
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
                  {t('Copy grade JSON')}
                </button>
              </>
            )}
          </Section>
        </div>
        <div>
          <Section id="engine.custom" title={t('Custom layers')}>
            <CustomLayers />
          </Section>
        </div>
      </div>
    </Modal>
  )
}
