/**
 * Lens corrections (the wheel's Lens tool): a profile for the lens the file
 * names, chromatic aberration measured on the photo, manual distortion and
 * vignetting, and defringe. The engine applies what `shared/lens.ts`
 * compiles; everything here is Playroom's choice of numbers.
 */
import { useEffect, useState } from 'react'
import type { CaMeasurement } from '../../../shared/ipc'
import {
  describeLens,
  matchProfile,
  profileDistorts,
  profileName,
  resolveProfile,
  type LensProfile,
  type LensSetting
} from '../../../shared/lens'
import type { Recipe } from '../../../shared/recipe'
import { Section, Select, Slider, Toggle, ToolPanel } from '../components/ui'
import { api, errorText } from '../lib/api'
import { runJob } from '../state/busy'
import { useDevelop } from '../state/develop'
import { useLibrary } from '../state/library'

type Num = (l: LensSetting) => number

const PURPLE_TRACK = 'linear-gradient(90deg,#4d5bff,#8a4dff,#c44dff,#ff4dd8,#ff4d7a)'
const GREEN_TRACK = 'linear-gradient(90deg,#ffd84d,#b8ff4d,#4dff6a,#4dffb8,#4de1ff)'

/** A slider on one number of the lens settings. */
function LS({
  label,
  read,
  write,
  min = -100,
  max = 100,
  def = 0,
  disabled,
  track,
  title,
  format
}: {
  label: string
  read: Num
  write: (l: LensSetting, v: number) => void
  min?: number
  max?: number
  def?: number
  disabled?: boolean
  track?: string
  title?: string
  format?: (v: number) => string
}): React.JSX.Element | null {
  const recipe = useDevelop((s) => s.recipe)
  const edit = useDevelop((s) => s.edit)
  const commit = useDevelop((s) => s.commit)
  if (!recipe) return null
  return (
    <Slider
      label={label}
      value={read(recipe.lens)}
      min={min}
      max={max}
      def={def}
      disabled={disabled}
      track={track}
      title={title}
      format={format}
      onChange={(v, live) => edit((r) => write(r.lens, v), live)}
      onCommit={() => commit(`Lens: ${label}`)}
    />
  )
}

/** The profile a lens setting stands for: the chosen one, else the one matching the lens. */
function chosenProfile(
  l: LensSetting,
  profiles: LensProfile[],
  lens: Parameters<typeof matchProfile>[0]
): LensProfile | null {
  return l.profile.id
    ? (profiles.find((p) => p.id === l.profile.id) ?? null)
    : matchProfile(lens, profiles)
}

