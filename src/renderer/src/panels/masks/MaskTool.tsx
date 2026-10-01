import type { BlendMode, KeyBand, MaskMode } from '../../../../shared/engine-types'
import { normaliseEdge, type MaskEdge } from '../../../../shared/maskedge'
import { isNeutral, neutralSettings, type MaskComponentSetting } from '../../../../shared/recipe'
import { Icon } from '../../components/icons'
import { Section, Select, Slider, Toggle } from '../../components/ui'
import { useDevelop } from '../../state/develop'
import {
  changeLayer,
  componentIcon,
  componentLabel,
  deleteComponent,
  layerOf,
  MODE_MARK
} from './model'
import { MaskPresets } from './MaskPresets'

const BLENDS: BlendMode[] = [
  'Normal',
  'Multiply',
  'Screen',
  'Overlay',
  'SoftLight',
  'HardLight',
  'Darken',
  'Lighten',
  'Difference',
  'Add'
]

function RangeEditor({
  c,
  index
}: {
  c: Extract<MaskComponentSetting, { kind: 'range' }>
  index: number
}): React.JSX.Element {
  const commit = useDevelop((s) => s.commit)
  const setBand = (axis: 'hue' | 'saturation' | 'luma', band: KeyBand | null): void =>
    changeLayer((l) => {
      const comp = l.components[index]
      if (comp.kind === 'range') comp[axis] = band
    }, true)
  const band = (
    axis: 'hue' | 'saturation' | 'luma',
    label: string,
    max: number,
    def: KeyBand
  ): React.JSX.Element => {
    const b = c[axis]
    return (
      <div className="range-axis">
        <label className="check">
          <input
            type="checkbox"
            checked={b !== null}
            onChange={(e) => {
              setBand(axis, e.target.checked ? def : null)
              commit(`Range ${label}`)
            }}
          />
          {label}
        </label>
        {b && (
          <>
            <Slider
              label="Centre"
              value={b.centre}
              min={0}
              max={max}
              step={max > 1 ? 1 : 0.01}
              def={def.centre}
              onChange={(v, live) => {
                setBand(axis, { ...b, centre: v })
                void live
              }}
              onCommit={() => commit(`Range ${label}`)}
            />
            <Slider
              label="Width"
              value={b.width}
              min={0}
              max={max}
              step={max > 1 ? 1 : 0.01}
              def={def.width}
              onChange={(v) => setBand(axis, { ...b, width: v })}
              onCommit={() => commit(`Range ${label}`)}
            />
            <Slider
              label="Softness"
              value={b.softness}
              min={0}
              max={max}
              step={max > 1 ? 1 : 0.01}
              def={def.softness}
              onChange={(v) => setBand(axis, { ...b, softness: v })}
              onCommit={() => commit(`Range ${label}`)}
            />
          </>
        )}
      </div>
    )
  }
  return (
    <div className="range-editor">
      {band('hue', 'Hue', 360, { centre: 210, width: 40, softness: 25 })}
      {band('saturation', 'Saturation', 1, { centre: 0.6, width: 0.8, softness: 0.2 })}
      {band('luma', 'Luminance', 1, { centre: 0.5, width: 0.4, softness: 0.15 })}
    </div>
  )
}

/**
 * The mask's settings: what it does is edited in the panels on the right
 * while it is selected; here are its presets and a way back to neutral.
 */
function Adjustments(): React.JSX.Element | null {
  const recipe = useDevelop((s) => s.recipe)
  const layerId = useDevelop((s) => s.layerId)
  const commit = useDevelop((s) => s.commit)
  const layer = layerOf(recipe, layerId)
  if (!layer) return null
  return (
    <Section
      id="masks.presets"
      title="Settings"
      right={
        isNeutral(layer.settings) ? undefined : (
          <button
            className="sm ghost"
            title="Every setting of this mask back to no change"
            onClick={() => {
              changeLayer((l) => (l.settings = neutralSettings()))
              commit(`${layer.name}: reset`)
            }}
          >
            Reset all
          </button>
        )
      }
    >
      <p className="muted small">
        The panels on the right (Basic, Tone Curve, HSL, Colour Grading, Detail, Effects,
        Calibration) edit this mask while it is selected.
      </p>
      <MaskPresets layer={layer} />
    </Section>
  )
}

