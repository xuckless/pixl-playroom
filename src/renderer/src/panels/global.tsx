import { useEffect, useState } from 'react'
import { absoluteWb, orientedFrame } from '../../../shared/compile'
import type { LutProfile } from '../../../shared/ipc'
import {
  HSL_BANDS,
  HSL_BAND_CENTRES,
  type CurvePointSetting,
  type HslBand,
  type ProfileRef,
  type Recipe
} from '../../../shared/recipe'
import { WB_PRESETS } from '../../../shared/wb'
import { ColorWheel, CurveEditor } from '../components/editors'
import { Section, Select, Slider, Tabs, Toggle } from '../components/ui'
import { api, errorText } from '../lib/api'
import { useDevelop } from '../state/develop'
import { useLibrary } from '../state/library'

type Read = (r: Recipe) => number
type Write = (r: Recipe, v: number) => void

/** A slider bound to one number in the recipe. */
function RS({
  label,
  read,
  write,
  min = -100,
  max = 100,
  step = 1,
  def = 0,
  format,
  track,
  title,
  onGesture
}: {
  label: string
  read: Read
  write: Write
  /** Told when a drag of this slider starts (true) and settles (false). */
  onGesture?: (active: boolean) => void
  min?: number
  max?: number
  step?: number
  def?: number
  format?: (v: number) => string
  track?: string
  title?: string
}): React.JSX.Element | null {
  const recipe = useDevelop((s) => s.recipe)
  const edit = useDevelop((s) => s.edit)
  const commit = useDevelop((s) => s.commit)
  if (!recipe) return null
  return (
    <Slider
      label={label}
      value={read(recipe)}
      min={min}
      max={max}
      step={step}
      def={def}
      format={format}
      track={track}
      title={title}
      onChange={(v, live) => {
        if (live) onGesture?.(true)
        edit((r) => write(r, v), live)
      }}
      onCommit={() => {
        onGesture?.(false)
        commit(label)
      }}
    />
  )
}

// ── Basic ────────────────────────────────────────────────────────────────────

/** A white balance the user saved, to reuse on other photos. */
interface SavedWb {
  name: string
  /** Absolute Kelvin and tint units (a RAW) or relative sliders (anything else). */
  absolute: boolean
  temperature: number
  tint: number
}

const WB_PRESETS_KEY = 'wb.presets'

const PROFILE_LABELS: Record<string, string> = {
  neutral: 'Neutral',
  standard: 'Playroom Standard',
  vivid: 'Vivid',
  monochrome: 'Monochrome'
}

function ProfileRow(): React.JSX.Element | null {
  const recipe = useDevelop((s) => s.recipe)
  const replace = useDevelop((s) => s.replace)
  const [luts, setLuts] = useState<LutProfile[]>([])
  useEffect(() => {
    void api.presets.luts().then(setLuts)
  }, [])
  if (!recipe) return null
  const current = recipe.profile.kind === 'lut' ? `lut:${recipe.profile.path}` : recipe.profile.kind
  const choose = async (v: string): Promise<void> => {
    let profile: ProfileRef
    if (v === 'import') {
      try {
        const added = await api.presets.importLut()
        const all = await api.presets.luts()
        setLuts(all)
        if (added.length === 0) return
        profile = { kind: 'lut', name: added[0].name, path: added[0].path }
      } catch (err) {
        useLibrary.getState().say(errorText(err), 'error')
        return
      }
    } else if (v.startsWith('lut:')) {
      const path = v.slice(4)
      profile = { kind: 'lut', name: luts.find((l) => l.path === path)?.name ?? 'LUT', path }
    } else profile = { kind: v } as ProfileRef
    replace(
      { ...recipe, profile },
      `Profile: ${profile.kind === 'lut' ? profile.name : PROFILE_LABELS[profile.kind]}`
    )
  }
  return (
    <>
      <Select
        label="Profile"
        value={current}
        onChange={(v) => void choose(v)}
        options={[
          ...Object.entries(PROFILE_LABELS).map(([value, label]) => ({ value, label })),
          ...luts.map((l) => ({ value: `lut:${l.path}`, label: `LUT · ${l.name}` })),
          { value: 'import', label: 'Import .cube…' }
        ]}
      />
      {recipe.profile.kind === 'lut' && (
        <RS
          label="Amount"
          read={(r) => r.profileAmount}
          write={(r, v) => (r.profileAmount = v)}
          min={0}
          max={100}
          def={100}
        />
      )}
    </>
  )
}

