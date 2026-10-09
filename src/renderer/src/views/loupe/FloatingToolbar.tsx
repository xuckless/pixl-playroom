import { LiquidGlass } from '../../components/glass/LiquidGlass'
import { Icon } from '../../components/icons'
import { ASPECTS, aspectValue } from '../../lib/aspects'
import { flip, resetCrop, rotateLeft, rotateRight, setAspect } from '../../lib/geometry'
import { useDevelop } from '../../state/develop'
import { CROP_GUIDES, useUi, type BrushSlot } from '../../state/ui'
import { addLabel, addPickHint } from '../../lib/addpick'
import { applyGuides } from '../../lib/upright'
import { MAX_GUIDES } from './UprightGuides'
import { withKey } from '../../lib/commands'
import { conceptOf } from '../../../../shared/concepts'
import { cancelObjects, commitObjects } from '../../lib/objects'
import { useObjects, type ObjectsMode } from '../../state/objects'
import { rich, t, tk } from '../../lib/i18n'

/** A compact range for the floating bar: label, rail and value. */
export function BarRange({
  label,
  value,
  min,
  max,
  onChange,
  suffix = ''
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
  suffix?: string
}): React.JSX.Element {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <label className="bar-range">
      <span className="micro">{label}</span>
      <span className="bar-track">
        <span className="bar-fill" style={{ width: `${pct}%` }} />
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </span>
      <span className="t-num bar-value">
        {Math.round(value)}
        {suffix}
      </span>
    </label>
  )
}

function CropBar(): React.JSX.Element | null {
  const aspect = useDevelop((s) => s.recipe?.geometry.aspect ?? null)
  const setTool = useDevelop((s) => s.setTool)
  const guide = useUi((s) => s.cropGuide)
  const setGuide = useUi((s) => s.setCropGuide)
  return (
    <>
      <span className="bar-title micro">{t('Crop')}</span>
      <select
        value={aspectValue(aspect)}
        onChange={(e) => setAspect(e.target.value)}
        title={t('Aspect')}
        aria-label={t('Aspect')}
      >
        {ASPECTS.map((a) => (
          <option key={a.value} value={a.value}>
            {t(a.label)}
          </option>
        ))}
      </select>
      <div
        className="seg"
        role="group"
        aria-label={withKey(t('Guides'), 'crop.guides')}
        title={withKey(t('Guides'), 'crop.guides')}
      >
        {CROP_GUIDES.map((g) => (
          <button
            key={g.value}
            className={guide === g.value ? 'on' : ''}
            onClick={() => setGuide(g.value)}
          >
            {t(g.label)}
          </button>
        ))}
      </div>
      <span className="vsep" />
      <button className="icon" title={t('Rotate left')} onClick={rotateLeft}>
        <Icon name="rotateLeft" />
      </button>
      <button className="icon" title={t('Rotate right')} onClick={rotateRight}>
        <Icon name="rotateRight" />
      </button>
      <button className="icon" title={t('Flip horizontal')} onClick={flip}>
        <Icon name="flip" />
      </button>
      <button className="icon" title={t('Reset crop and straighten')} onClick={resetCrop}>
        <Icon name="reset" />
      </button>
      <span className="vsep" />
      <span className="bar-hint">{t('Drag outside the box to straighten')}</span>
      <button className="primary sm" onClick={() => setTool('none')} title={t('Done (R or Esc)')}>
        <Icon name="check" />
        {t('Done')}
      </button>
    </>
  )
}

