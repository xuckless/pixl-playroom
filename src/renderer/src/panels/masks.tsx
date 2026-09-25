import type { BlendMode, KeyBand, MaskMode } from '../../../shared/engine-types'
import {
  newId,
  newLocalLayer,
  ZERO_LOCAL,
  type LocalAdjust,
  type LocalLayer,
  type MaskComponentSetting,
  type Recipe
} from '../../../shared/recipe'
import { Select, Slider, Toggle, ToolPanel } from '../components/ui'
import { emptyRange } from '../lib/helpers'
import { useDevelop } from '../state/develop'

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

function layerOf(r: Recipe, id: string | null): LocalLayer | undefined {
  return r.layers.find((l) => l.id === id)
}

/** Edit the selected layer of the recipe. */
function useLayerEdit(): {
  layer: LocalLayer | undefined
  change: (fn: (l: LocalLayer) => void, live?: boolean) => void
  commit: (label: string) => void
} {
  const recipe = useDevelop((s) => s.recipe)
  const layerId = useDevelop((s) => s.layerId)
  const edit = useDevelop((s) => s.edit)
  const commit = useDevelop((s) => s.commit)
  return {
    layer: recipe ? layerOf(recipe, layerId) : undefined,
    change: (fn, live = false) =>
      edit((r) => {
        const l = layerOf(r, layerId)
        if (l) fn(l)
      }, live),
    commit
  }
}

