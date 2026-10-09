/**
 * Lens corrections (the wheel's Lens tool): a profile for the lens the file
 * names, chromatic aberration measured on the photo, manual distortion and
 * vignetting, and defringe. The engine applies what `shared/lens.ts`
 * compiles; everything here is Playroom's choice of numbers.
 */
import { useEffect, useState } from 'react'
import type {
  CaMeasurement,
  LensCatalogStatus,
  LensMatch,
  LensSearchHit
} from '../../../shared/ipc'
import { describeLens, profileDistorts, profileName, type LensSetting } from '../../../shared/lens'
import { Section, Slider, Toggle, ToolPanel } from '../components/ui'
import { TechInfo } from '../components/TechInfo'
import { TIPS } from './tips'
import { api, errorText } from '../lib/api'
import { runJob } from '../state/busy'
import { useDevelop } from '../state/develop'
import { useLibrary } from '../state/library'
import { t, tk, tp } from '../lib/i18n'

type Num = (l: LensSetting) => number

const PURPLE_TRACK = 'linear-gradient(90deg,#4d5bff,#8a4dff,#c44dff,#ff4dd8,#ff4d7a)'
const GREEN_TRACK = 'linear-gradient(90deg,#ffd84d,#b8ff4d,#4dff6a,#4dffb8,#4de1ff)'

/** A slider on one number of the lens settings. */
function LS({
  label,
  undo,
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
  /** The History step's label, in English (shown translated). */
  undo: string
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
      onCommit={() => commit(undo)}
    />
  )
}

/** The catalogue's version, short: its first eight characters. */
const shortVersion = (v: string | null): string => (v ? v.slice(0, 8) : '—')

/**
 * The Profile section: the profile the photo uses (found for its lens, or
 * chosen), searched for across the whole catalogue, and what it was
 * resolved at. Matching and resolving are the main process's, where the
 * catalogue is; when the catalogue updates, a photo on an automatic match
 * follows it.
 */