function WhiteBalanceRows(): React.JSX.Element | null {
  const session = useDevelop((s) => s.session)
  const recipe = useDevelop((s) => s.recipe)
  const replace = useDevelop((s) => s.replace)
  const tool = useDevelop((s) => s.tool)
  const setTool = useDevelop((s) => s.setTool)
  const [saved, setSaved] = useState<SavedWb[]>([])
  const [naming, setNaming] = useState<string | null>(null)
  useEffect(() => {
    void api.app.getSetting<SavedWb[]>(WB_PRESETS_KEY).then((v) => setSaved(v ?? []))
  }, [])
  if (!session || !recipe) return null
  const abs = absoluteWb({ isRaw: session.isRaw, asShot: session.asShot })
  // Saved presets are in the units they were made in: absolute Kelvin for a
  // RAW with an as-shot white, relative sliders for everything else.
  const mine = saved.filter((p) => p.absolute === abs)
  const saveCurrent = async (name: string): Promise<void> => {
    const entry: SavedWb = {
      name,
      absolute: abs,
      temperature: Math.round(shownTemp),
      tint: Math.round(shownTint)
    }
    const next = [...saved.filter((p) => !(p.name === name && p.absolute === abs)), entry]
    setSaved(next)
    await api.app.setSetting(WB_PRESETS_KEY, next)
    useLibrary.getState().say(`Saved white balance "${name}"`)
  }
  const shot = session.asShot
  const shownTemp =
    recipe.wb.mode === 'as-shot'
      ? abs && shot
        ? shot.temperature_kelvin
        : 0
      : recipe.wb.temperature
  const shownTint =
    recipe.wb.mode === 'as-shot' ? (abs && shot ? shot.tint * 3000 : 0) : recipe.wb.tint
  const custom = (r: Recipe, t: number, n: number): void => {
    r.wb = { mode: 'custom', temperature: t, tint: n, preset: null }
  }
  const choose = async (v: string): Promise<void> => {
    if (v === 'as-shot')
      replace(
        { ...recipe, wb: { mode: 'as-shot', temperature: 0, tint: 0, preset: null } },
        'White balance: As shot'
      )
    else if (v === 'auto') {
      try {
        const wb = await api.develop.autoWb(session.key)
        if (!wb)
          return useLibrary
            .getState()
            .say('Auto white balance found no neutral to work from', 'error')
        replace(
          {
            ...recipe,
            wb: { mode: 'custom', temperature: wb.temperature, tint: wb.tint, preset: 'auto' }
          },
          'White balance: Auto'
        )
        if (wb.clamped) useLibrary.getState().say('Auto white balance reached the end of the range')
      } catch (err) {
        useLibrary.getState().say(errorText(err), 'error')
      }
    } else if (v.startsWith('mine:')) {
      const p = mine.find((x) => x.name === v.slice(5))
      if (p)
        replace(
          {
            ...recipe,
            wb: { mode: 'custom', temperature: p.temperature, tint: p.tint, preset: v }
          },
          `White balance: ${p.name}`
        )
    } else if (v === 'save') {
      setNaming('')
    } else {
      const p = WB_PRESETS.find((x) => x.name === v)
      if (p)
        replace(
          {
            ...recipe,
            wb: { mode: 'custom', temperature: p.kelvin, tint: p.tintUnits, preset: p.name }
          },
          `White balance: ${p.name}`
        )
    }
  }
  const presetValue = recipe.wb.mode === 'as-shot' ? 'as-shot' : (recipe.wb.preset ?? 'custom')
  return (
    <>
      <div className="row">
        <Select
          label="WB"
          value={presetValue}
          onChange={(v) => void choose(v)}
          options={[
            { value: 'as-shot', label: 'As shot' },
            { value: 'auto', label: 'Auto' },
            { value: 'custom', label: 'Custom' },
            ...(abs ? WB_PRESETS.map((p) => ({ value: p.name, label: p.name })) : []),
            ...mine.map((p) => ({ value: `mine:${p.name}`, label: `★ ${p.name}` })),
            { value: 'save', label: 'Save current as preset…' }
          ]}
        />
        <Toggle
          on={tool === 'wb-picker'}
          onChange={(on) => setTool(on ? 'wb-picker' : 'none')}
          title="Pick a neutral in the photo (W)"
        >
          ⌖ Pick
        </Toggle>
      </div>
      {naming !== null && (
        <div className="row">
          <input
            className="name"
            autoFocus
            placeholder="Preset name"
            value={naming}
            onChange={(e) => setNaming(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter' && naming.trim()) {
                void saveCurrent(naming.trim())
                setNaming(null)
              }
              if (e.key === 'Escape') setNaming(null)
            }}
          />
          <button
            disabled={!naming.trim()}
            onClick={() => {
              void saveCurrent(naming.trim())
              setNaming(null)
            }}
          >
            Save
          </button>
        </div>
      )}
      {abs ? (
        <>
          <Slider
            label="Temp"
            value={shownTemp}
            min={2000}
            max={25000}
            step={10}
            def={shot?.temperature_kelvin ?? 5500}
            format={(v) => `${Math.round(v)} K`}
            track="linear-gradient(90deg,#5b8cff,#fff,#ffb44d)"
            onChange={(v, live) => useDevelop.getState().edit((r) => custom(r, v, shownTint), live)}
            onCommit={() => useDevelop.getState().commit('Temperature')}
          />
          <Slider
            label="Tint"
            value={shownTint}
            min={-150}
            max={150}
            def={(shot?.tint ?? 0) * 3000}
            track="linear-gradient(90deg,#4dff6a,#fff,#ff4de1)"
            onChange={(v, live) => useDevelop.getState().edit((r) => custom(r, shownTemp, v), live)}
            onCommit={() => useDevelop.getState().commit('Tint')}
          />
        </>
      ) : (
        <>
          <Slider
            label="Temp"
            value={shownTemp}
            min={-100}
            max={100}
            track="linear-gradient(90deg,#5b8cff,#fff,#ffb44d)"
            onChange={(v, live) => useDevelop.getState().edit((r) => custom(r, v, shownTint), live)}
            onCommit={() => useDevelop.getState().commit('Temperature')}
          />
          <Slider
            label="Tint"
            value={shownTint}
            min={-100}
            max={100}
            track="linear-gradient(90deg,#4dff6a,#fff,#ff4de1)"
            onChange={(v, live) => useDevelop.getState().edit((r) => custom(r, shownTemp, v), live)}
            onCommit={() => useDevelop.getState().commit('Tint')}
          />
        </>
      )}
    </>
  )
}

