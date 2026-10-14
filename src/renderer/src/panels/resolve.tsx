/**
 * DaVinci Resolve's colour tools as cards (Settings → Interface → Colour
 * tools: Resolve). The recipe and the engine's side are shared/resolve.ts.
 */
import { useState } from 'react'
import { GradeWheel, type WheelScale } from '../components/grading/GradeWheel'
import { CurveEditor } from '../components/editors'
import { Tabs, ToolPanel } from '../components/ui'
import { useDevelop, type CurveChannel } from '../state/develop'
import { t, tk } from '../lib/i18n'
import { useScope } from '../state/scope'
import { RS } from './global'
import {
  VS_WAITING,
  vsPeriodic,
  type PrimariesSetting,
  type VsCurve,
  type Yrgb
} from '../../../shared/resolve'
import type { CurvePointSetting } from '../../../shared/recipe'

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

// ── Curves ───────────────────────────────────────────────────────────────────

type CurvesTab = 'custom' | VsCurve

const CURVE_TABS: { value: CurvesTab; label: string }[] = [
  { value: 'custom', label: tk('Custom') },
  { value: 'hueHue', label: tk('Hue vs Hue') },
  { value: 'hueSat', label: tk('Hue vs Sat') },
  { value: 'hueLum', label: tk('Hue vs Lum') },
  { value: 'lumSat', label: tk('Lum vs Sat') },
  { value: 'satSat', label: tk('Sat vs Sat') }
]

const HUES = 'linear-gradient(90deg,#f33,#fd3,#3f5,#3ff,#36f,#f3f,#f33)'
const STRIP: Record<VsCurve, string> = {
  hueHue: HUES,
  hueSat: HUES,
  hueLum: HUES,
  lumSat: 'linear-gradient(90deg,#000,#fff)',
  satSat: 'linear-gradient(90deg,#808080,#f33)'
}

/** Resolve's six quick picks on a hue curve: red, yellow, green, cyan, blue, magenta. */
const SWATCHES = [
  { at: 0, colour: '#ff4040' },
  { at: 1 / 6, colour: '#ffe040' },
  { at: 1 / 3, colour: '#40ff60' },
  { at: 1 / 2, colour: '#40ffff' },
  { at: 2 / 3, colour: '#4070ff' },
  { at: 5 / 6, colour: '#ff40ff' }
]

const CHANNEL_COLOUR: Record<CurveChannel, string> = {
  master: '#c9bdf7',
  red: '#ff5a5a',
  green: '#5aff78',
  blue: '#5a8cff'
}

export function ResolveCurvesBody(): React.JSX.Element | null {
  const { recipe, edit, commit } = useScope()
  const [tab, setTab] = useState<CurvesTab>('custom')
  const channel = useDevelop((s) => s.curveChannel)
  const setChannel = useDevelop((s) => s.setCurveChannel)
  if (!recipe) return null
  const label = CURVE_TABS.find((x) => x.value === tab)!.label
  if (tab === 'custom')
    return (
      <ToolPanel>
        <Tabs value={tab} onChange={setTab} className="rc-tabs" tabs={tabsOf()} />
        <div className="row rc-channels">
          <Tabs
            value={channel}
            onChange={setChannel}
            tabs={[
              { value: 'master', label: 'Y' },
              { value: 'red', label: 'R' },
              { value: 'green', label: 'G' },
              { value: 'blue', label: 'B' }
            ]}
          />
        </div>
        <CurveEditor
          points={recipe.toneCurve[channel]}
          colour={CHANNEL_COLOUR[channel]}
          onChange={(p: CurvePointSetting[], live) => edit((r) => (r.toneCurve[channel] = p), live)}
          onCommit={() => commit(`Curves: Custom (${channel})`)}
        />
        <p className="muted small">{t('The same curve as the Tone curve card’s point curve.')}</p>
      </ToolPanel>
    )
  const vs = tab
  const waiting = VS_WAITING[vs]
  const periodic = vsPeriodic(vs)
  const pts = recipe.curvesVs[vs]
  const addAt = (h: number): void => {
    // Three points on the line, the middle one at the hue: drag it to move that hue alone.
    const wrap = (x: number): number => ((x % 1) + 1) % 1
    const next = [...pts]
    for (const x of [h - 1 / 12, h, h + 1 / 12].map(wrap))
      if (!next.some((p) => Math.abs(p.x - x) < 0.01)) next.push({ x, y: 0.5 })
    edit((r) => (r.curvesVs[vs] = next.sort((a, b) => a.x - b.x)))
    commit(`Curves: ${label}`)
  }
  return (
    <ToolPanel>
      <Tabs value={tab} onChange={setTab} className="rc-tabs" tabs={tabsOf()} />
      {waiting && (
        <p className="rc-waiting">
          {t('Waiting for the engine')} ({waiting}):{' '}
          {t('the curve is kept with the photo and applies once the engine has it.')}
        </p>
      )}
      <CurveEditor
        vs
        periodic={periodic}
        background={STRIP[vs]}
        points={pts}
        colour="#e8e6f2"
        onChange={(p: CurvePointSetting[], live) => edit((r) => (r.curvesVs[vs] = p), live)}
        onCommit={() => commit(`Curves: ${label}`)}
      />
      <div className="row rc-foot">
        {periodic &&
          SWATCHES.map((s) => (
            <button
              key={s.at}
              className="rc-swatch"
              style={{ background: s.colour }}
              aria-label={t('Add points at this hue')}
              title={t('Add points at this hue')}
              onClick={() => addAt(s.at)}
            />
          ))}
        <span className="spacer" />
        <button
          className="sm"
          disabled={pts.length === 0}
          onClick={() => {
            edit((r) => (r.curvesVs[vs] = []))
            commit(`Reset ${label}`)
          }}
        >
          {t('Reset')}
        </button>
      </div>
    </ToolPanel>
  )
}

function tabsOf(): { value: CurvesTab; label: string }[] {
  return CURVE_TABS.map((x) => ({ ...x, label: t(x.label) }))
}
