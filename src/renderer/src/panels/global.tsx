import { useEffect, useState } from 'react'
import { absoluteWb, isIdentityCurve } from '../../../shared/compile'
import type { LutProfile } from '../../../shared/ipc'
import {
  HSL_BANDS,
  HSL_BAND_CENTRES,
  MAX_POINT_COLORS,
  type CurvePointSetting,
  type HslBand,
  type PointColorSetting,
  type ProfileRef,
  type Recipe
} from '../../../shared/recipe'
import { rawColourReason } from '../../../shared/rawcolour'
import { WB_PRESETS } from '../../../shared/wb'
import { opOf, wbFromSaved } from '../../../shared/wbconvert'
import { AddColourControl } from '../components/AddColour'
import { ColorWheel, CurveEditor } from '../components/editors'
import { Section, Select, Slider, Tabs, Toggle, ToolPanel } from '../components/ui'
import { api, errorText } from '../lib/api'
import { useDevelop, type CurveChannel } from '../state/develop'
import { useLibrary } from '../state/library'
import { runJob } from '../state/busy'
import { ASPECTS, aspectValue } from '../lib/aspects'
import { setAspect } from '../lib/geometry'
import { Icon, PathIcon } from '../components/icons'
import { Popover } from '../components/Popover'
import { CurvePresets } from './CurvePresets'
import { AiDenoise } from './AiDenoise'
import { applyUpright, startGuides } from '../lib/upright'
import type { UprightMode } from '../../../shared/upright'
import { withKey } from '../lib/commands'
import { scoped, scopedView, scopeLayer, useScope } from '../state/scope'
import { useUi } from '../state/ui'
import type { Tip } from '../components/InfoTip'
import { TIPS } from './tips'

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
  tip,
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
  tip?: Tip
}): React.JSX.Element | null {
  // Its own number only: a tick of another slider does not re-render this one.
  const open = useUi((s) => s.masksWin.open)
  const value = useDevelop((s) =>
    s.recipe ? read(scopedView(s.recipe, scopeLayer(s.recipe, s.layerId, open))) : null
  )
  const { edit, commit } = scoped
  if (value === null) return null
  return (
    <Slider
      label={label}
      value={value}
      min={min}
      max={max}
      step={step}
      def={def}
      format={format}
      track={track}
      title={title}
      tip={tip}
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
  /**
   * The engine's white (`opOf`), so the preset converts onto photos of the
   * other kind. Presets saved before it existed lack it and stay with their
   * own kind.
   */
  op?: { kelvin: number; tint: number }
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

/**
 * A RAW's camera colour: PIXL's fit for the body where its database holds it,
 * or the file's own. Choosing records it for the photo, carries the saved
 * white balance to the new as-shot white and opens the photo again; steps
 * made on the other colour are marked stale (their pixels moved).
 */
function CameraColourRow({
  session
}: {
  session: NonNullable<ReturnType<typeof useDevelop.getState>['session']>
}): React.JSX.Element {
  const say = useLibrary((s) => s.say)
  const steps = useDevelop((s) => s.recipe?.pixels.length ?? 0)
  const cc = session.cameraColour
  const options = [
    ...(cc?.supported
      ? [{ value: 'pixl:1', label: `PIXL · ${cc.pixlCamera ?? `${cc.make} ${cc.model}`}` }]
      : []),
    { value: 'container', label: 'Container (the file’s own)' }
  ]
  const choose = async (v: string): Promise<void> => {
    try {
      await api.develop.setRawColour(session.key, v as 'container' | 'pixl:1')
      await useDevelop.getState().reopen()
      say(
        steps > 0
          ? 'Camera colour changed: heals, denoise and enhance steps made on the other colour are marked'
          : 'Camera colour changed'
      )
    } catch (err) {
      say(errorText(err), 'error')
    }
  }
  return (
    <div
      className="row"
      title={
        cc?.supported
          ? 'How this camera’s colours are read. PIXL’s is fitted to the body; the file’s own is the maker’s matrix.'
          : (rawColourReason(session.info) ?? undefined)
      }
    >
      <Select
        label="Colour"
        value={session.rawColour ?? 'container'}
        onChange={(v) => void choose(v)}
        options={options}
      />
    </div>
  )
}

function WhiteBalanceRows(): React.JSX.Element | null {
  const session = useDevelop((s) => s.session)
  // In a mask the white is a relative shift, without presets or the picker.
  const { recipe, replace, layer } = useScope()
  const tool = useDevelop((s) => s.tool)
  const setTool = useDevelop((s) => s.setTool)
  const [saved, setSaved] = useState<SavedWb[]>([])
  const [naming, setNaming] = useState<string | null>(null)
  useEffect(() => {
    void api.app.getSetting<SavedWb[]>(WB_PRESETS_KEY).then((v) => setSaved(v ?? []))
  }, [])
  if (!session || !recipe) return null
  const ctx = { isRaw: session.isRaw, asShot: session.asShot }
  const abs = !layer && absoluteWb(ctx)
  // Saved presets are in the units they were made in: absolute Kelvin for a
  // RAW with an as-shot white, relative sliders for everything else. One
  // that also kept the engine's white is offered on both kinds, converted.
  const mine = saved.filter((p) => p.op || p.absolute === abs)
  const wbOfSaved = (p: SavedWb, preset: string): Recipe['wb'] => {
    const wb: Recipe['wb'] = { mode: 'custom', temperature: p.temperature, tint: p.tint, preset }
    return p.op ? wbFromSaved(wb, { ...p.op, absolute: p.absolute }, ctx) : wb
  }
  const saveCurrent = async (name: string): Promise<void> => {
    const shown: Recipe['wb'] = {
      mode: 'custom',
      temperature: Math.round(shownTemp),
      tint: Math.round(shownTint),
      preset: null
    }
    const entry: SavedWb = {
      name,
      absolute: abs,
      temperature: shown.temperature,
      tint: shown.tint,
      op: opOf(shown, ctx)
    }
    // A name is one preset: this replaces a converting one of either kind.
    const next = [...saved.filter((p) => !(p.name === name && (p.op || p.absolute === abs))), entry]
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
        const wb = await runJob('Auto white balance', () => api.develop.autoWb(session.key), {
          detail: 'Finding the neutral greys'
        })
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
      if (p) replace({ ...recipe, wb: wbOfSaved(p, v) }, `White balance: ${p.name}`)
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
      {!layer && session.rawColour && <CameraColourRow session={session} />}
      {!layer && (
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
            title={withKey('Pick a neutral in the photo', 'tool.wb')}
          >
            ⌖ Pick
          </Toggle>
        </div>
      )}
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
            onChange={(v, live) => scoped.edit((r) => custom(r, v, shownTint), live)}
            onCommit={() => scoped.commit('Temperature')}
          />
          <Slider
            label="Tint"
            value={shownTint}
            min={-150}
            max={150}
            def={(shot?.tint ?? 0) * 3000}
            track="linear-gradient(90deg,#4dff6a,#fff,#ff4de1)"
            onChange={(v, live) => scoped.edit((r) => custom(r, shownTemp, v), live)}
            onCommit={() => scoped.commit('Tint')}
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
            onChange={(v, live) => scoped.edit((r) => custom(r, v, shownTint), live)}
            onCommit={() => scoped.commit('Temperature')}
          />
          <Slider
            label="Tint"
            value={shownTint}
            min={-100}
            max={100}
            track="linear-gradient(90deg,#4dff6a,#fff,#ff4de1)"
            onChange={(v, live) => scoped.edit((r) => custom(r, shownTemp, v), live)}
            onCommit={() => scoped.commit('Tint')}
          />
        </>
      )}
    </>
  )
}