function RangeEditor({
  c,
  index
}: {
  c: Extract<MaskComponentSetting, { kind: 'range' }>
  index: number
}): React.JSX.Element {
  const { change, commit } = useLayerEdit()
  const setBand = (axis: 'hue' | 'saturation' | 'luma', band: KeyBand | null): void =>
    change((l) => {
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

function Components(): React.JSX.Element | null {
  const { layer, change, commit } = useLayerEdit()
  const tool = useDevelop((s) => s.tool)
  const setTool = useDevelop((s) => s.setTool)
  if (!layer) return null
  return (
    <div className="components">
      <div className="row wrap">
        <Toggle
          on={tool === 'brush'}
          onChange={(on) => setTool(on ? 'brush' : 'none')}
          title="Paint (B)"
        >
          🖌 Brush
        </Toggle>
        <Toggle
          on={tool === 'polygon'}
          onChange={(on) => setTool(on ? 'polygon' : 'none')}
          title="Lasso: click points, double-click to close (L)"
        >
          ⬠ Lasso
        </Toggle>
        <button
          onClick={() => {
            change((l) => l.components.push(emptyRange('color')))
            commit('Add colour range')
          }}
        >
          + Colour range
        </button>
        <button
          onClick={() => {
            change((l) => l.components.push(emptyRange('luminance')))
            commit('Add luminance range')
          }}
        >
          + Luminance range
        </button>
        <Toggle
          on={tool === 'range-picker'}
          onChange={(on) => setTool(on ? 'range-picker' : 'none')}
          title="Click the photo to centre the last range on that colour"
        >
          ⌖ Pick range
        </Toggle>
      </div>
      {layer.components.length === 0 && (
        <p className="muted small">No mask yet — paint, draw or pick a range.</p>
      )}
      {layer.components.map((c, i) => (
        <div key={c.id} className="component">
          <div className="row between">
            <span className="component-kind">
              {c.kind === 'brush'
                ? '🖌 Brush'
                : c.kind === 'polygon'
                  ? `⬠ Lasso (${c.points.length})`
                  : '◐ Range'}
            </span>
            <select
              value={c.mode}
              disabled={i === 0}
              title={
                i === 0
                  ? 'The first component always adds'
                  : 'How this combines with the ones above'
              }
              onChange={(e) => {
                change((l) => (l.components[i].mode = e.target.value as MaskMode))
                commit('Mask mode')
              }}
            >
              <option value="Add">Add</option>
              <option value="Subtract">Subtract</option>
              <option value="Intersect">Intersect</option>
            </select>
            <label className="check">
              <input
                type="checkbox"
                checked={c.invert}
                onChange={(e) => {
                  change((l) => (l.components[i].invert = e.target.checked))
                  commit('Invert component')
                }}
              />
              inv
            </label>
            <button
              className="icon"
              title="Remove"
              onClick={() => {
                change((l) => l.components.splice(i, 1))
                commit('Remove mask component')
              }}
            >
              🗑
            </button>
          </div>
          <Slider
            label="Opacity"
            value={c.opacity}
            min={0}
            max={100}
            def={100}
            onChange={(v, live) => change((l) => (l.components[i].opacity = v), live)}
            onCommit={() => commit('Component opacity')}
          />
          <Slider
            label="Feather"
            value={c.feather}
            min={0}
            max={100}
            def={0}
            onChange={(v, live) => change((l) => (l.components[i].feather = v), live)}
            onCommit={() => commit('Feather')}
          />
          {c.kind === 'range' && <RangeEditor c={c} index={i} />}
        </div>
      ))}
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

function Adjustments(): React.JSX.Element | null {
  const { layer, change, commit } = useLayerEdit()
  if (!layer) return null
  return (
    <div className="local-adjust">
      {LOCAL_SLIDERS.map((s) => (
        <Slider
          key={s.key}
          label={s.label}
          value={layer.adjust[s.key]}
          min={s.min}
          max={s.max}
          step={s.step ?? 1}
          def={ZERO_LOCAL[s.key]}
          format={s.step ? (v) => v.toFixed(2) : undefined}
          track={
            s.key === 'tintHue'
              ? 'linear-gradient(90deg,red,yellow,lime,cyan,blue,magenta,red)'
              : undefined
          }
          onChange={(v, live) => change((l) => (l.adjust[s.key] = v), live)}
          onCommit={() => commit(`${layer.name}: ${s.label}`)}
        />
      ))}
    </div>
  )
}

export function MasksPanel(): React.JSX.Element | null {
  const recipe = useDevelop((s) => s.recipe)
  const layerId = useDevelop((s) => s.layerId)
  const setLayer = useDevelop((s) => s.setLayer)
  const overlay = useDevelop((s) => s.overlay)
  const setOverlay = useDevelop((s) => s.setOverlay)
  const edit = useDevelop((s) => s.edit)
  const commit = useDevelop((s) => s.commit)
  const mask = useDevelop((s) => s.mask)
  const report = useDevelop((s) => s.report)
  const { layer, change } = useLayerEdit()
  if (!recipe) return null
  const add = (): void => {
    const l = newLocalLayer(`Mask ${recipe.layers.length + 1}`)
    edit((r) => r.layers.push(l))
    commit('New mask')
    setLayer(l.id)
  }
  const coverage = layer
    ? report?.gradeLines.find((line) => line.includes(`▸ ${layer.name} `))
    : undefined
  return (
    <ToolPanel
      actions={
        <button className="sm" onClick={add}>
          + New mask
        </button>
      }
    >
      <div className="layer-list">
        {recipe.layers.map((l) => (
          <div
            key={l.id}
            className={`layer-row ${l.id === layerId ? 'on' : ''}`}
            onClick={() => setLayer(l.id === layerId ? null : l.id)}
          >
            <input
              type="checkbox"
              checked={l.enabled}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                edit((r) => {
                  const x = layerOf(r, l.id)
                  if (x) x.enabled = e.target.checked
                })
                commit(e.target.checked ? 'Show mask' : 'Hide mask')
              }}
            />
            <span className="layer-name">{l.name}</span>
            <span className="muted small">
              {l.components.length} part{l.components.length === 1 ? '' : 's'}
            </span>
            <button
              className="icon"
              title="Duplicate"
              onClick={(e) => {
                e.stopPropagation()
                const copy = { ...structuredClone(l), id: newId(), name: `${l.name} copy` }
                edit((r) => r.layers.push(copy))
                commit('Duplicate mask')
              }}
            >
              ⧉
            </button>
            <button
              className="icon"
              title="Delete"
              onClick={(e) => {
                e.stopPropagation()
                edit((r) => (r.layers = r.layers.filter((x) => x.id !== l.id)))
                commit('Delete mask')
                if (layerId === l.id) setLayer(null)
              }}
            >
              🗑
            </button>
          </div>
        ))}
        {recipe.layers.length === 0 && (
          <p className="muted small">Masks limit an adjustment to part of the photo.</p>
        )}
      </div>
      {layer && (
        <div className="layer-detail">
          <div className="row">
            <input
              className="name"
              value={layer.name}
              onChange={(e) => change((l) => (l.name = e.target.value), true)}
              onBlur={() => commit('Rename mask')}
            />
            <Toggle on={overlay} onChange={setOverlay} title="Show the mask as a red overlay (O)">
              Overlay
            </Toggle>
            <label className="check">
              <input
                type="checkbox"
                checked={layer.invert}
                onChange={(e) => {
                  change((l) => (l.invert = e.target.checked))
                  commit('Invert mask')
                }}
              />
              Invert
            </label>
          </div>
          <div className="row">
            <Select
              label="Blend"
              value={layer.blend}
              options={BLENDS.map((b) => ({ value: b, label: b }))}
              onChange={(v) => {
                change((l) => (l.blend = v))
                commit('Blend mode')
              }}
            />
          </div>
          <Slider
            label="Opacity"
            value={layer.opacity}
            min={0}
            max={100}
            def={100}
            onChange={(v, live) => change((l) => (l.opacity = v), live)}
            onCommit={() => commit('Mask opacity')}
          />
          {mask && (
            <p className="muted small">
              Overlay rendered by the engine (Inspect::LayerMask). {coverage ?? ''}
            </p>
          )}
          <Components />
          <span className="group-label">Adjustments</span>
          <Adjustments />
        </div>
      )}
    </ToolPanel>
  )
}