export function BasicPanel(): React.JSX.Element | null {
  const session = useDevelop((s) => s.session)
  const recipe = useDevelop((s) => s.recipe)
  const replace = useDevelop((s) => s.replace)
  if (!session || !recipe) return null
  const auto = async (): Promise<void> => {
    try {
      const basic = await api.develop.autoTone(session.key)
      replace({ ...recipe, basic }, 'Auto tone')
    } catch (err) {
      useLibrary.getState().say(errorText(err), 'error')
    }
  }
  return (
    <Section
      id="basic"
      title="Basic"
      right={
        <Tabs
          value={recipe.treatment}
          tabs={[
            { value: 'color', label: 'Colour' },
            { value: 'bw', label: 'B&W' }
          ]}
          onChange={(t) =>
            replace({ ...recipe, treatment: t }, t === 'bw' ? 'Black & white' : 'Colour')
          }
        />
      }
    >
      <ProfileRow />
      <WhiteBalanceRows />
      <div className="row between">
        <span className="group-label">Tone</span>
        <button onClick={() => void auto()} title="Auto tone (Shift+A)">
          Auto
        </button>
      </div>
      <RS
        label="Exposure"
        read={(r) => r.basic.exposure}
        write={(r, v) => (r.basic.exposure = v)}
        min={-5}
        max={5}
        step={0.01}
        format={(v) => (v > 0 ? '+' : '') + v.toFixed(2)}
      />
      <RS
        label="Contrast"
        read={(r) => r.basic.contrast}
        write={(r, v) => (r.basic.contrast = v)}
      />
      <RS
        label="Highlights"
        read={(r) => r.basic.highlights}
        write={(r, v) => (r.basic.highlights = v)}
      />
      <RS label="Shadows" read={(r) => r.basic.shadows} write={(r, v) => (r.basic.shadows = v)} />
      <RS label="Whites" read={(r) => r.basic.whites} write={(r, v) => (r.basic.whites = v)} />
      <RS label="Blacks" read={(r) => r.basic.blacks} write={(r, v) => (r.basic.blacks = v)} />
      <span className="group-label">Presence</span>
      <RS
        label="Texture"
        read={(r) => r.presence.texture}
        write={(r, v) => (r.presence.texture = v)}
      />
      <RS
        label="Clarity"
        read={(r) => r.presence.clarity}
        write={(r, v) => (r.presence.clarity = v)}
      />
      <RS
        label="Dehaze"
        read={(r) => r.presence.dehaze}
        write={(r, v) => (r.presence.dehaze = v)}
      />
      <RS
        label="Vibrance"
        read={(r) => r.presence.vibrance}
        write={(r, v) => (r.presence.vibrance = v)}
      />
      <RS
        label="Saturation"
        read={(r) => r.presence.saturation}
        write={(r, v) => (r.presence.saturation = v)}
      />
    </Section>
  )
}