/** Above the cards: the profile, and colour or black and white (the whole photo's only). */
export function AdjustHead(): React.JSX.Element | null {
  const { recipe, replace, layer } = useScope()
  if (!recipe || layer) return null
  return (
    <div className="adjust-head">
      <div className="row">
        <span className="adjust-head-label">Treatment</span>
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
      </div>
      <ProfileRow />
    </div>
  )
}

export function WhiteBalanceBody(): React.JSX.Element {
  return <WhiteBalanceRows />
}

/** Light's Auto: the engine sets the six sliders from the picture (the whole photo only). */
export function AutoTone(): React.JSX.Element | null {
  const session = useDevelop((s) => s.session)
  const { recipe, replace, layer } = useScope()
  if (!session || !recipe || layer) return null
  const auto = async (): Promise<void> => {
    try {
      const basic = await runJob('Auto tone', () => api.develop.autoTone(session.key))
      const now = useDevelop.getState().recipe ?? recipe
      replace({ ...now, basic }, 'Auto tone')
    } catch (err) {
      useLibrary.getState().say(errorText(err), 'error')
    }
  }
  return (
    <button className="sm" onClick={() => void auto()} title={withKey('Auto tone', 'autoTone')}>
      Auto
    </button>
  )
}

export function LightBody(): React.JSX.Element {
  return (
    <>
      <RS
        label="Exposure"
        tip={TIPS['light.exposure']}
        read={(r) => r.basic.exposure}
        write={(r, v) => (r.basic.exposure = v)}
        min={-5}
        max={5}
        step={0.01}
        format={(v) => (v > 0 ? '+' : '') + v.toFixed(2)}
      />
      <RS
        label="Contrast"
        tip={TIPS['light.contrast']}
        read={(r) => r.basic.contrast}
        write={(r, v) => (r.basic.contrast = v)}
      />
      <RS
        label="Highlights"
        tip={TIPS['light.highlights']}
        read={(r) => r.basic.highlights}
        write={(r, v) => (r.basic.highlights = v)}
      />
      <RS
        label="Shadows"
        tip={TIPS['light.shadows']}
        read={(r) => r.basic.shadows}
        write={(r, v) => (r.basic.shadows = v)}
      />
      <RS
        label="Whites"
        tip={TIPS['light.whites']}
        read={(r) => r.basic.whites}
        write={(r, v) => (r.basic.whites = v)}
      />
      <RS
        label="Blacks"
        tip={TIPS['light.blacks']}
        read={(r) => r.basic.blacks}
        write={(r, v) => (r.basic.blacks = v)}
      />
    </>
  )
}