function LensProfileSection(): React.JSX.Element | null {
  const session = useDevelop((s) => s.session)
  const recipe = useDevelop((s) => s.recipe)
  const edit = useDevelop((s) => s.edit)
  const commit = useDevelop((s) => s.commit)
  const say = useLibrary((s) => s.say)
  const [match, setMatch] = useState<LensMatch | null>(null)
  const [status, setStatus] = useState<LensCatalogStatus | null>(null)
  /** Bumped when the catalogue or the imported profiles change. */
  const [rev, setRev] = useState(0)
  const [picking, setPicking] = useState(false)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<LensSearchHit[]>([])
  const [checking, setChecking] = useState(false)
  const key = session?.key ?? null
  const id = recipe?.lens.profile.id ?? null

  useEffect(() => {
    void api.lens.status().then(setStatus, () => undefined)
    return api.lens.onChanged((st) => {
      setStatus(st)
      setRev((r) => r + 1)
    })
  }, [])

  // The photo's profile, again whenever the choice or the catalogue changes.
  useEffect(() => {
    if (!key) return
    let live = true
    void api.lens.resolve(key, id).then(
      (m) => {
        if (!live) return
        setMatch(m)
        // A catalogue update reaches a photo that uses a profile: it follows.
        const now = useDevelop.getState()
        const prof = now.recipe?.lens.profile
        if (
          rev > 0 &&
          now.session?.key === key &&
          prof?.enabled &&
          prof.id === id &&
          JSON.stringify(prof.resolved) !== JSON.stringify(m.resolved)
        ) {
          edit((r) => (r.lens.profile.resolved = m.resolved))
          commit(tk('Lens: profile updated'))
        }
      },
      () => undefined
    )
    return () => {
      live = false
    }
  }, [key, id, rev, edit, commit])

  // The search, a moment after typing stops.
  useEffect(() => {
    if (!picking || !query.trim()) return
    const timer = setTimeout(
      () => void api.lens.search(query).then(setHits, () => setHits([])),
      120
    )
    return () => clearTimeout(timer)
  }, [picking, query])

  if (!session || !recipe || !key) return null
  const l = recipe.lens
  const shot = session.info.lens
  const resolved = l.profile.enabled ? l.profile.resolved : null

  /** Resolve the profile for this photo in main and keep the result in the recipe. */
  const apply = async (enabled: boolean, pid: string | null, label: string): Promise<void> => {
    try {
      const m = await api.lens.resolve(key, pid)
      setMatch(m)
      edit((r) => {
        r.lens.profile.enabled = enabled
        r.lens.profile.id = pid
        r.lens.profile.resolved = m.resolved
      })
      commit(label)
    } catch (err) {
      say(errorText(err), 'error')
    }
  }

  const importProfile = async (): Promise<void> => {
    try {
      const added = await api.lens.importProfiles()
      if (added.length === 0) return
      setPicking(false)
      await apply(true, added[0].id, tk('Lens: import profile'))
      say(t('Imported {{names}}', { names: added.map((p) => profileName(p)).join(', ') }))
    } catch (err) {
      say(errorText(err), 'error')
    }
  }

  const check = async (): Promise<void> => {
    setChecking(true)
    try {
      const st = await api.lens.check()
      setStatus(st)
      say(
        st.error
          ? t('Lens profiles: {{error}}', { error: st.error })
          : tp(
              'Lens profiles are up to date ({{count}} lens, {{version}})',
              'Lens profiles are up to date ({{count}} lenses, {{version}})',
              st.lenses,
              { version: shortVersion(st.version) }
            ),
        st.error ? 'error' : 'info'
      )
    } finally {
      setChecking(false)
    }
  }

  const using = match?.profile
  const crop = resolved?.crop
  return (
    <Section
      id="lens.profile"
      title={t('Profile')}
      tip={TIPS['optics.profile']}
      right={
        <TechInfo title={t('Lens profile details')}>
          {resolved && (
            <p>
              {resolved.focal
                ? t('At {{focal}} mm', { focal: Math.round(resolved.focal * 10) / 10 })
                : t('At its middle focal')}
              {resolved.aperture ? `, f/${Math.round(resolved.aperture * 10) / 10}` : ''}
              {using?.calibrationCrop && crop
                ? ` · ${t('calibrated at crop {{calibration}}, this photo {{crop}}', {
                    calibration: using.calibrationCrop,
                    crop: crop.value
                  })}${
                    crop.from === 'camera' && match?.camera
                      ? ` (${match.camera.name})`
                      : crop.from === 'calibration'
                        ? ` (${t('assumed')})`
                        : ''
                  }`
                : ''}
            </p>
          )}
          <p>
            {t('Lens data: Lensfun (CC BY-SA 3.0)')} · {shortVersion(status?.version ?? null)}
            {status?.origin === 'online' ? ` · ${t('updated')}` : ''}
            {status
              ? ` · ${tp('{{count}} lens', '{{count}} lenses', status.lenses)}, ${tp(
                  '{{count}} camera',
                  '{{count}} cameras',
                  status.cameras
                )}${status.imported ? `, ${t('{{count}} imported', { count: status.imported })}` : ''}`
              : ''}
            {status?.error ? ` · ${t('last check: {{error}}', { error: status.error })}` : ''}
          </p>
          <button className="sm" disabled={checking} onClick={() => void check()}>
            {checking ? t('Checking…') : t('Check for updates')}
          </button>
        </TechInfo>
      }
    >
      <p className="muted small">{describeLens(shot) ?? t('The file names no lens.')}</p>
      <div className="row">
        <Toggle
          on={l.profile.enabled}
          onChange={(on) =>
            void apply(on, id, on ? tk('Lens: profile on') : tk('Lens: profile off'))
          }
          title={t('Correct distortion, vignetting and colour fringes from a profile of this lens')}
        >
          {t('Enable profile corrections')}
        </Toggle>
      </div>
      {l.profile.enabled && (
        <div className="lens-using">
          <span className="lens-using-name" title={using?.source ?? undefined}>
            {using
              ? id
                ? using.name
                : `${t('Auto')} · ${using.name}`
              : t('No profile found for this lens')}
          </span>
          <button className="sm ghost" onClick={() => setPicking((v) => !v)}>
            {picking ? t('Close') : t('Change…')}
          </button>
          {id && (
            <button
              className="sm ghost"
              onClick={() => void apply(true, null, tk('Lens: profile auto'))}
              title={t('Use the profile that matches the lens the file names')}
            >
              {t('Auto')}
            </button>
          )}
        </div>
      )}
      {l.profile.enabled && picking && (
        <div className="lens-pick">
          <input
            autoFocus
            placeholder={t('Search lenses: maker, model, mount…')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <ul>
            {(query.trim() ? hits : []).map((h) => (
              <li key={h.id}>
                <button
                  className={h.id === using?.id ? 'on' : ''}
                  onClick={() => {
                    setPicking(false)
                    void apply(true, h.id, tk('Lens: profile'))
                  }}
                >
                  <span>{h.name}</span>
                  <span className="muted micro">
                    {[h.mount, h.crop ? t('crop {{crop}}', { crop: h.crop }) : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </button>
              </li>
            ))}
            {query.trim() && hits.length === 0 && (
              <li className="muted small">{t('No lens found')}</li>
            )}
          </ul>
          <button className="sm ghost" onClick={() => void importProfile()}>
            {t('Import a profile…')}
          </button>
        </div>
      )}
      {l.profile.enabled && !resolved && !picking && (
        <p className="note small">{t('No profile for this lens: find one with Change….')}</p>
      )}
      {resolved && (
        <>
          <LS
            label={t('Distortion')}
            undo={tk('Lens: Distortion')}
            read={(x) => x.profile.distortion}
            write={(x, v) => (x.profile.distortion = v)}
            min={0}
            max={200}
            def={100}
            disabled={!resolved.distortion && !(resolved.fisheye && l.profile.defish)}
            format={(v) => `${Math.round(v)}%`}
          />
          <LS
            label={t('Vignetting')}
            undo={tk('Lens: Vignetting')}
            read={(x) => x.profile.vignetting}
            write={(x, v) => (x.profile.vignetting = v)}
            min={0}
            max={200}
            def={100}
            disabled={!resolved.vignetting}
            format={(v) => `${Math.round(v)}%`}
          />
          {resolved.fisheye && (
            <>
              <div className="row">
                <Toggle
                  on={l.profile.defish}
                  onChange={(on) => {
                    edit((r) => (r.lens.profile.defish = on))
                    commit(on ? tk('Lens: defish') : tk('Lens: keep the fisheye'))
                  }}
                  title={t(
                    "Make this fisheye's picture rectilinear: straight lines straight (its projection, from the profile)"
                  )}
                >
                  {t('Defish')}
                </Toggle>
              </div>
              {l.profile.defish && (
                <LS
                  label={t('Field')}
                  undo={tk('Lens: Field')}
                  read={(x) => x.profile.field}
                  write={(x, v) => (x.profile.field = v)}
                  min={50}
                  max={100}
                  def={100}
                  title={t(
                    "How much of the defished picture shows: lower brings more of the fisheye's edge into view"
                  )}
                  format={(v) => `${Math.round(v)}%`}
                />
              )}
              {l.profile.defish &&
                (recipe.layers.length > 0 ||
                  recipe.retouch.length > 0 ||
                  recipe.geometry.crop !== null) && (
                  <p className="note small">
                    {t(
                      'Defishing moves everything in the picture: masks, spots and the crop stay where they were drawn on the fisheye.'
                    )}
                  </p>
                )}
            </>
          )}
        </>
      )}
    </Section>
  )
}

export function LensPanel(): React.JSX.Element | null {
  const session = useDevelop((s) => s.session)
  const recipe = useDevelop((s) => s.recipe)
  const edit = useDevelop((s) => s.edit)
  const commit = useDevelop((s) => s.commit)
  const tool = useDevelop((s) => s.tool)
  const setTool = useDevelop((s) => s.setTool)
  const say = useLibrary((s) => s.say)
  const [measured, setMeasured] = useState<CaMeasurement | null>(null)
  const [measuring, setMeasuring] = useState(false)

  if (!session || !recipe) return null
  const l = recipe.lens
  const measureCa = async (): Promise<void> => {
    setMeasuring(true)
    try {
      const m = await runJob(t('Measuring chromatic aberration'), () =>
        api.develop.measureCa(session.key)
      )
      setMeasured(m)
      edit((r) => {
        r.lens.ca = m.ca
        r.lens.removeCa = true
      })
      commit(tk('Lens: remove chromatic aberration'))
      if (m.points === 0) say(t('No edges to measure: nothing to correct'), 'error')
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
      <LensProfileSection />

      <Section
        id="lens.ca"
        title={t('Chromatic aberration')}
        tip={TIPS['optics.ca']}
        right={
          measured || (l.removeCa && !l.ca && resolved?.tca) ? (
            <TechInfo title={t('Chromatic aberration measured')}>
              {measured ? (
                <p>
                  {tp(
                    'Red {{red0}} → {{red1}} · blue {{blue0}} → {{blue1}}, from {{count}} edge point',
                    'Red {{red0}} → {{red1}} · blue {{blue0}} → {{blue1}}, from {{count}} edge points',
                    measured.points,
                    {
                      red0: px(measured.red[0]),
                      red1: px(measured.red[1]),
                      blue0: px(measured.blue[0]),
                      blue1: px(measured.blue[1])
                    }
                  )}
                </p>
              ) : (
                <p>{t('From the lens profile.')}</p>
              )}
            </TechInfo>
          ) : undefined
        }
      >
        <div className="row">
          <Toggle
            on={l.removeCa}
            onChange={(on) => {
              if (on && !l.ca && !resolved?.tca) return void measureCa()
              edit((r) => (r.lens.removeCa = on))
              commit(
                on ? tk('Lens: remove chromatic aberration') : tk('Lens: keep chromatic aberration')
              )
            }}
            title={t('Line red and blue up with green, as measured on this photo')}
          >
            {t('Remove chromatic aberration')}
          </Toggle>
          {l.removeCa && (
            <button className="sm ghost" disabled={measuring} onClick={() => void measureCa()}>
              {measuring ? t('Measuring…') : t('Measure again')}
            </button>
          )}
        </div>
        {session.isHdr && !resolved?.tca && (
          <p className="muted small">{t('HDR photos take it from a lens profile.')}</p>
        )}
      </Section>

      <Section id="lens.manual" title={t('Manual')} tip={TIPS['optics.manual']}>
        <LS
          label={t('Distortion')}
          undo={tk('Lens: Distortion')}
          read={(x) => x.distortion}
          write={(x, v) => (x.distortion = v)}
          disabled={profileDistorts(l)}
          title={
            profileDistorts(l)
              ? t('The profile corrects distortion here; set its amount above')
              : t('Positive pulls barrel distortion in; negative pushes pincushion out')
          }
        />
        <LS
          label={t('Vignetting')}
          undo={tk('Lens: Vignetting')}
          read={(x) => x.vignetting}
          write={(x, v) => (x.vignetting = v)}
          title={t('Positive brightens the corners; negative darkens them')}
        />
        <LS
          label={t('Midpoint')}
          undo={tk('Lens: Midpoint')}
          read={(x) => x.vignettingMidpoint}
          write={(x, v) => (x.vignettingMidpoint = v)}
          min={0}
          max={100}
          def={50}
          disabled={l.vignetting === 0}
        />
      </Section>

      <Section
        id="lens.defringe"
        title={t('Defringe')}
        tip={TIPS['optics.defringe']}
        right={
          <Toggle
            on={tool === 'fringe-pick'}
            onChange={(on) => setTool(on ? 'fringe-pick' : 'none')}
            title={t('Click a purple or green fringe to aim at its hue')}
          >
            ⌖ {t('Pick')}
          </Toggle>
        }
      >
        <LS
          label={t('Purple amount')}
          undo={tk('Lens: Purple amount')}
          read={(x) => x.defringe.purpleAmount}
          write={(x, v) => (x.defringe.purpleAmount = v)}
          min={0}
          max={100}
        />
        <LS
          label={t('Purple hue')}
          undo={tk('Lens: Purple hue')}
          read={(x) => x.defringe.purpleHue}
          write={(x, v) => (x.defringe.purpleHue = v)}
          min={240}
          max={345}
          def={300}
          track={PURPLE_TRACK}
          format={(v) => `${Math.round(v)}°`}
        />
        <LS
          label={t('Green amount')}
          undo={tk('Lens: Green amount')}
          read={(x) => x.defringe.greenAmount}
          write={(x, v) => (x.defringe.greenAmount = v)}
          min={0}
          max={100}
        />
        <LS
          label={t('Green hue')}
          undo={tk('Lens: Green hue')}
          read={(x) => x.defringe.greenHue}
          write={(x, v) => (x.defringe.greenHue = v)}
          min={60}
          max={170}
          def={115}
          track={GREEN_TRACK}
          format={(v) => `${Math.round(v)}°`}
        />
      </Section>
    </ToolPanel>
  )
}
