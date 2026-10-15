import type { BlendMode, KeyBand } from '../../../../shared/engine-types'
import { normaliseEdge, type MaskEdge } from '../../../../shared/maskedge'
import {
  componentControls,
  fromModel,
  hiddenAdjusted,
  resetHidden
} from '../../../../shared/maskcontrols'
import {
  defaultEdgeRadius,
  edgeShaping,
  EDGE_RADIUS_MAX,
  EDGE_RADIUS_MIN
} from '../../../../shared/refine'
import type { MaskComponentSetting, MaskRefine } from '../../../../shared/recipe'
import type { Tip } from '../../components/InfoTip'
import { shownRings } from '../../../../shared/faceparts'
import { Icon } from '../../components/icons'
import { Section, Select, Slider, Toggle } from '../../components/ui'
import { useDevelop } from '../../state/develop'
import { changeLayer, layerOf, patchComponent } from './model'
import { findObject } from '../../lib/objects'
import { ensureModel } from '../../lib/ensureModel'
import { t, tk, tp } from '../../lib/i18n'
import { BandBar } from './BandBar'
import { DepthPreview } from './DepthPreview'
import { RefineControls } from './RefineControls'

/** The drawn edge's (i)s (engine 0.19.2, Photoshop's Select and Mask). */
const EDGE_TIPS: Record<'smooth' | 'contrast' | 'shift', Tip> = {
  smooth: {
    what: tk('Takes the jaggies and specks out of the outline, and keeps it hard.'),
    expect: tk('A cleaner, rounder outline. Small corners and notches smooth away first.'),
    tip: tk('Only on drawn edges: on an AI mask it would turn a soft area into a hard blob.')
  },
  contrast: {
    what: tk('Hardens a soft edge about its middle.'),
    expect: tk('At 100 the edge is a hard cut with no fade.'),
    tip: tk('Only on drawn edges: on an AI mask, use Snap to edges and Feather instead.')
  },
  shift: {
    what: tk('Moves the edge out (+) or in (−), up to 3% of the photo’s shorter side.'),
    expect: tk('The whole outline grows or shrinks by the same amount all the way round.')
  }
}

/** Smooth or Contrast set, kept only while it changes something. */
function setOrDrop(x: MaskComponentSetting, key: 'smooth' | 'contrast', v: number): void {
  if (Math.round(v) > 0) x[key] = Math.round(v)
  else delete x[key]
}

const BLENDS: { value: BlendMode; label: string }[] = [
  { value: 'Normal', label: tk('Normal') },
  { value: 'Multiply', label: tk('Multiply') },
  { value: 'Screen', label: tk('Screen') },
  { value: 'Overlay', label: tk('Overlay') },
  { value: 'SoftLight', label: tk('SoftLight') },
  { value: 'HardLight', label: tk('HardLight') },
  { value: 'Darken', label: tk('Darken') },
  { value: 'Lighten', label: tk('Lighten') },
  { value: 'Difference', label: tk('Difference') },
  { value: 'Add', label: tk('Add') }
]

type Axis = 'hue' | 'saturation' | 'luma'

