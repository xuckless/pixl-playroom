/**
 * DaVinci Resolve's colour tools as cards (Settings → Interface → Colour
 * tools: Resolve). The recipe and the engine's side are shared/resolve.ts.
 */
import { GradeWheel, type WheelScale } from '../components/grading/GradeWheel'
import { ToolPanel } from '../components/ui'
import { t, tk } from '../lib/i18n'
import { useScope } from '../state/scope'
import { RS } from './global'
import type { PrimariesSetting, Yrgb } from '../../../shared/resolve'

type WheelKey = 'lift' | 'gamma' | 'gain' | 'offset'

/** Each wheel's numbers as Resolve shows them, and how far its disc and ring reach. */
const SCALES: Record<WheelKey, WheelScale> = {
  lift: { neutral: 0, reach: 0.25, ringStep: 0.004, min: -1, max: 1 },
  gamma: { neutral: 0, reach: 0.25, ringStep: 0.004, min: -1, max: 1 },
  gain: { neutral: 1, reach: 0.35, ringStep: 0.008, min: 0, max: 4 },
  // Resolve shows Offset about 25: 25 + 100·o.
  offset: {
    neutral: 0,
    reach: 0.12,
    ringStep: 0.002,
    min: -1,
    max: 1,
    show: (v) => 25 + v * 100,
    read: (n) => (n - 25) / 100
  }
}

const NAMES: Record<WheelKey, string> = {
  lift: tk('Lift'),
  gamma: tk('Gamma'),
  gain: tk('Gain'),
  offset: tk('Offset')
}

const pct = (v: number): string => v.toFixed(2)
const TEMP_TRACK = 'linear-gradient(90deg,#5b8cff,#fff,#ffb44d)'
const TINT_TRACK = 'linear-gradient(90deg,#4dff6a,#fff,#ff4de1)'

export function PrimariesBody(): React.JSX.Element | null {
  const { recipe, edit, commit } = useScope()
  if (!recipe) return null
  const p: PrimariesSetting = recipe.primaries
  const wheel = (key: WheelKey): React.JSX.Element => (
    <GradeWheel
      key={key}
      label={t(NAMES[key])}
      value={p[key]}
      scale={SCALES[key]}
      size={96}
      onChange={(v: Yrgb, live) => edit((r) => (r.primaries[key] = v), live)}
      onCommit={() => commit(`Primaries: ${NAMES[key]}`)}
    />
  )
  return (
    <ToolPanel>
      <RS
        label={tk('Contrast')}
        read={(r) => r.primaries.contrast}
        write={(r, v) => (r.primaries.contrast = v)}
        min={0}
        max={2}
        step={0.01}
        def={1}
        format={(v) => v.toFixed(3)}
      />
      <RS
        label={tk('Pivot')}
        read={(r) => r.primaries.pivot}
        write={(r, v) => (r.primaries.pivot = v)}
        min={0}
        max={1}
        step={0.005}
        def={0.435}
        format={(v) => v.toFixed(3)}
      />
      <RS
        label={tk('Sat')}
        read={(r) => r.primaries.saturation}
        write={(r, v) => (r.primaries.saturation = v)}
        min={0}
        max={100}
        step={0.1}
        def={50}
        format={pct}
      />
      <RS
        label={tk('Hue')}
        read={(r) => r.primaries.hue}
        write={(r, v) => (r.primaries.hue = v)}
        min={0}
        max={100}
        step={0.1}
        def={50}
        format={pct}
      />
      <RS
        label={tk('Temp')}
        read={(r) => r.primaries.temp}
        write={(r, v) => (r.primaries.temp = v)}
        track={TEMP_TRACK}
      />
      <RS
        label={tk('Tint')}
        read={(r) => r.primaries.tint}
        write={(r, v) => (r.primaries.tint = v)}
        track={TINT_TRACK}
      />
      <div className="gwheels">
        {wheel('lift')}
        {wheel('gamma')}
        {wheel('gain')}
        {wheel('offset')}
      </div>
    </ToolPanel>
  )
}