/** The selected component: how it joins the mask, and its own shape settings. */
function ComponentCard({
  c,
  index
}: {
  c: MaskComponentSetting
  index: number
}): React.JSX.Element {
  const commit = useDevelop((s) => s.commit)
  const tool = useDevelop((s) => s.tool)
  const setTool = useDevelop((s) => s.setTool)
  const set = <K extends keyof MaskComponentSetting>(
    k: K,
    v: MaskComponentSetting[K],
    live = false
  ): void =>
    changeLayer((l) => {
      const x = l.components[index]
      if (x) x[k] = v
    }, live)
  // The edge: kept only while it changes something (shared/maskedge.ts).
  const setEdge = (p: Partial<MaskEdge>, live = false): void =>
    changeLayer((l) => {
      const x = l.components[index]
      if (!x) return
      const e = normaliseEdge({ shift: 0, harden: 0, ...x.edge, ...p })
      if (e) x.edge = e
      else delete x.edge
    }, live)
  const raster = c.kind === 'brush' || c.kind === 'linear' || c.kind === 'radial'
  return (
    <div className="component">
      <div className="component-head">
        <Icon name={componentIcon(c)} />
        <span className="component-kind">{componentLabel(c)}</span>
        <span className="spacer" />
        <button
          className="icon sm"
          title="Delete component (⌫)"
          onClick={() => deleteComponent(c.id)}
        >
          <Icon name="trash" />
        </button>
      </div>
      <div className="row">
        <div className="seg" role="group" aria-label="How it joins the mask">
          {(['Add', 'Subtract', 'Intersect'] as MaskMode[]).map((m) => (
            <button
              key={m}
              className={(index === 0 ? 'Add' : c.mode) === m ? 'on' : ''}
              disabled={index === 0 && m !== 'Add'}
              title={index === 0 ? 'The first component always adds' : m}
              onClick={() => {
                set('mode', m)
                commit(`Mask mode: ${m}`)
              }}
            >
              {MODE_MARK[m]} {m}
            </button>
          ))}
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={c.invert}
            onChange={(e) => {
              set('invert', e.target.checked)
              commit('Invert component')
            }}
          />
          Invert
        </label>
      </div>
      <Slider
        label="Opacity"
        value={c.opacity}
        min={0}
        max={100}
        def={100}
        onChange={(v, live) => set('opacity', v, live)}
        onCommit={() => commit('Component opacity')}
      />
      <Slider
        label="Feather"
        value={c.feather}
        min={0}
        max={100}
        def={0}
        onChange={(v, live) => set('feather', v, live)}
        onCommit={() => commit('Feather')}
      />
      {(raster || c.kind === 'polygon') && (
        <Slider
          label="Shift edge"
          value={c.edge?.shift ?? 0}
          min={-100}
          max={100}
          def={0}
          title="Move the edge in (−) or out (+), up to 3% of the photo's shorter side"
          onChange={(v, live) => setEdge({ shift: v }, live)}
          onCommit={() => commit('Shift edge')}
        />
      )}
      {raster && (
        <Slider
          label="Harden"
          value={c.edge?.harden ?? 0}
          min={0}
          max={100}
          def={0}
          title="Steepen a soft edge (an AI mask's, a gradient's) about its middle"
          onChange={(v, live) => setEdge({ harden: v }, live)}
          onCommit={() => commit('Harden edge')}
        />
      )}
      {c.kind === 'polygon' && (
        <label
          className="check"
          title="The feather falls inside the line drawn, not half outside it"
        >
          <input
            type="checkbox"
            checked={!!c.edge?.inside}
            onChange={(e) => {
              setEdge({ inside: e.target.checked })
              commit('Feather inside')
            }}
          />
          Feather inside the line
        </label>
      )}
      {c.kind === 'radial' && (
        <Slider
          label="Softness"
          value={c.softness}
          min={0}
          max={100}
          def={50}
          onChange={(v, live) =>
            changeLayer((l) => {
              const x = l.components[index]
              if (x?.kind === 'radial') x.softness = v
            }, live)
          }
          onCommit={() => commit('Radial softness')}
        />
      )}
      {c.kind === 'range' && (
        <>
          <div className="row">
            <Toggle
              on={tool === 'range-picker'}
              onChange={(on) => setTool(on ? 'range-picker' : 'none')}
              title="Click the photo to centre this range on that colour or tone"
            >
              <Icon name="picker" />
              Pick
            </Toggle>
          </div>
          <Slider
            label="Smoothness"
            value={c.smoothness}
            min={0}
            max={100}
            def={0}
            onChange={(v, live) =>
              changeLayer((l) => {
                const x = l.components[index]
                if (x?.kind === 'range') x.smoothness = v
              }, live)
            }
            onCommit={() => commit('Range smoothness')}
          />
          <RangeEditor c={c} index={index} />
        </>
      )}
    </div>
  )
}