export function PresenceBody(): React.JSX.Element {
  return (
    <>
      <RS
        label="Texture"
        tip={TIPS['presence.texture']}
        read={(r) => r.presence.texture}
        write={(r, v) => (r.presence.texture = v)}
      />
      <RS
        label="Clarity"
        tip={TIPS['presence.clarity']}
        read={(r) => r.presence.clarity}
        write={(r, v) => (r.presence.clarity = v)}
      />
      <RS
        label="Dehaze"
        tip={TIPS['presence.dehaze']}
        read={(r) => r.presence.dehaze}
        write={(r, v) => (r.presence.dehaze = v)}
      />
    </>
  )
}

export function ColourBody(): React.JSX.Element {
  const { layer } = useScope()
  return (
    <>
      <RS
        label="Vibrance"
        tip={TIPS['colour.vibrance']}
        read={(r) => r.presence.vibrance}
        write={(r, v) => (r.presence.vibrance = v)}
      />
      <RS
        label="Saturation"
        tip={TIPS['colour.saturation']}
        read={(r) => r.presence.saturation}
        write={(r, v) => (r.presence.saturation = v)}
      />
      {layer && (
        <RS
          label="Hue"
          tip={TIPS['colour.hue']}
          read={(r) => r.presence.hue}
          write={(r, v) => (r.presence.hue = v)}
          track="linear-gradient(90deg,#2df,#f2d,#fd2,#2f8,#2df)"
        />
      )}
    </>
  )
}

// ── Tone curve ───────────────────────────────────────────────────────────────