// ── Tone curve ───────────────────────────────────────────────────────────────

type CurveChannel = 'master' | 'red' | 'green' | 'blue'

export function ToneCurvePanel(): React.JSX.Element | null {
  const recipe = useDevelop((s) => s.recipe)
  const stats = useDevelop((s) => s.stats)
  const edit = useDevelop((s) => s.edit)
  const commit = useDevelop((s) => s.commit)
  const [channel, setChannel] = useState<CurveChannel>('master')
  if (!recipe) return null
  const colours: Record<CurveChannel, string> = {
    master: '#eee',
    red: '#ff5a5a',
    green: '#5aff78',
    blue: '#5a8cff'
  }
  const hist =
    channel === 'master'
      ? stats?.luma_histogram.counts
      : stats?.histograms[{ red: 0, green: 1, blue: 2 }[channel]]?.counts
  return (
    <Section id="curve" title="Tone curve" defaultOpen={false}>
      <span className="group-label">Region</span>
      <RS
        label="Highlights"
        read={(r) => r.toneCurve.highlights}
        write={(r, v) => (r.toneCurve.highlights = v)}
      />
      <RS
        label="Lights"
        read={(r) => r.toneCurve.lights}
        write={(r, v) => (r.toneCurve.lights = v)}
      />
      <RS label="Darks" read={(r) => r.toneCurve.darks} write={(r, v) => (r.toneCurve.darks = v)} />
      <RS
        label="Shadows"
        read={(r) => r.toneCurve.shadows}
        write={(r, v) => (r.toneCurve.shadows = v)}
      />
      <div className="row between">
        <span className="group-label">Point curve</span>
        <Tabs
          value={channel}
          onChange={setChannel}
          tabs={[
            { value: 'master', label: 'RGB' },
            { value: 'red', label: 'R' },
            { value: 'green', label: 'G' },
            { value: 'blue', label: 'B' }
          ]}
        />
      </div>
      <CurveEditor
        points={recipe.toneCurve[channel]}
        colour={colours[channel]}
        histogram={hist}
        onChange={(p: CurvePointSetting[], live) => edit((r) => (r.toneCurve[channel] = p), live)}
        onCommit={() => commit(`Curve (${channel})`)}
      />
      <div className="row">
        <button
          onClick={() => {
            edit(
              (r) =>
                (r.toneCurve[channel] = [
                  { x: 0, y: 0 },
                  { x: 1, y: 1 }
                ])
            )
            commit(`Reset curve (${channel})`)
          }}
        >
          Reset {channel}
        </button>
      </div>
    </Section>
  )
}

