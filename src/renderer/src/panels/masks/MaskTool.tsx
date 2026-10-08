import type { BlendMode, KeyBand } from '../../../../shared/engine-types'
import { normaliseEdge, type MaskEdge } from '../../../../shared/maskedge'
import {
  componentControls,
  fromModel,
  hiddenAdjusted,
  resetHidden
} from '../../../../shared/maskcontrols'
import { defaultEdgeRadius, EDGE_RADIUS_MAX, EDGE_RADIUS_MIN } from '../../../../shared/refine'
import type { MaskComponentSetting } from '../../../../shared/recipe'
import { Icon } from '../../components/icons'
import { Section, Select, Slider, Toggle } from '../../components/ui'
import { useDevelop } from '../../state/develop'
import { changeLayer, layerOf, patchComponent } from './model'
import { findObject } from '../../lib/objects'
import { ensureModel } from '../../lib/ensureModel'
import { BandBar } from './BandBar'
import { DepthPreview } from './DepthPreview'

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

type Axis = 'hue' | 'saturation' | 'luma'

const AXES: { axis: Axis; label: string; max: number; def: KeyBand }[] = [
  { axis: 'hue', label: 'Hue', max: 360, def: { centre: 210, width: 40, softness: 25 } },
  {
    axis: 'saturation',
    label: 'Saturation',
    max: 1,
    def: { centre: 0.6, width: 0.8, softness: 0.2 }
  },
  { axis: 'luma', label: 'Luminance', max: 1, def: { centre: 0.5, width: 0.4, softness: 0.15 } }
]

/**
 * The selected component's own settings, under its row: only what its kind
 * needs (`shared/maskcontrols.ts`). How it joins the mask and whether it is
 * inverted are on the row itself.
 */
