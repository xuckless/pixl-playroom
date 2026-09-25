import { LiquidGlass } from '../../components/glass/LiquidGlass'
import { Icon } from '../../components/icons'
import { ASPECTS, aspectValue } from '../../lib/aspects'
import { flip, resetCrop, rotateLeft, rotateRight, setAspect } from '../../lib/geometry'
import { useDevelop } from '../../state/develop'
import { CROP_GUIDES, useUi, type BrushSlot } from '../../state/ui'

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
      <span className="bar-title micro">Crop</span>
      <select
        value={aspectValue(aspect)}
        onChange={(e) => setAspect(e.target.value)}
        title="Aspect"
        aria-label="Aspect"
      >
        {ASPECTS.map((a) => (
          <option key={a.value} value={a.value}>
            {a.label}
          </option>
        ))}
      </select>
      <div className="seg" role="group" aria-label="Guides (O)" title="Guides (O)">
        {CROP_GUIDES.map((g) => (
          <button
            key={g.value}
            className={guide === g.value ? 'on' : ''}
            onClick={() => setGuide(g.value)}
          >
            {g.label}
          </button>
        ))}
      </div>
      <span className="vsep" />
      <button className="icon" title="Rotate left" onClick={rotateLeft}>
        <Icon name="rotateLeft" />
      </button>
      <button className="icon" title="Rotate right" onClick={rotateRight}>
        <Icon name="rotateRight" />
      </button>
      <button className="icon" title="Flip horizontal" onClick={flip}>
        <Icon name="flip" />
      </button>
      <button className="icon" title="Reset crop and straighten" onClick={resetCrop}>
        <Icon name="reset" />
      </button>
      <span className="vsep" />
      <span className="bar-hint">Drag outside the box to straighten</span>
      <button className="primary sm" onClick={() => setTool('none')} title="Done (R or Esc)">
        <Icon name="check" />
        Done
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
      <span className="bar-title micro">Brush</span>
      <div className="seg" role="group" aria-label="Brush">
        {(['A', 'B', 'erase'] as BrushSlot[]).map((b) => (
          <button
            key={b}
            className={slot === b ? 'on' : ''}
            onClick={() => setSlot(b)}
            title={b === 'erase' ? 'Erase (or hold Alt)' : `Brush ${b}`}
          >
            {b === 'erase' ? 'Erase' : b}
          </button>
        ))}
      </div>
      <BarRange
        label="Size"
        value={brush.size}
        min={4}
        max={500}
        onChange={(size) => setBrush({ size })}
      />
      <BarRange
        label="Feather"
        value={brush.softness}
        min={0}
        max={100}
        onChange={(softness) => setBrush({ softness })}
      />
      <BarRange
        label="Flow"
        value={brush.flow}
        min={1}
        max={100}
        onChange={(flow) => setBrush({ flow })}
      />
      <BarRange
        label="Density"
        value={brush.density}
        min={1}
        max={100}
        onChange={(density) => setBrush({ density })}
      />
      <button
        className={brush.autoMask ? 'on sm' : 'sm'}
        onClick={() => setBrush({ autoMask: !brush.autoMask })}
        title="Auto Mask: paint only where the colour matches the colour under the brush"
      >
        Auto Mask
      </button>
      <button
        className={brush.pressure ? 'on sm' : 'sm'}
        onClick={() => setBrush({ pressure: !brush.pressure })}
        title="A pen's pressure sets size and flow"
      >
        Pressure
      </button>
      <span className="bar-hint">
        <span className="kbd">[</span> <span className="kbd">]</span> size · Alt erases
      </span>
    </>
  )
}

const HINTS: Partial<Record<string, { title: string; hint: string }>> = {
  polygon: {
    title: 'Lasso',
    hint: 'Click points · click the first or double-click to close · Alt subtracts · Esc cancels'
  },
  linear: {
    title: 'Linear gradient',
    hint: 'Drag to draw · Shift keeps to 45° · drag the pin to move, the ends to reshape, the knob to turn'
  },
  radial: {
    title: 'Radial gradient',
    hint: 'Drag out from the centre · Shift draws a circle · the handles reshape, the knob turns'
  },
  'wb-picker': { title: 'White balance', hint: 'Click something that should be neutral grey' },
  'range-picker': { title: 'Range', hint: 'Click the colour or tone the mask should select' }
}

/**
 * The bar of whatever tool is working on the picture, floating in glass over
 * its top edge — so opening a tool never resizes the loupe under it.
 */
export function FloatingToolbar(): React.JSX.Element | null {
  const tool = useDevelop((s) => s.tool)
  const setTool = useDevelop((s) => s.setTool)
  const hasPhoto = useDevelop((s) => s.session !== null)
  if (tool === 'none' || !hasPhoto) return null
  const hint = HINTS[tool]
  return (
    <LiquidGlass className="floating-toolbar" radius={2} bezel={10} key={tool}>
      {tool === 'crop' && <CropBar />}
      {tool === 'brush' && <BrushBar />}
      {hint && (
        <>
          <span className="bar-title micro">{hint.title}</span>
          <span className="bar-hint">{hint.hint}</span>
          <button className="sm ghost" onClick={() => setTool('none')} title="Esc">
            Cancel
          </button>
        </>
      )}
    </LiquidGlass>
  )
}