// ── HSL / B&W mix ────────────────────────────────────────────────────────────

const BAND_LABEL = (b: HslBand): string => b[0].toUpperCase() + b.slice(1)

export function HslPanel(): React.JSX.Element | null {
  const recipe = useDevelop((s) => s.recipe)
  const tab = useDevelop((s) => s.hslTab)
  const setTab = useDevelop((s) => s.setHslTab)
  const focus = useDevelop((s) => s.hslFocus)
  if (!recipe) return null
  const bw = recipe.treatment === 'bw' || recipe.profile.kind === 'monochrome'
  if (bw) {
    return (
      <Section id="hsl" title="B&W mix">
        {HSL_BANDS.map((b) => (
          <RS
            key={b}
            label={BAND_LABEL(b)}
            read={(r) => r.bwMix[b]}
            write={(r, v) => (r.bwMix[b] = v)}
            track={`linear-gradient(90deg,#000,hsl(${HSL_BAND_CENTRES[b]} 70% 50%),#fff)`}
          />
        ))}
      </Section>
    )
  }
  const axes: ('hue' | 'saturation' | 'luminance')[] =
    tab === 'all' ? ['hue', 'saturation', 'luminance'] : [tab]
  return (
    <Section
      id="hsl"
      title="HSL / Colour"
      right={
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'hue', label: 'H' },
            { value: 'saturation', label: 'S' },
            { value: 'luminance', label: 'L' },
            { value: 'all', label: 'All' }
          ]}
        />
      }
    >
      {axes.map((axis) => (
        <div key={axis}>
          {tab === 'all' && <span className="group-label">{axis}</span>}
          {HSL_BANDS.map((b) => {
            const c = HSL_BAND_CENTRES[b]
            const track =
              axis === 'hue'
                ? `linear-gradient(90deg,hsl(${c - 30} 80% 50%),hsl(${c} 80% 50%),hsl(${c + 30} 80% 50%))`
                : axis === 'saturation'
                  ? `linear-gradient(90deg,hsl(${c} 0% 50%),hsl(${c} 90% 50%))`
                  : `linear-gradient(90deg,hsl(${c} 70% 15%),hsl(${c} 70% 50%),hsl(${c} 70% 85%))`
            return (
              <div key={b} className={focus === b ? 'focused' : ''}>
                <RS
                  label={BAND_LABEL(b)}
                  read={(r) => r.hsl[b][axis]}
                  write={(r, v) => (r.hsl[b][axis] = v)}
                  track={track}
                />
              </div>
            )
          })}
        </div>
      ))}
    </Section>
  )
}

// ── Colour grading ───────────────────────────────────────────────────────────