/** A crosshair: the targeted adjustment tool. */
const TAT_ICON = 'M12 3v4M12 17v4M3 12h4M17 12h4M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'

/**
 * The targeted adjustment tool's switch for one panel: on, it drags that
 * panel's controls from the photo; the tool is put down when the panel goes.
 */
function TatToggle({ target }: { target: 'hsl' | 'curve' }): React.JSX.Element {
  const on = useDevelop((s) => s.tool === 'tat' && s.tatTarget === target)
  useEffect(
    () => () => {
      const s = useDevelop.getState()
      if (s.tool === 'tat' && s.tatTarget === target) s.setTool('none')
    },
    [target]
  )
  return (
    <Toggle
      on={on}
      onChange={(v) => {
        const s = useDevelop.getState()
        s.setTatTarget(target)
        s.setTool(v ? 'tat' : 'none')
      }}
      title={withKey('Targeted adjustment: drag up or down on the photo', 'tool.tat')}
    >
      <PathIcon d={TAT_ICON} />
    </Toggle>
  )
}

export function CurveBody(): React.JSX.Element | null {
  const { recipe, edit, commit } = useScope()
  const stats = useDevelop((s) => s.stats)
  const channel = useDevelop((s) => s.curveChannel)
  const setChannel = useDevelop((s) => s.setCurveChannel)
  if (!recipe) return null
  const colours: Record<CurveChannel, string> = {
    master: '#c9bdf7',
    red: '#ff5a5a',
    green: '#5aff78',
    blue: '#5a8cff'
  }
  const hist =
    channel === 'master'
      ? stats?.luma_histogram.counts
      : stats?.histograms[{ red: 0, green: 1, blue: 2 }[channel]]?.counts
  return (
    <ToolPanel>
      <Section id="curve.presets" title="Presets">
        <CurvePresets />
      </Section>
      <Section id="curve.region" title="Region">
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
        <RS
          label="Darks"
          read={(r) => r.toneCurve.darks}
          write={(r, v) => (r.toneCurve.darks = v)}
        />
        <RS
          label="Shadows"
          tip={TIPS['light.shadows']}
          read={(r) => r.toneCurve.shadows}
          write={(r, v) => (r.toneCurve.shadows = v)}
        />
      </Section>
      <Section
        id="curve.point"
        title="Point curve"
        right={
          <>
            <TatToggle target="curve" />
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
          </>
        }
      >
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
        <Slider
          label="Refine saturation"
          value={recipe.toneCurve.refineSaturation}
          min={0}
          max={100}
          def={100}
          disabled={isIdentityCurve(recipe.toneCurve.master)}
          title="How much saturation the RGB curve brings as it steepens: lower keeps colours as they were"
          onChange={(v, live) => edit((r) => (r.toneCurve.refineSaturation = v), live)}
          onCommit={() => commit('Refine saturation')}
        />
      </Section>
    </ToolPanel>
  )
}

// ── HSL / B&W mix ────────────────────────────────────────────────────────────

const BAND_LABEL = (b: HslBand): string => b[0].toUpperCase() + b.slice(1)