/**
 * The selected mask's own settings, under the list in the masks window: its
 * Amount, the selected component, its sliders and its blend. Nothing when no
 * mask is selected.
 */
export function SelectedMask(): React.JSX.Element | null {
  const recipe = useDevelop((s) => s.recipe)
  const layerId = useDevelop((s) => s.layerId)
  const compId = useDevelop((s) => s.compId)
  const commit = useDevelop((s) => s.commit)
  const report = useDevelop((s) => s.report)
  if (!recipe) return null
  const layer = layerOf(recipe, layerId)
  if (!layer) return null
  const index = layer.components.findIndex((c) => c.id === compId)
  const comp = index >= 0 ? layer.components[index] : undefined
  const measured = report?.layers?.[layer.id]
  const coverage = !measured
    ? null
    : !measured.applied
      ? 'Not applied'
      : measured.coverage === null
        ? null
        : `Covers ${(measured.coverage * 100).toFixed(1)}% of the photo`
  return (
    <div className="mf-selected">
      <div className="mf-selected-title micro">{layer.name}</div>
      <Slider
        label="Amount"
        value={layer.amount ?? 100}
        min={0}
        max={200}
        def={100}
        format={(v) => `${Math.round(v)}%`}
        onChange={(v, live) => changeLayer((l) => (l.amount = v), live)}
        onCommit={() => commit(`${layer.name}: amount`)}
      />
      {comp && (
        <Section id="masks.component" title="Component">
          <ComponentCard c={comp} index={index} />
        </Section>
      )}
      <Adjustments />
      <Section id="masks.blend" title="Mask">
        <Select
          label="Blend"
          value={layer.blend}
          options={BLENDS.map((b) => ({ value: b, label: b }))}
          onChange={(b) => {
            changeLayer((l) => (l.blend = b))
            commit('Mask blend')
          }}
        />
        <Slider
          label="Opacity"
          value={layer.opacity}
          min={0}
          max={100}
          def={100}
          onChange={(v, live) => changeLayer((l) => (l.opacity = v), live)}
          onCommit={() => commit('Mask opacity')}
        />
        <div className="row">
          <label className="check">
            <input
              type="checkbox"
              checked={layer.invert}
              onChange={(e) => {
                changeLayer((l) => (l.invert = e.target.checked))
                commit('Invert mask')
              }}
            />
            Invert the whole mask
          </label>
        </div>
        {coverage && <p className="muted small">{coverage}</p>}
      </Section>
    </div>
  )
}