export function ColorGradePanel(): React.JSX.Element | null {
  const recipe = useDevelop((s) => s.recipe)
  const edit = useDevelop((s) => s.edit)
  const commit = useDevelop((s) => s.commit)
  if (!recipe) return null
  const wheel = (
    key: 'shadows' | 'midtones' | 'highlights' | 'global',
    label: string,
    size = 96
  ): React.JSX.Element => (
    <ColorWheel
      label={label}
      size={size}
      value={recipe.colorGrade[key]}
      onChange={(w, live) => edit((r) => (r.colorGrade[key] = w), live)}
      onCommit={() => commit(`Colour grade: ${label}`)}
    />
  )
  return (
    <Section id="grade" title="Colour grading" defaultOpen={false}>
      <div className="wheels">
        {wheel('shadows', 'Shadows')}
        {wheel('midtones', 'Midtones')}
        {wheel('highlights', 'Highlights')}
      </div>
      <div className="wheels">{wheel('global', 'Global', 120)}</div>
      <RS
        label="Blending"
        read={(r) => r.colorGrade.blending}
        write={(r, v) => (r.colorGrade.blending = v)}
        min={0}
        max={100}
        def={50}
      />
      <RS
        label="Balance"
        read={(r) => r.colorGrade.balance}
        write={(r, v) => (r.colorGrade.balance = v)}
      />
    </Section>
  )
}

// ── Detail ───────────────────────────────────────────────────────────────────

export function DetailPanel(): React.JSX.Element | null {
  const recipe = useDevelop((s) => s.recipe)
  const noise = useDevelop((s) => s.noise)
  const measure = useDevelop((s) => s.measureNoise)
  const report = useDevelop((s) => s.report)
  const [measuring, setMeasuring] = useState(false)
  if (!recipe) return null
  const seen = report?.gradeLines.filter((l) => l.includes('denoise')) ?? []
  return (
    <Section id="detail" title="Detail" defaultOpen={false}>
      <span className="group-label">Sharpening</span>
      <RS
        label="Amount"
        read={(r) => r.detail.sharpenAmount}
        write={(r, v) => (r.detail.sharpenAmount = v)}
        min={0}
        max={150}
      />
      <RS
        label="Radius"
        read={(r) => r.detail.sharpenRadius}
        write={(r, v) => (r.detail.sharpenRadius = v)}
        min={0.5}
        max={3}
        step={0.1}
        def={1}
        format={(v) => v.toFixed(1)}
      />
      <RS
        label="Detail"
        read={(r) => r.detail.sharpenDetail}
        write={(r, v) => (r.detail.sharpenDetail = v)}
        min={0}
        max={100}
        def={25}
      />
      <RS
        label="Masking"
        read={(r) => r.detail.sharpenMasking}
        write={(r, v) => (r.detail.sharpenMasking = v)}
        min={0}
        max={100}
      />
      <span className="group-label">Noise reduction</span>
      <RS
        label="Luminance"
        read={(r) => r.detail.noiseLuminance}
        write={(r, v) => (r.detail.noiseLuminance = v)}
        min={0}
        max={100}
      />
      <RS
        label="Detail"
        read={(r) => r.detail.noiseLuminanceDetail}
        write={(r, v) => (r.detail.noiseLuminanceDetail = v)}
        min={0}
        max={100}
        def={50}
      />
      <RS
        label="Colour"
        read={(r) => r.detail.noiseColor}
        write={(r, v) => (r.detail.noiseColor = v)}
        min={0}
        max={100}
      />
      <RS
        label="Detail"
        read={(r) => r.detail.noiseColorDetail}
        write={(r, v) => (r.detail.noiseColorDetail = v)}
        min={0}
        max={100}
        def={50}
      />
      <div className="noise-readout">
        <button
          disabled={measuring}
          onClick={() => {
            setMeasuring(true)
            void measure().finally(() => setMeasuring(false))
          }}
        >
          {measuring ? 'Measuring…' : 'Measure noise'}
        </button>
        {noise && (
          <span title="σ̂ of white noise on each plane, the denoiser's own estimator, in 8-bit code values">
            σ̂ luma {(noise.luminance * 255).toFixed(2)} · chroma{' '}
            {noise.color.map((c) => (c * 255).toFixed(2)).join(' / ')}
          </span>
        )}
      </div>
      {seen.length > 0 && (
        <pre className="report-lines">{seen.map((l) => l.trim()).join('\n')}</pre>
      )}
      <p className="muted small">Sharpening and noise reduction read true at 100% (Z).</p>
    </Section>
  )
}

