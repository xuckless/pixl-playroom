/**
 * Playroom's colour tools after DaVinci Resolve's: Curves, Primaries, Log
 * wheels and the Qualifier, as cards. The recipe and the engine's side are
 * shared/resolve.ts.
 */
import { VsPresets } from './VsPresets'
import { useEffect, useState } from 'react'
import { GradeWheel, type WheelScale } from '../components/grading/GradeWheel'
import { CurveEditor } from '../components/editors'
import { Tabs, Toggle, ToolPanel } from '../components/ui'
import { Icon } from '../components/icons'
import { useDevelop } from '../state/develop'
import { t, tk } from '../lib/i18n'
import { useScope } from '../state/scope'
import { AddColourSection, RS, ToneCurveCustom } from './global'
import { TIPS } from './tips'
import { InfoTip } from '../components/InfoTip'
import {
  DEFAULT_PIVOT,
  MAX_QUALIFIERS,
  vsPeriodic,
  type KeyBandSetting,
  type PrimariesSetting,
  type QualifierSetting,
  type VsCurve,
  type Yrgb
} from '../../../shared/resolve'
import type { CurvePointSetting, Recipe } from '../../../shared/recipe'

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
      tip={TIPS[`primaries.${key}`]}
      onChange={(v: Yrgb, live) => edit((r) => (r.primaries[key] = v), live)}
      onCommit={() => commit(`Primaries: ${NAMES[key]}`)}
    />
  )
  return (
    <ToolPanel>
      <RS
        label={tk('Contrast')}
        tip={TIPS['primaries.contrast']}
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
        tip={TIPS['primaries.pivot']}
        read={(r) => r.primaries.pivot}
        write={(r, v) => (r.primaries.pivot = v)}
        min={0}
        max={1}
        step={0.005}
        def={DEFAULT_PIVOT}
        format={(v) => v.toFixed(3)}
      />
      <RS
        label={tk('Sat')}
        tip={TIPS['primaries.sat']}
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
        tip={TIPS['primaries.hue']}
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
        tip={TIPS['primaries.temp']}
        read={(r) => r.primaries.temp}
        write={(r, v) => (r.primaries.temp = v)}
        track={TEMP_TRACK}
      />
      <RS
        label={tk('Tint')}
        tip={TIPS['primaries.tint']}
        read={(r) => r.primaries.tint}
        write={(r, v) => (r.primaries.tint = v)}
        track={TINT_TRACK}
      />
      <RS
        label={tk('Lum Mix')}
        tip={TIPS['primaries.lumMix']}
        read={(r) => r.primaries.lumMix}
        write={(r, v) => (r.primaries.lumMix = v)}
        min={0}
        max={100}
        step={1}
        def={0}
      />
      <div className="gwheels">
        {wheel('lift')}
        {wheel('gamma')}
        {wheel('gain')}
        {wheel('offset')}
      </div>
      <AddColourSection />
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

export function ResolveCurvesBody(): React.JSX.Element | null {
  const { recipe, layer, edit, commit } = useScope()
  const [chosen, setTab] = useState<CurvesTab>('custom')
  if (!recipe) return null
  // The vs curves need colour: on a black-and-white photo they would change
  // nothing (a mask's still can, before the mono conversion).
  const mono = !layer && (recipe.treatment === 'bw' || recipe.profile.kind === 'monochrome')
  const tab = mono ? 'custom' : chosen
  const label = CURVE_TABS.find((x) => x.value === tab)!.label
  if (tab === 'custom')
    return (
      <ToolPanel>
        <Tabs value={tab} onChange={setTab} className="rc-tabs" tabs={tabsOf(mono)} />
        {mono && (
          <p className="muted small">
            {t(
              'Black and white: the vs curves need colour. To set how bright each colour turns, use the B&W mix in HSL.'
            )}
          </p>
        )}
        <ToneCurveCustom />
      </ToolPanel>
    )
  const vs = tab
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
      <div className="row rc-about">
        <span className="micro">{t(label)}</span>
        <InfoTip tip={TIPS[`rcurves.${vs}`]} label={t(label)} />
      </div>
      <VsPresets key={vs} vs={vs} label={label} />
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

/** The tabs, the vs curves greyed out on a black-and-white photo (`mono`). */
function tabsOf(
  mono = false
): { value: CurvesTab; label: string; disabled?: boolean; title?: string }[] {
  return CURVE_TABS.map((x) => ({
    ...x,
    label: t(x.label),
    ...(mono && x.value !== 'custom'
      ? { disabled: true, title: t('Black and white: use the B&W mix in HSL') }
      : {})
  }))
}

// ── Log wheels ───────────────────────────────────────────────────────────────

type LogKey = 'shadow' | 'midtone' | 'highlight' | 'offset'

const LOG_NAMES: Record<LogKey, string> = {
  shadow: tk('Shadow'),
  midtone: tk('Midtone'),
  highlight: tk('Highlight'),
  offset: tk('Offset')
}

/** Log wheels add small amounts: the disc and ring reach less far than the primaries'. */
const LOG_SCALE: WheelScale = { neutral: 0, reach: 0.08, ringStep: 0.0015, min: -1, max: 1 }

export function LogWheelsBody(): React.JSX.Element | null {
  const { recipe, edit, commit } = useScope()
  if (!recipe) return null
  const l = recipe.logWheels
  const wheel = (key: LogKey): React.JSX.Element => (
    <GradeWheel
      key={key}
      label={t(LOG_NAMES[key])}
      value={l[key]}
      scale={LOG_SCALE}
      size={96}
      tip={TIPS[`log.${key}`]}
      onChange={(v: Yrgb, live) => edit((r) => (r.logWheels[key] = v), live)}
      onCommit={() => commit(`Log wheels: ${LOG_NAMES[key]}`)}
    />
  )
  return (
    <ToolPanel>
      <div className="gwheels">
        {wheel('shadow')}
        {wheel('midtone')}
        {wheel('highlight')}
        {wheel('offset')}
      </div>
      <RS
        label={tk('Low range')}
        tip={TIPS['log.low']}
        read={(r) => r.logWheels.low}
        write={(r, v) => (r.logWheels.low = Math.min(v, r.logWheels.high - 0.05))}
        min={0.02}
        max={0.9}
        step={0.001}
        def={0.333}
        format={(v) => v.toFixed(3)}
      />
      <RS
        label={tk('High range')}
        tip={TIPS['log.high']}
        read={(r) => r.logWheels.high}
        write={(r, v) => (r.logWheels.high = Math.max(v, r.logWheels.low + 0.05))}
        min={0.07}
        max={0.98}
        step={0.001}
        def={0.55}
        format={(v) => v.toFixed(3)}
      />
      <p className="muted small">
        {t(
          'Close to Resolve’s, not the same: each range is keyed on brightness with a soft edge until the engine grades in log (it has been asked to).'
        )}
      </p>
    </ToolPanel>
  )
}

// ── Qualifier ────────────────────────────────────────────────────────────────

type BandKey = 'keyHue' | 'keySat' | 'keyLum'

const BAND_TIP = {
  keyHue: 'qualifier.hue',
  keySat: 'qualifier.sat',
  keyLum: 'qualifier.lum'
} as const

const BANDS: { key: BandKey; label: string; top: number; strip: string; step: number }[] = [
  {
    key: 'keyHue',
    label: tk('Hue'),
    top: 360,
    strip: 'linear-gradient(90deg,#f33,#fd3,#3f5,#3ff,#36f,#f3f,#f33)',
    step: 1
  },
  {
    key: 'keySat',
    label: tk('Sat'),
    top: 1,
    strip: 'linear-gradient(90deg,#888,#f44)',
    step: 0.01
  },
  {
    key: 'keyLum',
    label: tk('Lum'),
    top: 1,
    strip: 'linear-gradient(90deg,#000,#fff)',
    step: 0.01
  }
]

/** Where a band selects along its strip: fully inside, fading over its soft edge (a hue band wraps). */
function BandBar({
  band,
  top,
  strip
}: {
  band: KeyBandSetting
  top: number
  strip: string
}): React.JSX.Element {
  const pct = (v: number): number => (v / top) * 100
  const lo = band.centre - band.width / 2
  const hi = band.centre + band.width / 2
  const copies = top === 360 ? [-360, 0, 360] : [0]
  return (
    <div className={`band-bar${band.on ? '' : ' off'}`} style={{ background: strip }}>
      <svg viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id="bb-in" x1="0" x2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset="1" stopColor="#fff" stopOpacity="0.9" />
          </linearGradient>
          <linearGradient id="bb-out" x1="0" x2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.9" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect x={0} y={0} width={100} height={10} fill="rgba(0,0,0,0.55)" />
        {copies.map((o) => (
          <g key={o}>
            <rect
              x={pct(lo - band.soft + o)}
              y={0}
              width={pct(band.soft)}
              height={10}
              fill="url(#bb-in)"
            />
            <rect
              x={pct(lo + o)}
              y={0}
              width={pct(band.width)}
              height={10}
              fill="rgba(255,255,255,0.9)"
            />
            <rect x={pct(hi + o)} y={0} width={pct(band.soft)} height={10} fill="url(#bb-out)" />
          </g>
        ))}
      </svg>
    </div>
  )
}

/** The colour at a qualifier's key centre, for its swatch. */
function swatchOf(q: QualifierSetting): string {
  const l = Math.round(q.keyLum.on ? 25 + q.keyLum.centre * 50 : 50)
  const s = Math.round(q.keyHue.on ? (q.keySat.on ? 40 + q.keySat.centre * 60 : 80) : 0)
  return `hsl(${Math.round(q.keyHue.centre)} ${s}% ${l}%)`
}

export function QualifierBody(): React.JSX.Element | null {
  const { recipe, edit, commit, replace } = useScope()
  const tool = useDevelop((s) => s.tool)
  const setTool = useDevelop((s) => s.setTool)
  const selectedId = useDevelop((s) => s.qualifierId)
  const select = useDevelop((s) => s.setQualifier)
  const keyView = useDevelop((s) => s.keyView)
  const setKeyView = useDevelop((s) => s.setKeyView)
  // The eyedropper goes down, and the key view off, with the card.
  useEffect(
    () => () => {
      const d = useDevelop.getState()
      if (d.tool === 'qualifier-pick') d.setTool('none')
      d.setKeyView(false)
    },
    []
  )
  if (!recipe) return null
  const qs = recipe.qualifiers
  const q = qs.find((x) => x.id === selectedId) ?? qs[qs.length - 1]
  const at = (r: Recipe): QualifierSetting | undefined => r.qualifiers.find((x) => x.id === q?.id)
  const full = qs.length >= MAX_QUALIFIERS
  const remove = (id: string): void => {
    const next = structuredClone(recipe)
    next.qualifiers = next.qualifiers.filter((x) => x.id !== id)
    void replace(next, 'Qualifier: remove')
    if (id === selectedId) select(null)
  }
  return (
    <ToolPanel>
      <div className="row q-head">
        <Toggle
          on={tool === 'qualifier-pick'}
          onChange={(on) => setTool(on ? 'qualifier-pick' : 'none')}
          title={
            full
              ? t('At most {{count}} qualifiers: picking keys the selected one again', {
                  count: MAX_QUALIFIERS
                })
              : t('Click a colour in the photo to key it')
          }
        >
          ⌖ {t('Pick a colour')}
        </Toggle>
        <span className="spacer" />
        <Toggle
          on={keyView}
          onChange={(on) => {
            if (q) select(q.id)
            setKeyView(on)
          }}
          title={t('Show the key: white where the qualifier selects, black where it does not')}
        >
          ◐ {t('Key')}
        </Toggle>
      </div>
      {qs.length === 0 ? (
        <p className="muted small">
          {t('Pick a colour in the photo: the correction below then changes only what is like it.')}
        </p>
      ) : (
        <ul className="q-list">
          {qs.map((x, i) => (
            <li key={x.id} className={x.id === q?.id ? 'on' : ''}>
              <button className="q-pick" onClick={() => select(x.id)}>
                <span className="q-swatch" style={{ background: swatchOf(x) }} />
                <span className="q-name">{t('Qualifier {{n}}', { n: i + 1 })}</span>
              </button>
              <button
                className="icon sm ghost"
                aria-label={x.enabled ? t('Switch off') : t('Switch on')}
                title={x.enabled ? t('Switch off') : t('Switch on')}
                onClick={() => {
                  edit((r) => {
                    const y = r.qualifiers.find((z) => z.id === x.id)
                    if (y) y.enabled = !y.enabled
                  })
                  commit(`Qualifier: ${x.enabled ? 'Off' : 'On'}`)
                }}
              >
                <Icon name={x.enabled ? 'eye' : 'eyeOff'} />
              </button>
              <button
                className="icon sm ghost"
                aria-label={t('Remove')}
                title={t('Remove')}
                onClick={() => remove(x.id)}
              >
                <Icon name="close" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {q && (
        <>
          {BANDS.map((b) => (
            <div key={b.key} className="q-band">
              <label className="check">
                <input
                  type="checkbox"
                  checked={q[b.key].on}
                  onChange={(e) => {
                    edit((r) => {
                      const y = at(r)
                      if (y) y[b.key].on = e.target.checked
                    })
                    commit(`Qualifier: ${b.label}`)
                  }}
                />
                {t(b.label)}
                <InfoTip tip={TIPS[BAND_TIP[b.key]]} label={t(b.label)} />
              </label>
              <BandBar band={q[b.key]} top={b.top} strip={b.strip} />
              {q[b.key].on && (
                <>
                  <RS
                    label={tk('Centre')}
                    read={(r) => at(r)?.[b.key].centre ?? 0}
                    write={(r, v) => {
                      const y = at(r)
                      if (y) y[b.key].centre = v
                    }}
                    min={0}
                    max={b.top}
                    step={b.step}
                    def={q[b.key].centre}
                    format={(v) => (b.top === 360 ? `${Math.round(v)}°` : v.toFixed(2))}
                  />
                  <RS
                    label={tk('Width')}
                    read={(r) => at(r)?.[b.key].width ?? 0}
                    write={(r, v) => {
                      const y = at(r)
                      if (y) y[b.key].width = v
                    }}
                    min={0}
                    max={b.top}
                    step={b.step}
                    def={q[b.key].width}
                    format={(v) => (b.top === 360 ? `${Math.round(v)}°` : v.toFixed(2))}
                  />
                  <RS
                    label={tk('Soft')}
                    read={(r) => at(r)?.[b.key].soft ?? 0}
                    write={(r, v) => {
                      const y = at(r)
                      if (y) y[b.key].soft = v
                    }}
                    min={0}
                    max={b.top / 2}
                    step={b.step}
                    def={q[b.key].soft}
                    format={(v) => (b.top === 360 ? `${Math.round(v)}°` : v.toFixed(2))}
                  />
                </>
              )}
            </div>
          ))}
          <RS
            label={tk('Blur')}
            tip={TIPS['qualifier.blur']}
            read={(r) => at(r)?.blur ?? 0}
            write={(r, v) => {
              const y = at(r)
              if (y) y.blur = v
            }}
            min={0}
            max={100}
            def={20}
          />
          <label className="check">
            <input
              type="checkbox"
              checked={q.invert}
              onChange={(e) => {
                edit((r) => {
                  const y = at(r)
                  if (y) y.invert = e.target.checked
                })
                commit('Qualifier: Invert')
              }}
            />
            {t('Invert the key')}
          </label>
          <div className="row q-correction-head">
            <span className="micro">{t('Correction')}</span>
            <InfoTip tip={TIPS['qualifier.correction']} label={t('Correction')} />
          </div>
          <div className="q-correction">
            <GradeWheel
              label={t('Gain')}
              value={q.gain}
              scale={SCALES.gain}
              size={96}
              onChange={(v: Yrgb, live) =>
                edit((r) => {
                  const y = at(r)
                  if (y) y.gain = v
                }, live)
              }
              onCommit={() => commit('Qualifier: Gain')}
            />
            <div className="q-sliders">
              <RS
                label={tk('Sat')}
                read={(r) => at(r)?.sat ?? 50}
                write={(r, v) => {
                  const y = at(r)
                  if (y) y.sat = v
                }}
                min={0}
                max={100}
                step={0.1}
                def={50}
                format={pct}
              />
              <RS
                label={tk('Hue')}
                read={(r) => at(r)?.hue ?? 50}
                write={(r, v) => {
                  const y = at(r)
                  if (y) y.hue = v
                }}
                min={0}
                max={100}
                step={0.1}
                def={50}
                format={pct}
              />
            </div>
          </div>
        </>
      )}
    </ToolPanel>
  )
}