function BrushBar(): React.JSX.Element {
  const slot = useUi((s) => s.brushSlot)
  const setSlot = useUi((s) => s.setBrushSlot)
  const brush = useUi((s) => s.brushes[s.brushSlot])
  const setBrush = useUi((s) => s.setBrush)
  return (
    <>
      <span className="bar-title micro">{t('Brush')}</span>
      <div className="seg" role="group" aria-label={t('Brush')}>
        {(['A', 'B', 'erase'] as BrushSlot[]).map((b) => (
          <button
            key={b}
            className={slot === b ? 'on' : ''}
            onClick={() => setSlot(b)}
            title={b === 'erase' ? t('Erase (or hold Alt)') : t('Brush {{slot}}', { slot: b })}
          >
            {b === 'erase' ? t('Erase') : b}
          </button>
        ))}
      </div>
      <BarRange
        label={t('Size')}
        value={brush.size}
        min={4}
        max={500}
        onChange={(size) => setBrush({ size })}
      />
      <BarRange
        label={t('Feather')}
        value={brush.softness}
        min={0}
        max={100}
        onChange={(softness) => setBrush({ softness })}
      />
      <BarRange
        label={t('Flow')}
        value={brush.flow}
        min={1}
        max={100}
        onChange={(flow) => setBrush({ flow })}
      />
      <BarRange
        label={t('Density')}
        value={brush.density}
        min={1}
        max={100}
        onChange={(density) => setBrush({ density })}
      />
      <button
        className={brush.autoMask ? 'on sm' : 'sm'}
        onClick={() => setBrush({ autoMask: !brush.autoMask })}
        title={t('Auto Mask: paint only where the colour matches the colour under the brush')}
      >
        {t('Auto Mask')}
      </button>
      <button
        className={brush.pressure ? 'on sm' : 'sm'}
        onClick={() => setBrush({ pressure: !brush.pressure })}
        title={t("A pen's pressure sets size and flow")}
      >
        {t('Pressure')}
      </button>
      <span className="bar-hint">
        {rich('{{open}} {{close}} size · Alt erases', {
          open: <span className="kbd">[</span>,
          close: <span className="kbd">]</span>
        })}
      </span>
    </>
  )
}

const HINTS: Partial<Record<string, { title: string; hint: string }>> = {
  polygon: {
    title: tk('Lasso'),
    hint: tk('Click corners or drag freehand · ⌫ undo point · Alt subtracts · Esc cancels')
  },
  linear: {
    title: tk('Linear gradient'),
    hint: tk(
      'Drag to draw · Shift keeps to 45° · drag the pin to move, the ends to reshape, the knob to turn'
    )
  },
  bidirectional: {
    title: tk('Bidirectional gradient'),
    hint: tk(
      'Drag out from where it is full · Shift keeps to 45° · drag an end to widen that side, the dot to slide the full line, the knob to turn'
    )
  },
  radial: {
    title: tk('Radial gradient'),
    hint: tk(
      "Drag from the centre · Shift: circle · the ring softens · double-click the pin to fill · ' inverts"
    )
  },
  'wb-picker': {
    title: tk('White balance'),
    hint: tk('Click something that should be neutral grey')
  },
  'range-picker': {
    title: tk('Range'),
    hint: tk('Click the colour or tone the mask should select')
  },
  'point-picker': { title: tk('Point colour'), hint: tk('Click the colour to shift on its own') },
  heal: {
    title: tk('Heal'),
    hint: tk(
      'Click or paint · drag the spot to its source · Alt-click sets a source · ⌫ deletes · [ ] size'
    )
  },
  'fringe-pick': {
    title: tk('Defringe'),
    hint: tk('Click a purple or green fringe along an edge (zoom in to find one)')
  },
  tat: {
    title: tk('Targeted'),
    hint: tk('Press on the photo and drag up or down to move what controls that colour or tone')
  }
}

const OBJECT_MODES: { mode: ObjectsMode; label: string; title: string }[] = [
  { mode: 'auto', label: tk('Auto'), title: tk('Hover to see an object, click to take it') },
  { mode: 'box', label: tk('Box'), title: tk('Drag a box around the object') },
  { mode: 'brush', label: tk('Brush'), title: tk('Brush over the object') }
]