export function ComponentCard({
  c,
  index
}: {
  c: MaskComponentSetting
  index: number
}): React.JSX.Element {
  const commit = useDevelop((s) => s.commit)
  const tool = useDevelop((s) => s.tool)
  const setTool = useDevelop((s) => s.setTool)
  const show = componentControls(c)
  const edit = (fn: (x: MaskComponentSetting) => void, live = false): void =>
    changeLayer((l) => {
      const x = l.components[index]
      if (x) fn(x)
    }, live)
  // The edge: kept only while it changes something (shared/maskedge.ts).
  const setEdge = (p: Partial<MaskEdge>, live = false): void =>
    edit((x) => {
      const e = normaliseEdge({ shift: 0, harden: 0, ...x.edge, ...p })
      if (e) x.edge = e
      else delete x.edge
    }, live)
  const snapping = c.refine?.on === true
  const radiusDef = defaultEdgeRadius(c)
  // A painted stroke snaps to the object SAM finds under it (main/brushes.ts).
  const stroke = c.kind === 'brush' && !c.source
  // Snap to edges on: a model's mask lets the snap firm its edge, in place of
  // an older recipe's harden.
  const setSnap = async (on: boolean): Promise<void> => {
    // SAM offered first when it is not here; without it nothing changes.
    if (on && stroke && !(await ensureModel('prompt', 'Snap to edges'))) return
    edit((x) => {
      // A stroke's snap is the object's edge: a light refine on it, whatever it was.
      x.refine = { on, radius: on && stroke ? radiusDef : (x.refine?.radius ?? radiusDef) }
      if (on && fromModel(x) && x.edge) {
        const e = normaliseEdge({ ...x.edge, harden: 0 })
        if (e) x.edge = e
        else delete x.edge
      }
    })
    commit(on ? 'Snap to edges' : 'Snap to edges off')
  }
  return (
    <div className="mf-card">
      {show.snap && (
        <>
          <div className="mf-card-row">
            <Toggle
              on={snapping}
              onChange={(on) => void setSnap(on)}
              title={
                stroke
                  ? "Keep this stroke to the object it was painted on, cut at the object's edges (SAM 2.1)"
                  : "Pull this edge onto the photo's own edges, at full resolution (the engine's refine)"
              }
            >
              Snap to edges
            </Toggle>
            {c.kind === 'polygon' && (
              <button
                className="sm ghost"
                disabled={c.points.length < 3}
                title="Find the object inside this outline (SAM 2.1) and use its own edges instead"
                onClick={() => void findObject(c.id)}
              >
                <Icon name="objects" />
                Find object
              </button>
            )}
          </div>
          {snapping && (
            <Slider
              label="Edge radius"
              adjusts={false}
              value={c.refine?.radius ?? radiusDef}
              min={EDGE_RADIUS_MIN}
              max={EDGE_RADIUS_MAX}
              step={0.05}
              scale="log"
              def={radiusDef}
              format={(v) => `${v.toFixed(2)}%`}
              title="How far the photo's edges may pull this one, as a share of its shorter side: about three times how far off the edge is"
              onChange={(v, live) =>
                edit((x) => (x.refine = { on: true, radius: Math.round(v * 100) / 100 }), live)
              }
              onCommit={() => commit('Edge radius')}
            />
          )}
        </>
      )}
      {show.feather && (
        <Slider
          label="Feather"
          adjusts={false}
          value={c.feather}
          min={0}
          max={100}
          def={3}
          onChange={(v, live) => edit((x) => (x.feather = v), live)}
          onCommit={() => commit('Feather')}
        />
      )}
      {show.shift && (
        <Slider
          label="Shift edge"
          adjusts={false}
          value={c.edge?.shift ?? 0}
          min={-100}
          max={100}
          def={0}
          title="Move the edge in (−) or out (+), up to 3% of the photo's shorter side"
          onChange={(v, live) => setEdge({ shift: v }, live)}
          onCommit={() => commit('Shift edge')}
        />
      )}
      {show.softness && c.kind === 'radial' && (
        <Slider
          label="Feather"
          adjusts={false}
          value={c.softness}
          min={0}
          max={100}
          def={50}
          title="How much of the radius fades out"
          onChange={(v, live) => edit((x) => x.kind === 'radial' && (x.softness = v), live)}
          onCommit={() => commit('Radial feather')}
        />
      )}
      {show.range && c.kind === 'range' && (
        <>
          <div className="mf-card-row">
            <Toggle
              on={tool === 'range-picker'}
              onChange={(on) => setTool(on ? 'range-picker' : 'none')}
              title="Click the photo to centre this range on that colour or tone"
            >
              <Icon name="picker" />
              Pick
            </Toggle>
          </div>
          {AXES.map((a) => (
            <BandBar
              key={a.axis}
              axis={a.axis}
              label={a.label}
              band={c[a.axis]}
              max={a.max}
              def={a.def}
              onChange={(band) => edit((x) => x.kind === 'range' && (x[a.axis] = band), true)}
              onCommit={() => commit(`Range ${a.label}`)}
            />
          ))}
          <Slider
            label="Smoothness"
            adjusts={false}
            value={c.smoothness}
            min={0}
            max={100}
            def={0}
            onChange={(v, live) => edit((x) => x.kind === 'range' && (x.smoothness = v), live)}
            onCommit={() => commit('Range smoothness')}
          />
        </>
      )}
      {show.depth && c.kind === 'depth' && (
        <>
          <div className="mf-card-row">
            <Toggle
              on={tool === 'depth-picker'}
              onChange={(on) => setTool(on ? 'depth-picker' : 'none')}
              title="Click the photo to centre the range on that distance"
            >
              <Icon name="picker" />
              Pick
            </Toggle>
          </div>
          <DepthPreview c={c} />
          <Slider
            label="Near"
            adjusts={false}
            value={c.near}
            min={0}
            max={100}
            def={0}
            title="The nearest distance the range takes: 0 is the nearest thing in the photo"
            onChange={(v, live) =>
              edit((x) => {
                if (x.kind !== 'depth') return
                x.near = v
                if (x.far < v) x.far = v
              }, live)
            }
            onCommit={() => commit('Depth near')}
          />
          <Slider
            label="Far"
            adjusts={false}
            value={c.far}
            min={0}
            max={100}
            def={33}
            title="The farthest distance the range takes: 100 is the farthest thing in the photo"
            onChange={(v, live) =>
              edit((x) => {
                if (x.kind !== 'depth') return
                x.far = v
                if (x.near > v) x.near = v
              }, live)
            }
            onCommit={() => commit('Depth far')}
          />
          <Slider
            label="Softness"
            adjusts={false}
            value={c.softness}
            min={0}
            max={100}
            def={10}
            title="How gradually the range fades past Near and Far"
            onChange={(v, live) => edit((x) => x.kind === 'depth' && (x.softness = v), live)}
            onCommit={() => commit('Depth softness')}
          />
        </>
      )}
      {hiddenAdjusted(c) && <HiddenChip c={c} />}
    </div>
  )
}

/**
 * An older recipe's setting the panel no longer shows (a feather on a brush,
 * a component opacity, a hardened edge) is still applied: say so, and offer
 * to put it back.
 */
export function HiddenChip({ c }: { c: MaskComponentSetting }): React.JSX.Element {
  return (
    <div className="mf-chip" title="An older edit of this component's edge or opacity is applied">
      <span>Edge adjusted</span>
      <button
        className="sm ghost"
        onClick={() =>
          patchComponent(c.id, 'Reset component edge', (x, l) => {
            const i = l.components.indexOf(x)
            l.components[i] = resetHidden(x)
          })
        }
      >
        Reset
      </button>
    </div>
  )
}

/**
 * The selected mask's own settings, under the list in the masks window: its
 * Amount, and folded away, its blend and opacity. Nothing when no mask is
 * selected. What it does is edited in the panels on the right.
 */
export function SelectedMask(): React.JSX.Element | null {
  const recipe = useDevelop((s) => s.recipe)
  const layerId = useDevelop((s) => s.layerId)
  const commit = useDevelop((s) => s.commit)
  const layer = layerOf(recipe, layerId)
  if (!layer) return null
  return (
    <div className="mf-selected">
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
      <Section id="masks.advanced" title="Advanced" defaultOpen={false}>
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
          title="How much of the blended result shows; with Normal, Amount does the same"
          onChange={(v, live) => changeLayer((l) => (l.opacity = v), live)}
          onCommit={() => commit('Mask opacity')}
        />
      </Section>
    </div>
  )
}