export function MixerBody(): React.JSX.Element | null {
  const { recipe, layer } = useScope()
  const tab = useDevelop((s) => s.hslTab)
  const setTab = useDevelop((s) => s.setHslTab)
  const focus = useDevelop((s) => s.hslFocus)
  // A band chosen from the colour-concentration chart scrolls into view.
  useEffect(() => {
    if (!focus) return
    const t = setTimeout(
      () =>
        document
          .querySelector('.tool-panel .focused')
          ?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
      320
    )
    return () => clearTimeout(t)
  }, [focus, tab])
  if (!recipe) return null
  const bw = recipe.treatment === 'bw' || recipe.profile.kind === 'monochrome'
  if (bw && layer) {
    return (
      <ToolPanel>
        <p className="muted small">
          This photo is black and white: its B&amp;W mix is set for the whole photo. Deselect the
          mask to change it.
        </p>
      </ToolPanel>
    )
  }
  if (bw) {
    return (
      <ToolPanel>
        <Section id="hsl.bw" title="B&W mix">
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
      </ToolPanel>
    )
  }
  const axes: ('hue' | 'saturation' | 'luminance')[] =
    tab === 'point' ? [] : tab === 'all' ? ['hue', 'saturation', 'luminance'] : [tab]
  return (
    <ToolPanel
      actions={
        <>
          {tab !== 'point' && <TatToggle target="hsl" />}
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'hue', label: 'H' },
              { value: 'saturation', label: 'S' },
              { value: 'luminance', label: 'L' },
              { value: 'all', label: 'All' },
              { value: 'point', label: 'Point' }
            ]}
          />
        </>
      }
    >
      {tab === 'point' && <PointColorSection />}
      {axes.map((axis) => (
        <Section key={axis} id={`hsl.${axis}`} title={axis}>
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
        </Section>
      ))}
    </ToolPanel>
  )
}

/** The swatch colour of a sample: its hue and saturation at its own lightness. */
function swatchColour(p: PointColorSetting): string {
  const l = Math.min(85, Math.max(15, p.luminance * 100))
  return `hsl(${Math.round(p.hue)} ${Math.round(p.saturation * 100)}% ${Math.round(l)}%)`
}

/**
 * The colour mixer's Point tab: colours picked off the photo, each moved on
 * its own. The eyedropper adds a swatch; the selected one shows its shifts.
 */
function PointColorSection(): React.JSX.Element | null {
  const { recipe, replace } = useScope()
  const tool = useDevelop((s) => s.tool)
  const setTool = useDevelop((s) => s.setTool)
  const pointId = useDevelop((s) => s.pointId)
  const setPointId = useDevelop((s) => s.setPointId)
  // Put the eyedropper down when the tab goes.
  useEffect(
    () => () => {
      if (useDevelop.getState().tool === 'point-picker') useDevelop.getState().setTool('none')
    },
    []
  )
  if (!recipe) return null
  const points = recipe.pointColors
  // The selected swatch, else the newest.
  const sel = points.find((p) => p.id === pointId) ?? points[points.length - 1] ?? null
  const index = sel ? points.indexOf(sel) : -1
  const full = points.length >= MAX_POINT_COLORS
  const remove = (): void => {
    if (!sel) return
    const next = structuredClone(recipe)
    next.pointColors = next.pointColors.filter((p) => p.id !== sel.id)
    setPointId(next.pointColors[Math.max(0, index - 1)]?.id ?? null)
    replace(next, 'Point colour: remove')
  }
  // Each slider reads and writes the selected swatch, found by id.
  const at = (r: Recipe): PointColorSetting | undefined =>
    r.pointColors.find((p) => p.id === sel?.id)
  const shift = (
    label: string,
    key: 'shiftHue' | 'shiftSat' | 'shiftLum' | 'range',
    track?: string
  ): React.JSX.Element => (
    <RS
      label={label}
      read={(r) => at(r)?.[key] ?? 0}
      write={(r, v) => {
        const p = at(r)
        if (p) p[key] = v
      }}
      min={key === 'range' ? 0 : -100}
      def={key === 'range' ? 50 : 0}
      track={track}
    />
  )
  return (
    <Section
      id="hsl.point"
      title="Point colour"
      right={
        <Toggle
          on={tool === 'point-picker'}
          onChange={(on) => setTool(on ? 'point-picker' : 'none')}
          title={
            full
              ? `At most ${MAX_POINT_COLORS} colours: picking re-samples the selected one`
              : 'Pick a colour in the photo'
          }
        >
          ⌖ Pick
        </Toggle>
      }
    >
      <div className="row">
        {points.length === 0 && (
          <span className="muted">Pick a colour in the photo to shift it.</span>
        )}
        {points.map((p, i) => (
          <button
            key={p.id}
            className={`icon mf-swatch-btn${p.id === sel?.id ? ' on' : ''}`}
            title={`Colour ${i + 1}`}
            onClick={() => setPointId(p.id)}
          >
            <span
              className="mf-swatch"
              style={{ background: swatchColour(p), color: swatchColour(p) }}
            />
          </button>
        ))}
        {sel && (
          <button className="icon" title="Remove this colour" onClick={remove}>
            <Icon name="trash" />
          </button>
        )}
      </div>
      {sel && (
        <>
          {shift(
            'Hue',
            'shiftHue',
            `linear-gradient(90deg,hsl(${sel.hue - 30} 80% 50%),hsl(${sel.hue} 80% 50%),hsl(${sel.hue + 30} 80% 50%))`
          )}
          {shift(
            'Saturation',
            'shiftSat',
            `linear-gradient(90deg,hsl(${sel.hue} 0% 50%),hsl(${sel.hue} 90% 50%))`
          )}
          {shift(
            'Luminance',
            'shiftLum',
            `linear-gradient(90deg,hsl(${sel.hue} 70% 15%),hsl(${sel.hue} 70% 50%),hsl(${sel.hue} 70% 85%))`
          )}
          {shift('Range', 'range')}
        </>
      )}
    </Section>
  )
}