// ── Effects ──────────────────────────────────────────────────────────────────

export function EffectsPanel(): React.JSX.Element {
  return (
    <Section id="effects" title="Effects" defaultOpen={false}>
      <span className="group-label">Post-crop vignette</span>
      <RS
        label="Amount"
        read={(r) => r.effects.vignetteAmount}
        write={(r, v) => (r.effects.vignetteAmount = v)}
      />
      <RS
        label="Midpoint"
        read={(r) => r.effects.vignetteMidpoint}
        write={(r, v) => (r.effects.vignetteMidpoint = v)}
        min={0}
        max={100}
        def={50}
      />
      <RS
        label="Roundness"
        read={(r) => r.effects.vignetteRoundness}
        write={(r, v) => (r.effects.vignetteRoundness = v)}
      />
      <RS
        label="Feather"
        read={(r) => r.effects.vignetteFeather}
        write={(r, v) => (r.effects.vignetteFeather = v)}
        min={0}
        max={100}
        def={50}
      />
      <RS
        label="Highlights"
        read={(r) => r.effects.vignetteHighlights}
        write={(r, v) => (r.effects.vignetteHighlights = v)}
        min={0}
        max={100}
      />
      <span className="group-label">Grain</span>
      <RS
        label="Amount"
        read={(r) => r.effects.grainAmount}
        write={(r, v) => (r.effects.grainAmount = v)}
        min={0}
        max={100}
      />
      <RS
        label="Size"
        read={(r) => r.effects.grainSize}
        write={(r, v) => (r.effects.grainSize = v)}
        min={0}
        max={100}
        def={25}
      />
      <RS
        label="Roughness"
        read={(r) => r.effects.grainRoughness}
        write={(r, v) => (r.effects.grainRoughness = v)}
        min={0}
        max={100}
        def={50}
      />
    </Section>
  )
}

// ── Calibration ──────────────────────────────────────────────────────────────

export function CalibrationPanel(): React.JSX.Element {
  return (
    <Section id="calibration" title="Calibration" defaultOpen={false}>
      <RS
        label="Shadows tint"
        read={(r) => r.calibration.shadowsTint}
        write={(r, v) => (r.calibration.shadowsTint = v)}
        track="linear-gradient(90deg,#4dff6a,#888,#ff4de1)"
      />
      <span className="group-label">Red primary</span>
      <RS
        label="Hue"
        read={(r) => r.calibration.redHue}
        write={(r, v) => (r.calibration.redHue = v)}
        track="linear-gradient(90deg,#ff2d7a,#ff2d2d,#ff7a2d)"
      />
      <RS
        label="Saturation"
        read={(r) => r.calibration.redSaturation}
        write={(r, v) => (r.calibration.redSaturation = v)}
        track="linear-gradient(90deg,#a88,#f22)"
      />
      <span className="group-label">Green primary</span>
      <RS
        label="Hue"
        read={(r) => r.calibration.greenHue}
        write={(r, v) => (r.calibration.greenHue = v)}
        track="linear-gradient(90deg,#b8ff2d,#2dff4d,#2dffb8)"
      />
      <RS
        label="Saturation"
        read={(r) => r.calibration.greenSaturation}
        write={(r, v) => (r.calibration.greenSaturation = v)}
        track="linear-gradient(90deg,#8a8,#2f4)"
      />
      <span className="group-label">Blue primary</span>
      <RS
        label="Hue"
        read={(r) => r.calibration.blueHue}
        write={(r, v) => (r.calibration.blueHue = v)}
        track="linear-gradient(90deg,#2dd7ff,#2d4dff,#8a2dff)"
      />
      <RS
        label="Saturation"
        read={(r) => r.calibration.blueSaturation}
        write={(r, v) => (r.calibration.blueSaturation = v)}
        track="linear-gradient(90deg,#88a,#24f)"
      />
    </Section>
  )
}