/** The Objects tool: how it points, and Done once something is selected. */
function ObjectsBar(): React.JSX.Element {
  const mode = useObjects((s) => s.mode)
  const setMode = useObjects((s) => s.setMode)
  const target = useObjects((s) => s.target)
  const selected = useObjects((s) => s.plane !== null)
  const busy = useObjects((s) => s.status === 'working' || s.status === 'loading')
  // A class asked for by a click (the Sky tool, Hair, Eyes…).
  const concept = conceptOf(target)
  if (concept)
    return (
      <>
        <span className="bar-title micro">{t(concept.label)}</span>
        <span className="bar-hint">
          {t(concept.ask)} · {t('SAM 2.1 selects it')}
        </span>
        <button className="sm ghost" onClick={cancelObjects} title="Esc">
          {concept.many ? t('Done') : t('Cancel')}
        </button>
      </>
    )
  return (
    <>
      <span className="bar-title micro">{t('Objects')}</span>
      <div className="seg">
        {OBJECT_MODES.map((m) => (
          <button
            key={m.mode}
            className={mode === m.mode ? 'on' : ''}
            title={t(m.title)}
            onClick={() => setMode(m.mode)}
          >
            {t(m.label)}
          </button>
        ))}
      </div>
      <span className="bar-hint">{t('Shift-click adds · Alt-click removes')}</span>
      <button className="sm ghost" onClick={cancelObjects} title="Esc">
        {t('Cancel')}
      </button>
      <button
        className="sm primary"
        disabled={!selected || busy}
        onClick={() => void commitObjects()}
        title="Enter"
      >
        {t('Done')}
      </button>
    </>
  )
}

/** Guided Upright: how many guides, and Apply once there are two. */
function GuideBar(): React.JSX.Element {
  const guides = useDevelop((s) => s.guides)
  const setGuides = useDevelop((s) => s.setGuides)
  const setTool = useDevelop((s) => s.setTool)
  return (
    <>
      <span className="bar-title micro">{t('Guided Upright')}</span>
      <span className="bar-hint">
        {t('Drag along edges that should be upright or level · {{n}}/{{max}} · Alt-click removes', {
          n: guides.length,
          max: MAX_GUIDES
        })}
      </span>
      <button className="sm ghost" disabled={guides.length === 0} onClick={() => setGuides([])}>
        {t('Clear')}
      </button>
      <button className="sm ghost" onClick={() => setTool('none')} title="Esc">
        {t('Cancel')}
      </button>
      <button
        className="sm primary"
        disabled={guides.length < 2}
        onClick={() => void applyGuides()}
      >
        {t('Apply')}
      </button>
    </>
  )
}

/**
 * The bar of whatever tool is working on the picture, floating in glass over
 * its top edge — so opening a tool never resizes the loupe under it.
 */
export function FloatingToolbar(): React.JSX.Element | null {
  const tool = useDevelop((s) => s.tool)
  const setTool = useDevelop((s) => s.setTool)
  const hasPhoto = useDevelop((s) => s.session !== null)
  const addPick = useDevelop((s) => s.addPick)
  const recipe = useDevelop((s) => s.recipe)
  if (tool === 'none' || !hasPhoto) return null
  const hint =
    tool === 'add-pick' && addPick
      ? {
          title: addLabel(recipe, addPick.target),
          hint: addPickHint(addPick.mode, addPick.first !== null, addPick.goalHex ?? null)
        }
      : HINTS[tool] && { title: t(HINTS[tool].title), hint: t(HINTS[tool].hint) }
  return (
    <LiquidGlass className="floating-toolbar" radius={2} bezel={10} key={tool}>
      {tool === 'crop' && <CropBar />}
      {tool === 'upright-guide' && <GuideBar />}
      {tool === 'brush' && <BrushBar />}
      {tool === 'objects' && <ObjectsBar />}
      {hint && (
        <>
          <span className="bar-title micro">{hint.title}</span>
          <span className="bar-hint">{hint.hint}</span>
          <button className="sm ghost" onClick={() => setTool('none')} title="Esc">
            {t('Cancel')}
          </button>
        </>
      )}
    </LiquidGlass>
  )
}