// ── Colour grading ───────────────────────────────────────────────────────────

export function GradingBody(): React.JSX.Element | null {
  const { recipe, edit, commit, layer } = useScope()
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
    <ToolPanel>
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
      <Section id="grade.add" title="Add colour">
        <AddColourControl
          target={layer ? { layer: layer.id, part: 'grade' } : 'grade'}
          value={recipe.colorGrade.add}
          onChange={(v, live) => edit((r) => (r.colorGrade.add = v), live)}
          hint={layer ? TIPS['grading.add.mask'] : TIPS['grading.add']}
        />
      </Section>
    </ToolPanel>
  )
}

// ── Detail ───────────────────────────────────────────────────────────────────

/**
 * The noise as the engine sees it, behind a </> beside the tabs: the
 * measured σ̂ of each plane and the denoise lines of the last render. For
 * whoever wants the numbers; nobody needs them to denoise.
 */
function NoiseAnalysis(): React.JSX.Element {
  const noise = useDevelop((s) => s.noise)
  const measure = useDevelop((s) => s.measureNoise)
  const report = useDevelop((s) => s.report)
  const [open, setOpen] = useState(false)
  const [measuring, setMeasuring] = useState(false)
  const seen = report?.gradeLines.filter((l) => l.includes('denoise')) ?? []
  return (
    <span className="menu-anchor">
      <button
        className={`icon sm${open ? ' on' : ''}`}
        title="Noise analysis"
        aria-label="Noise analysis"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name="engine" />
      </button>
      {open && (
        <Popover onClose={() => setOpen(false)} align="right" className="noise-pop">
          <span className="micro">Noise analysis</span>
          <div className="noise-readout">
            <button
              className="sm"
              disabled={measuring}
              onClick={() => {
                setMeasuring(true)
                void runJob('Measuring noise', () => measure()).finally(() => setMeasuring(false))
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
          {seen.length > 0 ? (
            <pre className="report-lines">{seen.map((l) => l.trim()).join('\n')}</pre>
          ) : (
            <p className="muted small">No noise reduction in the last render.</p>
          )}
        </Popover>
      )}
    </span>
  )
}

export function DetailBody(): React.JSX.Element | null {
  const { recipe } = useScope()
  // AI first, as Lightroom's Denoise: Classic only for a photo that already
  // uses it (and has no AI steps), until the user turns away.
  const [noiseTab, setNoiseTab] = useState<'classic' | 'ai'>(() => {
    const r = useDevelop.getState().recipe
    const classic = !!r && (r.detail.noiseLuminance > 0 || r.detail.noiseColor > 0)
    return classic && (r?.pixels.length ?? 0) === 0 ? 'classic' : 'ai'
  })
  if (!recipe) return null
  return (
    <ToolPanel>
      <Section id="detail.sharpen" title="Sharpening">
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
      </Section>
      <Section id="detail.noise" title="Noise reduction">
        {/* Classic is a setting; AI makes pixel steps (both can apply, inside a mask too). */}
        <div className="row noise-tabs">
          <Tabs
            value={noiseTab}
            tabs={[
              { value: 'ai', label: 'AI' },
              { value: 'classic', label: 'Classic' }
            ]}
            onChange={setNoiseTab}
          />
          <NoiseAnalysis />
        </div>
        {noiseTab === 'ai' ? (
          <AiDenoise />
        ) : (
          <>
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
          </>
        )}
      </Section>
    </ToolPanel>
  )
}

// ── Effects ──────────────────────────────────────────────────────────────────

export function EffectsBody(): React.JSX.Element | null {
  const { recipe, edit, commit, layer } = useScope()
  const isHdr = useDevelop((s) => s.session?.isHdr === true)
  if (!recipe) return null
  const paint = recipe.effects.vignetteStyle === 'paint'
  return (
    <ToolPanel>
      <Section id="effects.vignette" title="Post-crop vignette" tip={TIPS['effects.vignette']}>
        <Select
          label="Style"
          value={recipe.effects.vignetteStyle}
          options={[
            { value: 'highlight', label: 'Highlight priority' },
            { value: 'paint', label: 'Paint overlay' }
          ]}
          title={
            isHdr && paint
              ? 'Paint overlay needs an SDR picture: this HDR photo keeps highlight priority'
              : 'Highlight priority darkens like light falling off; paint overlay mixes toward black or white'
          }
          onChange={(v) => {
            edit((r) => (r.effects.vignetteStyle = v))
            commit('Vignette style')
          }}
        />
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
        {(!paint || isHdr) && (
          <RS
            label="Highlights"
            read={(r) => r.effects.vignetteHighlights}
            write={(r, v) => (r.effects.vignetteHighlights = v)}
            min={0}
            max={100}
          />
        )}
        {isHdr && paint && <p className="note small">HDR photos keep highlight priority.</p>}
      </Section>
      <Section id="effects.wash" title="Colour wash">
        <AddColourControl
          target={layer ? { layer: layer.id, part: 'wash' } : 'wash'}
          value={recipe.effects.wash}
          onChange={(v, live) => edit((r) => (r.effects.wash = v), live)}
          hint={TIPS['effects.wash']}
        />
      </Section>
      <Section id="effects.grain" title="Grain" tip={TIPS['effects.grain']}>
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
    </ToolPanel>
  )
}

// ── Calibration ──────────────────────────────────────────────────────────────

export function CalibrationBody(): React.JSX.Element {
  return (
    <ToolPanel>
      <Section id="calibration.shadows" title="Shadows">
        <RS
          label="Shadows tint"
          read={(r) => r.calibration.shadowsTint}
          write={(r, v) => (r.calibration.shadowsTint = v)}
          track="linear-gradient(90deg,#4dff6a,#888,#ff4de1)"
        />
      </Section>
      <Section id="calibration.red" title="Red primary">
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
      </Section>
      <Section id="calibration.green" title="Green primary">
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
      </Section>
      <Section id="calibration.blue" title="Blue primary">
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
    </ToolPanel>
  )
}

// ── Crop & geometry ──────────────────────────────────────────────────────────

/** Crop's panel, in place of the cards while the crop tool is in hand. */
export function CropDrawer(): React.JSX.Element | null {
  const recipe = useDevelop((s) => s.recipe)
  const setGesture = useDevelop((s) => s.setGesture)
  if (!recipe) return null
  const g = recipe.geometry
  return (
    <ToolPanel>
      <Select
        label="Aspect"
        value={aspectValue(g.aspect)}
        options={ASPECTS.map((a) => ({ value: a.value, label: a.label }))}
        onChange={setAspect}
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
    </ToolPanel>
  )
}

/** Upright and Transform: perspective, kept with the adjustments (the crop has its own panel). */
export function GeometryBody(): React.JSX.Element | null {
  const session = useDevelop((s) => s.session)
  const recipe = useDevelop((s) => s.recipe)
  const tool = useDevelop((s) => s.tool)
  const edit = useDevelop((s) => s.edit)
  const commit = useDevelop((s) => s.commit)
  if (!recipe || !session) return null
  const g = recipe.geometry
  return (
    <ToolPanel>
      <Section id="crop.upright" title="Upright" tip={TIPS['geometry.upright']}>
        <div className="seg upright-modes" role="group" aria-label="Upright">
          {UPRIGHT_MODES.map((m) => (
            <button
              key={m.value}
              className={g.upright.mode === m.value ? 'on' : ''}
              aria-pressed={g.upright.mode === m.value}
              title={m.title}
              onClick={() => void applyUpright(m.value)}
            >
              {m.label}
            </button>
          ))}
        </div>
        {g.upright.mode === 'guided' && tool !== 'upright-guide' && (
          <div className="row">
            <button className="sm" onClick={startGuides}>
              Edit guides ({g.upright.guides.length})
            </button>
          </div>
        )}
      </Section>
      <Section
        id="crop.transform"
        title="Transform"
        tip={TIPS['geometry.transform']}
        right={
          <button
            className="sm ghost"
            title="The sliders back to zero (the Upright mode stays)"
            onClick={() => {
              const u = g.upright
              if (
                !u.vertical &&
                !u.horizontal &&
                !u.rotate &&
                !u.aspect &&
                u.scale === 100 &&
                !u.offsetX &&
                !u.offsetY
              )
                return
              edit((r) =>
                Object.assign(r.geometry.upright, {
                  vertical: 0,
                  horizontal: 0,
                  rotate: 0,
                  aspect: 0,
                  scale: 100,
                  offsetX: 0,
                  offsetY: 0
                })
              )
              commit('Transform: reset')
            }}
          >
            Reset
          </button>
        }
      >
        <RS
          label="Vertical"
          read={(r) => r.geometry.upright.vertical}
          write={(r, v) => (r.geometry.upright.vertical = v)}
          title="Tilt top and bottom: straightens converging verticals"
        />
        <RS
          label="Horizontal"
          read={(r) => r.geometry.upright.horizontal}
          write={(r, v) => (r.geometry.upright.horizontal = v)}
        />
        <RS
          label="Rotate"
          read={(r) => r.geometry.upright.rotate}
          write={(r, v) => (r.geometry.upright.rotate = v)}
          step={0.5}
        />
        <RS
          label="Aspect"
          read={(r) => r.geometry.upright.aspect}
          write={(r, v) => (r.geometry.upright.aspect = v)}
        />
        <RS
          label="Scale"
          read={(r) => r.geometry.upright.scale}
          write={(r, v) => (r.geometry.upright.scale = v)}
          min={50}
          max={150}
          def={100}
        />
        <RS
          label="X offset"
          read={(r) => r.geometry.upright.offsetX}
          write={(r, v) => (r.geometry.upright.offsetX = v)}
        />
        <RS
          label="Y offset"
          read={(r) => r.geometry.upright.offsetY}
          write={(r, v) => (r.geometry.upright.offsetY = v)}
        />
      </Section>
    </ToolPanel>
  )
}

const UPRIGHT_MODES: { value: UprightMode; label: string; title: string }[] = [
  { value: 'off', label: 'Off', title: 'No perspective correction' },
  {
    value: 'auto',
    label: 'Auto',
    title: 'The most the lines support: Full, else Vertical, else Level'
  },
  { value: 'level', label: 'Level', title: 'Horizontal lines level' },
  { value: 'vertical', label: 'Vertical', title: 'Level, and vertical lines upright' },
  { value: 'full', label: 'Full', title: 'Level, vertical and horizontal perspective' },
  {
    value: 'guided',
    label: 'Guided',
    title: 'Draw two to four lines that should be upright or level'
  }
]