// ── Crop & geometry ──────────────────────────────────────────────────────────

const ASPECTS: { value: string; label: string; ratio: number | null }[] = [
  { value: 'free', label: 'Free', ratio: null },
  { value: 'original', label: 'Original', ratio: -1 },
  { value: '1:1', label: '1 : 1', ratio: 1 },
  { value: '4:5', label: '4 : 5', ratio: 4 / 5 },
  { value: '5:4', label: '5 : 4', ratio: 5 / 4 },
  { value: '3:2', label: '3 : 2', ratio: 3 / 2 },
  { value: '2:3', label: '2 : 3', ratio: 2 / 3 },
  { value: '16:9', label: '16 : 9', ratio: 16 / 9 },
  { value: '9:16', label: '9 : 16', ratio: 9 / 16 }
]

export function GeometryPanel(): React.JSX.Element | null {
  const session = useDevelop((s) => s.session)
  const recipe = useDevelop((s) => s.recipe)
  const replace = useDevelop((s) => s.replace)
  const tool = useDevelop((s) => s.tool)
  const setTool = useDevelop((s) => s.setTool)
  const setGesture = useDevelop((s) => s.setGesture)
  if (!recipe || !session) return null
  const g = recipe.geometry
  const aspectValue =
    g.aspect === null
      ? 'free'
      : (ASPECTS.find(
          (a) => a.ratio !== null && a.ratio > 0 && Math.abs(a.ratio - (g.aspect as number)) < 1e-3
        )?.value ?? 'original')
  return (
    <Section id="geometry" title="Crop & rotate" defaultOpen={false}>
      <div className="row">
        <Toggle
          on={tool === 'crop'}
          onChange={(on) => setTool(on ? 'crop' : 'none')}
          title="Crop tool (R)"
        >
          ✂ Crop
        </Toggle>
        <button
          title="Rotate left"
          onClick={() =>
            replace(
              { ...recipe, geometry: { ...g, quarterTurns: (g.quarterTurns + 3) % 4, crop: null } },
              'Rotate left'
            )
          }
        >
          ⟲
        </button>
        <button
          title="Rotate right"
          onClick={() =>
            replace(
              { ...recipe, geometry: { ...g, quarterTurns: (g.quarterTurns + 1) % 4, crop: null } },
              'Rotate right'
            )
          }
        >
          ⟳
        </button>
        <button
          title="Flip horizontal"
          onClick={() =>
            replace({ ...recipe, geometry: { ...g, flipHorizontal: !g.flipHorizontal } }, 'Flip')
          }
        >
          ⇋
        </button>
        <button
          onClick={() =>
            replace({ ...recipe, geometry: { ...g, crop: null, straighten: 0 } }, 'Reset crop')
          }
        >
          Reset
        </button>
      </div>
      <Select
        label="Aspect"
        value={aspectValue}
        options={ASPECTS.map((a) => ({ value: a.value, label: a.label }))}
        onChange={(v) => {
          const a = ASPECTS.find((x) => x.value === v)
          // "Original" is the frame as the user has turned it, not the file's.
          const o = orientedFrame(recipe, session.frameWidth, session.frameHeight)
          const ratio = a?.ratio === -1 ? o.width / o.height : (a?.ratio ?? null)
          replace(
            { ...recipe, geometry: { ...g, aspect: ratio, crop: null } },
            `Aspect ${a?.label}`
          )
        }}
      />
      <RS
        label="Straighten"
        read={(r) => r.geometry.straighten}
        write={(r, v) => (r.geometry.straighten = v)}
        min={-45}
        max={45}
        step={0.05}
        format={(v) => `${v.toFixed(2)}°`}
        onGesture={(on) => setGesture(on ? 'straighten' : null)}
      />
    </Section>
  )
}