export function LensPanel(): React.JSX.Element | null {
  const session = useDevelop((s) => s.session)
  const recipe = useDevelop((s) => s.recipe)
  const edit = useDevelop((s) => s.edit)
  const commit = useDevelop((s) => s.commit)
  const tool = useDevelop((s) => s.tool)
  const setTool = useDevelop((s) => s.setTool)
  const say = useLibrary((s) => s.say)
  const [profiles, setProfiles] = useState<LensProfile[]>([])
  const [measured, setMeasured] = useState<CaMeasurement | null>(null)
  const [measuring, setMeasuring] = useState(false)

  useEffect(() => {
    void api.lens.profiles().then(setProfiles, () => setProfiles([]))
  }, [])

  if (!session || !recipe) return null
  const l = recipe.lens
  const shot = session.info.lens
  const matched = matchProfile(shot, profiles)

  /** Resolve the profile for this photo and keep the result in the recipe. */
  const applyProfile = (r: Recipe, enabled: boolean, id: string | null, list = profiles): void => {
    r.lens.profile.enabled = enabled
    r.lens.profile.id = id
    const p = chosenProfile(r.lens, list, shot)
    r.lens.profile.resolved = p ? resolveProfile(p, shot) : null
  }

  const choose = async (v: string): Promise<void> => {
    if (v === 'import') {
      try {
        const added = await api.lens.importProfiles()
        if (added.length === 0) return
        const all = await api.lens.profiles()
        setProfiles(all)
        edit((r) => applyProfile(r, true, added[0].id, all))
        commit('Lens: import profile')
        say(`Imported ${added.map((p) => profileName(p)).join(', ')}`)
      } catch (err) {
        say(errorText(err), 'error')
      }
      return
    }
    edit((r) => applyProfile(r, true, v === 'auto' ? null : v))
    commit('Lens: profile')
  }

  const measureCa = async (): Promise<void> => {
    setMeasuring(true)
    try {
      const m = await runJob(
        'Measuring chromatic aberration',
        () => api.develop.measureCa(session.key),
        {
          detail: 'Red and blue against green, along the edges of the whole photo'
        }
      )
      setMeasured(m)
      edit((r) => {
        r.lens.ca = m.ca
        r.lens.removeCa = true
      })
      commit('Lens: remove chromatic aberration')
      if (m.points === 0) say('No edges to measure: nothing to correct', 'error')
    } catch (err) {
      say(errorText(err), 'error')
    } finally {
      setMeasuring(false)
    }
  }

  const resolved = l.profile.enabled ? l.profile.resolved : null
  const px = (v: number): string => `${v.toFixed(2)} px`

  return (
    <ToolPanel>
      <Section id="lens.profile" title="Profile">
        <p className="muted small">{describeLens(shot) ?? 'The file names no lens.'}</p>
        <div className="row">
          <Toggle
            on={l.profile.enabled}
            onChange={(on) => {
              edit((r) => applyProfile(r, on, r.lens.profile.id))
              commit(on ? 'Lens: profile on' : 'Lens: profile off')
            }}
            title="Correct distortion, vignetting and colour fringes from a profile of this lens"
          >
            Enable profile corrections
          </Toggle>
        </div>
        {l.profile.enabled && (
          <Select
            label="Profile"
            value={l.profile.id ?? 'auto'}
            onChange={(v) => void choose(v)}
            options={[
              {
                value: 'auto',
                label: matched ? `Auto — ${profileName(matched)}` : 'Auto — none found'
              },
              ...profiles.map((p) => ({ value: p.id, label: profileName(p) })),
              { value: 'import', label: 'Import profile…' }
            ]}
          />
        )}
        {l.profile.enabled && !resolved && (
          <p className="note small">
            No profile for this lens yet. Import one as JSON (Lensfun&apos;s models); profiles for
            common lenses are coming in an update.
          </p>
        )}
        {resolved && (
          <>
            <p className="muted small">
              {resolved.name}
              {resolved.focal ? ` at ${Math.round(resolved.focal * 10) / 10} mm` : ''}
              {resolved.aperture ? `, f/${Math.round(resolved.aperture * 10) / 10}` : ''}
            </p>
            <LS
              label="Distortion"
              read={(x) => x.profile.distortion}
              write={(x, v) => (x.profile.distortion = v)}
              min={0}
              max={200}
              def={100}
              disabled={!resolved.distortion}
              format={(v) => `${Math.round(v)}%`}
            />
            <LS
              label="Vignetting"
              read={(x) => x.profile.vignetting}
              write={(x, v) => (x.profile.vignetting = v)}
              min={0}
              max={200}
              def={100}
              disabled={!resolved.vignetting}
              format={(v) => `${Math.round(v)}%`}
            />
          </>
        )}
      </Section>

      <Section id="lens.ca" title="Chromatic aberration">
        <div className="row">
          <Toggle
            on={l.removeCa}
            onChange={(on) => {
              if (on && !l.ca && !resolved?.tca) return void measureCa()
              edit((r) => (r.lens.removeCa = on))
              commit(on ? 'Lens: remove chromatic aberration' : 'Lens: keep chromatic aberration')
            }}
            title="Line red and blue up with green, as measured on this photo"
          >
            Remove chromatic aberration
          </Toggle>
          {l.removeCa && (
            <button className="sm ghost" disabled={measuring} onClick={() => void measureCa()}>
              {measuring ? 'Measuring…' : 'Measure again'}
            </button>
          )}
        </div>
        {measured && (
          <p className="muted small">
            Red {px(measured.red[0])} → {px(measured.red[1])} · blue {px(measured.blue[0])} →{' '}
            {px(measured.blue[1])} ({measured.points} edge points)
          </p>
        )}
        {session.isHdr && !resolved?.tca && (
          <p className="muted small">
            Measuring needs an SDR picture: an HDR photo takes its CA from a profile.
          </p>
        )}
        {l.removeCa && !l.ca && resolved?.tca && <p className="muted small">From the profile.</p>}
      </Section>

      <Section id="lens.manual" title="Manual">
        <LS
          label="Distortion"
          read={(x) => x.distortion}
          write={(x, v) => (x.distortion = v)}
          disabled={profileDistorts(l)}
          title={
            profileDistorts(l)
              ? 'The profile corrects distortion here; set its amount above'
              : 'Positive pulls barrel distortion in; negative pushes pincushion out'
          }
        />
        <LS
          label="Vignetting"
          read={(x) => x.vignetting}
          write={(x, v) => (x.vignetting = v)}
          title="Positive brightens the corners; negative darkens them"
        />
        <LS
          label="Midpoint"
          read={(x) => x.vignettingMidpoint}
          write={(x, v) => (x.vignettingMidpoint = v)}
          min={0}
          max={100}
          def={50}
          disabled={l.vignetting === 0}
        />
        <p className="muted small">
          A correction that warps the frame crops its empty edges, keeping the frame&apos;s shape.
        </p>
      </Section>

      <Section
        id="lens.defringe"
        title="Defringe"
        right={
          <Toggle
            on={tool === 'fringe-pick'}
            onChange={(on) => setTool(on ? 'fringe-pick' : 'none')}
            title="Click a purple or green fringe to aim at its hue"
          >
            ⌖ Pick
          </Toggle>
        }
      >
        <LS
          label="Purple amount"
          read={(x) => x.defringe.purpleAmount}
          write={(x, v) => (x.defringe.purpleAmount = v)}
          min={0}
          max={100}
        />
        <LS
          label="Purple hue"
          read={(x) => x.defringe.purpleHue}
          write={(x, v) => (x.defringe.purpleHue = v)}
          min={240}
          max={345}
          def={300}
          track={PURPLE_TRACK}
          format={(v) => `${Math.round(v)}°`}
        />
        <LS
          label="Green amount"
          read={(x) => x.defringe.greenAmount}
          write={(x, v) => (x.defringe.greenAmount = v)}
          min={0}
          max={100}
        />
        <LS
          label="Green hue"
          read={(x) => x.defringe.greenHue}
          write={(x, v) => (x.defringe.greenHue = v)}
          min={60}
          max={170}
          def={115}
          track={GREEN_TRACK}
          format={(v) => `${Math.round(v)}°`}
        />
        <p className="muted small">Only along edges: flat colour of the same hue is left alone.</p>
      </Section>
    </ToolPanel>
  )
}
