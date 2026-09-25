import type { BlendMode, KeyBand, MaskMode } from '../../../../shared/engine-types'
import { ZERO_LOCAL, type LocalAdjust, type MaskComponentSetting } from '../../../../shared/recipe'
import { Icon } from '../../components/icons'
import { Section, Select, Slider, Toggle, ToolPanel } from '../../components/ui'
import { useDevelop } from '../../state/develop'
import {
  changeLayer,
  componentIcon,
  componentLabel,
  deleteComponent,
  layerOf,
  MODE_MARK
} from './model'
import { ToolPicker } from './ToolPicker'

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

const LOCAL_SLIDERS: {
  key: keyof LocalAdjust
  label: string
  min: number
  max: number
  step?: number
}[] = [
  { key: 'temperature', label: 'Temp', min: -100, max: 100 },
  { key: 'tint', label: 'Tint', min: -100, max: 100 },
  { key: 'exposure', label: 'Exposure', min: -4, max: 4, step: 0.01 },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100 },
  { key: 'highlights', label: 'Highlights', min: -100, max: 100 },
  { key: 'shadows', label: 'Shadows', min: -100, max: 100 },
  { key: 'whites', label: 'Whites', min: -100, max: 100 },
  { key: 'blacks', label: 'Blacks', min: -100, max: 100 },
  { key: 'texture', label: 'Texture', min: -100, max: 100 },
  { key: 'clarity', label: 'Clarity', min: -100, max: 100 },
  { key: 'dehaze', label: 'Dehaze', min: -100, max: 100 },
  { key: 'hue', label: 'Hue', min: -100, max: 100 },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100 },
  { key: 'sharpness', label: 'Sharpness', min: 0, max: 100 },
  { key: 'noise', label: 'Noise', min: 0, max: 100 },
  { key: 'tintHue', label: 'Colour hue', min: 0, max: 360 },
  { key: 'tintAmount', label: 'Colour amount', min: 0, max: 100 }
]

/** The mask's sliders, in Lightroom's groups. */
const ADJUST_GROUPS: { id: string; title: string; keys: (keyof LocalAdjust)[] }[] = [
  { id: 'masks.colour', title: 'Colour', keys: ['temperature', 'tint', 'hue', 'saturation'] },
  {
    id: 'masks.light',
    title: 'Light',
    keys: ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks']
  },
  { id: 'masks.presence', title: 'Presence', keys: ['texture', 'clarity', 'dehaze'] },
  { id: 'masks.detail', title: 'Detail', keys: ['sharpness', 'noise'] },
  { id: 'masks.tint', title: 'Colour tint', keys: ['tintHue', 'tintAmount'] }
]

function Adjustments(): React.JSX.Element | null {
  const recipe = useDevelop((s) => s.recipe)
  const layerId = useDevelop((s) => s.layerId)
  const commit = useDevelop((s) => s.commit)
  const layer = layerOf(recipe, layerId)
  if (!layer) return null
  const changed = (Object.keys(ZERO_LOCAL) as (keyof LocalAdjust)[]).some(
    (k) => layer.adjust[k] !== ZERO_LOCAL[k]
  )
  return (
    <>
      {ADJUST_GROUPS.map((g) => (
        <Section
          key={g.id}
          id={g.id}
          title={g.title}
          right={
            g.id === 'masks.colour' && changed ? (
              <button
                className="sm ghost"
                title="Every slider of this mask back to zero"
                onClick={() => {
                  changeLayer((l) => (l.adjust = { ...ZERO_LOCAL }))
                  commit(`${layer.name}: reset sliders`)
                }}
              >
                Reset all
              </button>
            ) : undefined
          }
        >
          {g.keys.map((key) => {
            const s = LOCAL_SLIDERS.find((x) => x.key === key)
            if (!s) return null
            return (
              <Slider
                key={key}
                label={s.label}
                value={layer.adjust[key]}
                min={s.min}
                max={s.max}
                step={s.step ?? 1}
                def={ZERO_LOCAL[key]}
                format={s.step ? (v) => (v > 0 ? '+' : '') + v.toFixed(2) : undefined}
                track={
                  key === 'tintHue'
                    ? 'linear-gradient(90deg,red,yellow,lime,cyan,blue,magenta,red)'
                    : key === 'temperature'
                      ? 'linear-gradient(90deg,#5b8cff,#fff,#ffb44d)'
                      : key === 'tint'
                        ? 'linear-gradient(90deg,#4dff6a,#fff,#ff4de1)'
                        : undefined
                }
                onChange={(v, live) => changeLayer((l) => (l.adjust[key] = v), live)}
                onCommit={() => commit(`${layer.name}: ${s.label}`)}
              />
            )
          })}
        </Section>
      ))}
    </>
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
  return (
    <div className="component">
      <div className="component-head">
        <Icon name={componentIcon(c)} />
        <span className="component-kind">{componentLabel(c)}</span>
        <span className="spacer" />
        <button
          className="icon sm"
          title="Remove this component"
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
 * The Masks tool in the right column. With no mask selected it offers the
 * tools to make one; with one selected, its Amount, the selected
 * component, the mask's blend and the seventeen local sliders.
 */
export function MasksPanel(): React.JSX.Element | null {
  const recipe = useDevelop((s) => s.recipe)
  const layerId = useDevelop((s) => s.layerId)
  const compId = useDevelop((s) => s.compId)
  const overlay = useDevelop((s) => s.overlay)
  const setOverlay = useDevelop((s) => s.setOverlay)
  const commit = useDevelop((s) => s.commit)
  const report = useDevelop((s) => s.report)
  if (!recipe) return null
  const layer = layerOf(recipe, layerId)
  if (!layer)
    return (
      <ToolPanel>
        <p className="masks-intro">
          A mask limits adjustments to part of the photo. Make one with a tool below, or from the
          masks panel on the photo.
        </p>
        <ToolPicker inline />
      </ToolPanel>
    )
  const index = layer.components.findIndex((c) => c.id === compId)
  const comp = index >= 0 ? layer.components[index] : undefined
  const coverage = report?.gradeLines.find((line) => line.includes(`▸ ${layer.name} `))
  return (
    <ToolPanel
      actions={
        <>
          <span className="mask-title">{layer.name}</span>
          <span className="spacer" />
          <Toggle on={overlay} onChange={setOverlay} title="Show the mask overlay (O)">
            <Icon name="overlay" />
            Overlay
          </Toggle>
        </>
      }
    >
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
        {coverage && <p className="muted small">{coverage.replace(/^▸\s*/, '')}</p>}
      </Section>
    </ToolPanel>
  )
}