const AXES: { axis: Axis; label: string; max: number; def: KeyBand }[] = [
  { axis: 'hue', label: tk('Hue'), max: 360, def: { centre: 210, width: 40, softness: 25 } },
  {
    axis: 'saturation',
    label: tk('Saturation'),
    max: 1,
    def: { centre: 0.6, width: 0.8, softness: 0.2 }
  },
  { axis: 'luma', label: tk('Luminance'), max: 1, def: { centre: 0.5, width: 0.4, softness: 0.15 } }
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
  const radiusDef = defaultEdgeRadius(c)
  // A painted stroke snaps to the object SAM finds under it (main/brushes.ts).
  const stroke = c.kind === 'brush' && !c.source
  // Snap to edges: a model's mask lets the snap firm its edge, in place of
  // an older recipe's harden.
  const setRefine = (fn: (r: MaskRefine) => MaskRefine, live = false): Promise<boolean> => {
    const was = c.refine?.on === true
    const apply = (): void =>
      edit((x) => {
        const next = fn(x.refine ?? { on: false, radius: radiusDef })
        // A stroke turned on snaps to its object first: a light refine on it, whatever it was.
        if (next.on && !was && stroke) next.radius = radiusDef
        x.refine = next
        if (next.on && fromModel(x) && x.edge) {
          const e = normaliseEdge({ ...x.edge, harden: 0 })
          if (e) x.edge = e
          else delete x.edge
        }
      }, live)
    // SAM offered first when a stroke turns on and it is not here; without it nothing changes.
    if (!was && stroke && fn(c.refine ?? { on: false, radius: radiusDef }).on)
      return ensureModel('prompt', t('Snap to edges')).then((ok) => {
        if (ok) apply()
        return ok
      })
    apply()
    return Promise.resolve(true)
  }
  // A face part found on several faces: all of them, or one (left to right).
  const faces = c.kind === 'polygon' ? (c.found?.faces.length ?? 0) : 0
  const setFace = (v: string): void => {
    const face = v === 'all' ? null : Number(v)
    edit((x) => {
      if (x.kind !== 'polygon' || !x.found) return
      x.found = { ...x.found, face }
      const [first, ...rings] = shownRings(x.found)
      x.points = first
      if (rings.length) x.rings = rings
      else delete x.rings
    })
    commit(face === null ? tk('Every face') : `Face ${face + 1}`)
  }
  return (
    <div className="mf-card">
      {c.kind === 'polygon' && c.found && faces > 1 && (
        <Select
          label={t('Faces')}
          value={c.found.face === null ? 'all' : String(c.found.face)}
          title={t('Which face this mask takes: every face found, or one, numbered left to right')}
          options={[
            { value: 'all', label: tp('All {{count}} face', 'All {{count}} faces', faces) },
            ...c.found.faces.map((_, i) => ({
              value: String(i),
              label: t('Face {{n}}', { n: i + 1 })
            }))
          ]}
          onChange={setFace}
        />
      )}
      {show.snap && (
        <>
          <RefineControls
            c={c}
            radiusDef={radiusDef}
            radiusMin={EDGE_RADIUS_MIN}
            radiusMax={EDGE_RADIUS_MAX}
            setRefine={setRefine}
            commit={(label) => commit(label)}
          />
          {c.kind === 'polygon' && (
            <div className="mf-card-row">
              <button
                className="sm ghost"
                disabled={c.points.length < 3}
                title={t(
                  'Find the object inside this outline (SAM 2.1) and use its own edges instead'
                )}
                onClick={() => void findObject(c.id)}
              >
                <Icon name="objects" />
                {t('Find object')}
              </button>
            </div>
          )}
        </>
      )}
      {edgeShaping(c) && (
        <>
          <Slider
            label={t('Smooth')}
            adjusts={false}
            value={c.smooth ?? 0}
            min={0}
            max={100}
            def={0}
            tip={EDGE_TIPS.smooth}
            onChange={(v, live) => edit((x) => setOrDrop(x, 'smooth', v), live)}
            onCommit={() => commit(tk('Smooth edge'))}
          />
          <Slider
            label={t('Contrast')}
            adjusts={false}
            value={c.contrast ?? 0}
            min={0}
            max={100}
            def={0}
            tip={EDGE_TIPS.contrast}
            onChange={(v, live) => edit((x) => setOrDrop(x, 'contrast', v), live)}
            onCommit={() => commit(tk('Edge contrast'))}
          />
        </>
      )}
      {show.feather && (
        <Slider
          label={t('Feather')}
          adjusts={false}
          value={c.feather}
          min={0}
          max={100}
          def={c.kind === 'polygon' ? 3 : 0}
          onChange={(v, live) => edit((x) => (x.feather = v), live)}
          onCommit={() => commit(tk('Feather'))}
        />
      )}
      {show.shift && (
        <Slider
          label={t('Shift edge')}
          adjusts={false}
          value={c.edge?.shift ?? 0}
          min={-100}
          max={100}
          def={0}
          tip={EDGE_TIPS.shift}
          onChange={(v, live) => setEdge({ shift: v }, live)}
          onCommit={() => commit(tk('Shift edge'))}
        />
      )}
      {show.softness && c.kind === 'radial' && (
        <Slider
          label={t('Feather')}
          adjusts={false}
          value={c.softness}
          min={0}
          max={100}
          def={50}
          title={t('How much of the radius fades out')}
          onChange={(v, live) => edit((x) => x.kind === 'radial' && (x.softness = v), live)}
          onCommit={() => commit(tk('Radial feather'))}
        />
      )}
      {show.range && c.kind === 'range' && (
        <>
          <div className="mf-card-row">
            <Toggle
              on={tool === 'range-picker'}
              onChange={(on) => setTool(on ? 'range-picker' : 'none')}
              title={t('Click the photo to centre this range on that colour or tone')}
            >
              <Icon name="picker" />
              {t('Pick')}
            </Toggle>
          </div>
          {AXES.map((a) => (
            <BandBar
              key={a.axis}
              axis={a.axis}
              label={t(a.label)}
              band={c[a.axis]}
              max={a.max}
              def={a.def}
              onChange={(band) => edit((x) => x.kind === 'range' && (x[a.axis] = band), true)}
              onCommit={() => commit(`Range ${a.label}`)}
            />
          ))}
          <Slider
            label={t('Smoothness')}
            adjusts={false}
            value={c.smoothness}
            min={0}
            max={100}
            def={0}
            onChange={(v, live) => edit((x) => x.kind === 'range' && (x.smoothness = v), live)}
            onCommit={() => commit(tk('Range smoothness'))}
          />
        </>
      )}
      {show.depth && c.kind === 'depth' && (
        <>
          <div className="mf-card-row">
            <Toggle
              on={tool === 'depth-picker'}
              onChange={(on) => setTool(on ? 'depth-picker' : 'none')}
              title={t('Click the photo to centre the range on that distance')}
            >
              <Icon name="picker" />
              {t('Pick')}
            </Toggle>
          </div>
          <DepthPreview c={c} />
          <Slider
            label={t('Near')}
            adjusts={false}
            value={c.near}
            min={0}
            max={100}
            def={0}
            title={t('The nearest distance the range takes: 0 is the nearest thing in the photo')}
            onChange={(v, live) =>
              edit((x) => {
                if (x.kind !== 'depth') return
                x.near = v
                if (x.far < v) x.far = v
              }, live)
            }
            onCommit={() => commit(tk('Depth near'))}
          />
          <Slider
            label={t('Far')}
            adjusts={false}
            value={c.far}
            min={0}
            max={100}
            def={33}
            title={t(
              'The farthest distance the range takes: 100 is the farthest thing in the photo'
            )}
            onChange={(v, live) =>
              edit((x) => {
                if (x.kind !== 'depth') return
                x.far = v
                if (x.near > v) x.near = v
              }, live)
            }
            onCommit={() => commit(tk('Depth far'))}
          />
          <Slider
            label={t('Softness')}
            adjusts={false}
            value={c.softness}
            min={0}
            max={100}
            def={10}
            title={t('How gradually the range fades past Near and Far')}
            onChange={(v, live) => edit((x) => x.kind === 'depth' && (x.softness = v), live)}
            onCommit={() => commit(tk('Depth softness'))}
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
    <div
      className="mf-chip"
      title={t('An older edit of this component’s edge or opacity is applied')}
    >
      <span>{t('Edge adjusted')}</span>
      <button
        className="sm ghost"
        onClick={() =>
          patchComponent(c.id, tk('Reset component edge'), (x, l) => {
            const i = l.components.indexOf(x)
            l.components[i] = resetHidden(x)
          })
        }
      >
        {t('Reset')}
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
        label={t('Amount')}
        value={layer.amount ?? 100}
        min={0}
        max={200}
        def={100}
        format={(v) => `${Math.round(v)}%`}
        onChange={(v, live) => changeLayer((l) => (l.amount = v), live)}
        onCommit={() => commit(`${layer.name}: amount`)}
      />
      <Section id="masks.advanced" title={t('Advanced')} defaultOpen={false}>
        <Select
          label={t('Blend')}
          value={layer.blend}
          options={BLENDS.map((b) => ({ value: b.value, label: t(b.label) }))}
          onChange={(b) => {
            changeLayer((l) => (l.blend = b))
            commit(tk('Mask blend'))
          }}
        />
        <Slider
          label={t('Opacity')}
          value={layer.opacity}
          min={0}
          max={100}
          def={100}
          title={t('How much of the blended result shows; with Normal, Amount does the same')}
          onChange={(v, live) => changeLayer((l) => (l.opacity = v), live)}
          onCommit={() => commit(tk('Mask opacity'))}
        />
      </Section>
    </div>
  )
}
