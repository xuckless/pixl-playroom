/**
 * Settings (⌘, / Ctrl+,): the PIXL account, the licence, updates, crash reports, reporting a
 * problem, the legal pages, and the key bindings. And the one question the
 * first launch asks: may crash reports be sent?
 */
import { useEffect, useRef, useState } from 'react'
import { MAX_PROBLEM_TEXT } from '../../../shared/crash'
import type { AccountStatus } from '../../../shared/account'
import type { GpuDragState, Prefs, PreviewCacheState, UpdateState } from '../../../shared/ipc'
import { DEFAULT_PREVIEW_CAP, PREVIEW_CAPS } from '../../../shared/previews'
import { ACCOUNT_URL, BUY_URL, LICENCE_RULES, type LicenceStatus } from '../../../shared/licence'
import { latestNotes } from '../../../shared/releasenotes'
import {
  LOCATIONS_ASKED,
  type LocationKind,
  type LocationsInfo,
  type SaveLocation
} from '../../../shared/locations'
import { InfoTip } from '../components/InfoTip'
import { LocationField } from '../components/LocationField'
import { useLocations } from '../lib/useLocations'
import { Icon, type IconName } from '../components/icons'
import { Modal, Select } from '../components/ui'
import { api, errorText } from '../lib/api'
import { openReport, takeReportFocus } from '../lib/report'
import { chooseLanguage, rich, t, tk, tp, useLanguage } from '../lib/i18n'
import { useLibrary } from '../state/library'
import { useUi, FLAT_THEMES, THEMES, type Theme } from '../state/ui'
import { KeyBindingsSection } from './KeyBindings'
import { ModelsSection } from './ModelsSection'
import { openReleaseNotes } from '../state/whatsNew'
import {
  DEFAULT_DISPLAY_SETTING,
  normaliseDisplaySetting,
  type DisplayHdr,
  type DisplayHdrSetting
} from '../../../shared/hdrdisplay'
import { isBetaTranslation, LANGUAGES, type LanguageSetting } from '../../../shared/i18n'

const LEGAL = 'https://playroom.pixlfoundation.com/legal'

/**
 * A problem the user found, in their words, sent when they press Send: with
 * an email if they want a reply, and the end of the app's log unless they
 * untick it (scrubbed of the home folder in main).
 */
function ReportSection(): React.JSX.Element {
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [includeLog, setIncludeLog] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  const field = useRef<HTMLFieldSetElement>(null)
  const text = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (!takeReportFocus()) return
    field.current?.scrollIntoView({ block: 'start' })
    text.current?.focus()
  }, [])
  const send = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      setSent(await api.app.reportProblem({ message, email, includeLog }))
      setMessage('')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }
  const stop = (e: React.KeyboardEvent): void => e.stopPropagation()
  return (
    <fieldset ref={field}>
      <legend>{t('Report a problem')}</legend>
      <p className="muted small">
        {t(
          'Found a bug? Say what you did, what happened and what you expected. It goes to the Playroom team only; add an email if you’d like a reply.'
        )}
      </p>
      <textarea
        ref={text}
        className="report-text"
        value={message}
        maxLength={MAX_PROBLEM_TEXT}
        placeholder={t('What happened?')}
        aria-label={t('What happened?')}
        onChange={(e) => {
          setMessage(e.target.value)
          setSent(null)
        }}
        onKeyDown={stop}
      />
      <input
        type="email"
        value={email}
        placeholder={t('Email for a reply (optional)')}
        aria-label={t('Email for a reply (optional)')}
        autoComplete="email"
        onChange={(e) => setEmail(e.target.value)}
        onKeyDown={stop}
      />
      <label className="check">
        <input
          type="checkbox"
          checked={includeLog}
          onChange={(e) => setIncludeLog(e.target.checked)}
        />
        {t(
          'Include Playroom’s recent log (it names the files it worked on; your home folder is hidden)'
        )}
      </label>
      <div className="prefs-row">
        <button className="primary" disabled={busy || !message.trim()} onClick={() => void send()}>
          {busy ? t('Sending…') : t('Send report')}
        </button>
        {sent && (
          <span className="prefs-status" role="status">
            {t('Sent, thank you. Reference {{reference}}.', { reference: sent })}
          </span>
        )}
      </div>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  )
}

function updateLine(s: UpdateState): string {
  switch (s.phase) {
    case 'disabled':
      return t('Updates are off in development builds.')
    case 'checking':
      return t('Checking for updates…')
    case 'available':
      return t('Version {{version}} is available; downloading…', { version: s.version })
    case 'downloading':
      return s.version
        ? t('Downloading {{version}}… {{percent}}%', {
            version: s.version,
            percent: Math.round(s.progress?.percent ?? 0)
          })
        : t('Downloading the update… {{percent}}%', {
            percent: Math.round(s.progress?.percent ?? 0)
          })
    case 'downloaded':
      return t('Version {{version}} is ready. It installs when you quit, or restart now.', {
        version: s.version
      })
    case 'not-available':
      return t('Playroom is up to date.')
    case 'error':
      return t('Couldn’t check for updates: {{error}}', { error: s.error ?? t('unknown error') })
    default:
      return t('Playroom checks for updates at launch and every few hours.')
  }
}

/** The PIXL account: sign in through the browser, or who is signed in and Sign out. */
function AccountSection(): React.JSX.Element | null {
  const say = useLibrary((s) => s.say)
  const [status, setStatus] = useState<AccountStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void api.account.status().then(setStatus)
    return api.account.onChange(setStatus)
  }, [])
  if (!status?.visible) return null
  const run = async (fn: () => Promise<AccountStatus>, done?: string): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const next = await fn()
      setStatus(next)
      if (done && next.signedIn === (done === 'Signed in')) say(t(done))
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }
  const who = status.name && status.email ? `${status.name} (${status.email})` : status.email
  return (
    <fieldset>
      <legend>{t('PIXL account')}</legend>
      <p className="prefs-status" role="status" aria-live="polite">
        {status.signedIn
          ? t('Signed in as {{who}}.', { who: who ?? t('your PIXL account') })
          : status.signingIn
            ? t('Finish signing in in your browser…')
            : t('Not signed in.')}
      </p>
      <p className="muted small">
        {t('One account for every PIXL app. Beta access, your trial and your licence live on it.')}
      </p>
      <div className="prefs-row">
        {status.signedIn ? (
          <>
            <button
              disabled={busy}
              onClick={() => void run(() => api.account.signOut(), tk('Signed out'))}
            >
              {t('Sign out')}
            </button>
            <a href={ACCOUNT_URL} target="_blank" rel="noreferrer">
              {t('Manage account')}
            </a>
          </>
        ) : status.signingIn ? (
          <button onClick={() => void api.account.cancelSignIn()}>{t('Cancel')}</button>
        ) : (
          <button
            className="primary"
            disabled={busy}
            onClick={() => void run(() => api.account.signIn(), tk('Signed in'))}
          >
            {t('Sign in…')}
          </button>
        )}
      </div>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  )
}

function licenceLine(s: LicenceStatus): string {
  const st = s.state
  switch (st.kind) {
    case 'signed-out':
      return t('Sign in above to start your free trial, or to use your licence.')
    case 'checking':
      return t('Checking your account…')
    case 'no-trial':
      return t('Your {{days}}-day free trial is ready to start.', {
        days: LICENCE_RULES.trialDays
      })
    case 'trial':
      return tp('Free trial: {{count}} day left.', 'Free trial: {{count}} days left.', st.daysLeft)
    case 'trial-ended':
      return t('Your free trial has ended.')
    case 'licensed':
      return t('Licensed. Pixl Playroom works on up to {{count}} of your devices.', {
        count: s.deviceLimit
      })
    case 'beta':
      return t('Beta access. Thanks for testing.')
    case 'revalidate':
      return t('Connect to the internet so Playroom can confirm your licence.')
    case 'device-limit':
      return t('Your licence is already on {{count}} devices. Free one to use it here.', {
        count: s.deviceLimit
      })
    case 'no-beta':
      return t('This account isn’t in the beta yet.')
    case 'beta-ended':
      return t('The beta has ended.')
  }
}

const shortDate = (unixS: number): string =>
  new Date(unixS * 1000).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  })

/** Access from the PIXL account: the trial, the licence or beta access; start the trial, free a device. */
function LicenceSection(): React.JSX.Element | null {
  const say = useLibrary((s) => s.say)
  const [status, setStatus] = useState<LicenceStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void api.licence.status().then(setStatus)
    return api.licence.onChange(setStatus)
  }, [])
  if (!status?.visible) return null
  const run = async (fn: () => Promise<LicenceStatus>, done?: string): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      setStatus(await fn())
      if (done) say(done)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }
  const kind = status.state.kind
  const check = (
    <button disabled={busy} onClick={() => void run(() => api.licence.refresh())}>
      {t('Check now')}
    </button>
  )
  const buy = (
    <a href={BUY_URL} target="_blank" rel="noreferrer">
      {t('Buy a licence')}
    </a>
  )
  return (
    <fieldset>
      <legend>{t('Licence')}</legend>
      <p className="prefs-status" role="status" aria-live="polite">
        {licenceLine(status)}
      </p>
      {status.locked && <p className="note small">{status.locked}</p>}
      {status.discount && (
        <p className="small">
          {rich(
            'Your tester discount: {{code}}, until {{date}}.',
            { code: <strong>{status.discount.code}</strong> },
            { date: shortDate(status.discount.expires) }
          )}
        </p>
      )}
      {!status.enforced && (
        <p className="muted small">
          {t(
            'Licences aren’t required yet: every feature works either way. Once they are, an ended trial stops exporting only; editing keeps working.'
          )}
        </p>
      )}
      {status.state.kind === 'device-limit' && (
        <ul className="prefs-devices">
          {status.state.devices.map((d) => (
            <li key={d.id}>
              <span>{d.name}</span>
              <button
                disabled={busy}
                onClick={() =>
                  void run(
                    () => api.licence.freeDevice(d.id),
                    t('{{name}} freed', { name: d.name })
                  )
                }
              >
                {t('Free|device')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {kind !== 'signed-out' && (
        <div className="prefs-row">
          {kind === 'no-trial' && (
            <button
              className="primary"
              disabled={busy}
              onClick={() => void run(() => api.licence.startTrial(), t('Free trial started'))}
            >
              {t('Start free trial')}
            </button>
          )}
          {kind !== 'no-trial' && check}
          {kind === 'no-trial' || kind === 'trial' || kind === 'trial-ended' || kind === 'beta'
            ? buy
            : null}
          {(kind === 'licensed' || kind === 'device-limit') && (
            <a href={ACCOUNT_URL} target="_blank" rel="noreferrer">
              {t('Manage devices')}
            </a>
          )}
        </div>
      )}
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  )
}

/**
 * Where a photo's `.pixl` project is made, on its first edit: beside the
 * photo, or in a projects folder (one subfolder per photo folder). Projects
 * already made stay where they are.
 */
function ProjectsSection({
  info,
  save
}: {
  info: LocationsInfo | null
  save: (kind: LocationKind, v: SaveLocation) => void
}): React.JSX.Element {
  const say = useLibrary((s) => s.say)
  const [embed, setEmbed] = useState(true)
  useEffect(() => {
    void api.app.getSetting<boolean>('projects.embedOriginal').then((v) => setEmbed(v !== false))
  }, [])
  return (
    <fieldset>
      <legend>
        {t('Projects')}
        <InfoTip
          label={t('Projects')}
          tip={{
            what: t(
              'A photo’s first edit makes its project: one .pixl file with its edits, copies, snapshots and whole history.'
            ),
            expect: t(
              'Beside the photo, a project goes wherever the file goes; a photo folder that cannot be written (a locked card) puts its projects in the Pixl Projects folder. If a projects folder you chose cannot be written, the edit says so and nothing is saved elsewhere. Projects already made stay where they are.'
            )
          }}
        />
      </legend>
      {info && <LocationField kind="projects" info={info} save={save} />}
      <label className="check">
        <input
          type="checkbox"
          checked={embed}
          onChange={(e) => {
            setEmbed(e.target.checked)
            void api.app
              .setSetting('projects.embedOriginal', e.target.checked)
              .catch((err) => say(errorText(err), 'error'))
          }}
        />
        {t('Carry a copy of the original in each project')}
        <InfoTip
          label={t('Carry the original')}
          tip={{
            what: t(
              'The project then needs nothing else: move or lose the photo and it still opens, develops and exports.'
            ),
            expect: t(
              'Each original is kept as small as it can be without losing a bit (a RAW as lossless DNG, a JPEG repacked into JPEG XL), so a project takes about as much space as its photo again.'
            )
          }}
        />
      </label>
    </fieldset>
  )
}

/** Where exported files are saved: the same three choices as projects, and the Export dialog's own. */
function ExportsSection({
  info,
  save
}: {
  info: LocationsInfo | null
  save: (kind: LocationKind, v: SaveLocation) => void
}): React.JSX.Element {
  return (
    <fieldset>
      <legend>
        {t('Exports')}
        <InfoTip
          label={t('Exports')}
          tip={{
            what: t(
              'Where the files you export are saved. In the Pixl Projects folder, each photo folder gets a folder of its own name under Exports.'
            ),
            expect: t(
              'The Export dialog shows the same choice: changing it there changes it here. Files already exported stay where they are.'
            )
          }}
        />
      </legend>
      {info && <LocationField kind="exports" info={info} save={save} />}
    </fieldset>
  )
}

/** Projects and exports: one read of where each is saved, shared by both. */
function SavingSections(): React.JSX.Element {
  const { info, save } = useLocations()
  return (
    <>
      <ProjectsSection info={info} save={save} />
      <ExportsSection info={info} save={save} />
    </>
  )
}

function useUpdates(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null)
  useEffect(() => {
    void api.updates.getState().then(setState)
    return api.updates.onState(setState)
  }, [])
  return state
}

type SettingsSection = 'general' | 'library' | 'display' | 'ai' | 'keys' | 'privacy'

/** Settings in sections, across the top as Export's steps are. */
const SECTIONS: { id: SettingsSection; label: string; icon: IconName }[] = [
  { id: 'general', label: tk('General'), icon: 'settings' },
  { id: 'library', label: tk('Projects & interface'), icon: 'library' },
  { id: 'display', label: tk('Display'), icon: 'overlay' },
  { id: 'ai', label: tk('AI models'), icon: 'smart' },
  { id: 'keys', label: tk('Key bindings'), icon: 'grip' },
  { id: 'privacy', label: tk('Privacy & about'), icon: 'info' }
]

const SECTION_KEY = 'playroom.settings.section'

function storedSection(): SettingsSection {
  try {
    const v = localStorage.getItem(SECTION_KEY)
    if (SECTIONS.some((x) => x.id === v)) return v as SettingsSection
  } catch {
    // No storage here: the first section.
  }
  return 'general'
}

export function PreferencesDialog(): React.JSX.Element {
  const setDialog = useLibrary((s) => s.setDialog)
  const [section, setSectionState] = useState<SettingsSection>(storedSection)
  const setSection = (v: SettingsSection): void => {
    setSectionState(v)
    try {
      localStorage.setItem(SECTION_KEY, v)
    } catch {
      // Remembered for this time only.
    }
  }
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  useEffect(() => {
    void api.prefs.get().then(setPrefs)
  }, [])
  return (
    <Modal
      title={t('Settings')}
      onClose={() => setDialog(null)}
      wide
      icon="settings"
      className="prefs"
    >
      <nav className="ew-steps" aria-label={t('Settings sections')}>
        {SECTIONS.map((x) => (
          <button
            key={x.id}
            className={`ew-step${x.id === section ? ' on' : ''}`}
            aria-current={x.id === section ? 'page' : undefined}
            onClick={() => setSection(x.id)}
          >
            <Icon name={x.icon} />
            {t(x.label)}
          </button>
        ))}
      </nav>
      <div className={`ps-body ${section}`} key={section}>
        {section === 'general' && (
          <GeneralSettings
            prefs={prefs}
            onReport={() => {
              // Settings is open already: to Report a problem, which takes the focus.
              openReport()
              setSection('privacy')
            }}
          />
        )}
        {section === 'library' && (
          <>
            <SavingSections />
            <InterfaceSection />
            <PerformanceSection />
            <StorageSection />
          </>
        )}
        {section === 'display' && <DisplaySection platform={prefs?.platform ?? null} />}
        {section === 'ai' && <ModelsSection />}
        {section === 'keys' && <KeyBindingsSection />}
        {section === 'privacy' && <PrivacySettings prefs={prefs} setPrefs={setPrefs} />}
      </div>
    </Modal>
  )
}

/**
 * The display the HDR preview renders for (engine 0.18 never reads one):
 * on a Mac, Automatic reads the screen's headroom; anywhere, the SDR white
 * and peak can be stated. On Windows, Automatic takes typical numbers when
 * the system says the screen shows HDR, until Playroom reads it there too.
 */
function DisplaySection({ platform }: { platform: string | null }): React.JSX.Element {
  const say = useLibrary((s) => s.say)
  const [setting, setSetting] = useState<DisplayHdrSetting>(DEFAULT_DISPLAY_SETTING)
  const [now, setNow] = useState<DisplayHdr | null>(null)
  useEffect(() => {
    void api.app
      .getSetting<unknown>('display.hdr')
      .then((v) => setSetting(normaliseDisplaySetting(v)))
    void api.app.displayHdr().then(setNow)
    return api.app.onDisplayHdr(setNow)
  }, [])
  const save = (next: DisplayHdrSetting): void => {
    const n = normaliseDisplaySetting(next)
    setSetting(n)
    void api.app
      .setDisplayHdr(n)
      .then(setNow)
      .catch((e) => say(errorText(e), 'error'))
  }
  const mac = platform === 'darwin'
  return (
    <fieldset>
      <legend>
        {t('Display')}
        <InfoTip
          label={t('Display')}
          tip={{
            what: t(
              'The screen Full HDR renders for: how bright its standard white is and how bright it can go.'
            ),
            expect: mac
              ? t(
                  'Automatic reads your Mac’s screen, and follows its brightness. State the numbers only to preview for another screen.'
                )
              : t(
                  'Automatic turns Full HDR on when Windows shows HDR, with typical values (white 203, peak 1000). State your screen’s own (in Windows’ HDR settings, or its specifications) for a closer preview.'
                )
          }}
        />
      </legend>
      <Select
        label={t('Brightness')}
        value={setting.mode}
        options={[
          {
            value: 'auto',
            label: mac ? t('Automatic (read the screen)') : t('Automatic (detect HDR)')
          },
          { value: 'stated', label: t('Stated') }
        ]}
        onChange={(v) => save({ ...setting, mode: v as DisplayHdrSetting['mode'] })}
      />
      {setting.mode === 'stated' && (
        <div className="prefs-row display-nits">
          <label className="field">
            <span>{t('SDR white (cd/m²)')}</span>
            <input
              type="number"
              min={80}
              max={500}
              defaultValue={setting.whiteNits}
              key={`w${setting.whiteNits}`}
              onBlur={(e) => save({ ...setting, whiteNits: Number(e.target.value) })}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </label>
          <label className="field">
            <span>{t('Peak (cd/m²)')}</span>
            <input
              type="number"
              min={100}
              max={10000}
              defaultValue={setting.peakNits}
              key={`p${setting.peakNits}`}
              onBlur={(e) => save({ ...setting, peakNits: Number(e.target.value) })}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </label>
        </div>
      )}
      {now && (
        <p className="muted small">
          {now.hdr && now.source === 'detected'
            ? t('Now: HDR, with typical values (white {{white}}, peak {{peak}} cd/m²).', {
                white: now.whiteNits,
                peak: Math.round(now.peakNits)
              })
            : now.hdr
              ? now.potential
                ? t(
                    'Now: {{headroom}}× headroom (white {{white}}, peak {{peak}} cd/m²), up to {{potential}}× on this screen.',
                    {
                      headroom: now.headroom,
                      white: now.whiteNits,
                      peak: Math.round(now.peakNits),
                      potential: now.potential
                    }
                  )
                : t('Now: {{headroom}}× headroom (white {{white}}, peak {{peak}} cd/m²).', {
                    headroom: now.headroom,
                    white: now.whiteNits,
                    peak: Math.round(now.peakNits)
                  })
              : now.potential && now.potential > 1
                ? t('Now: SDR. This screen reaches {{potential}}× when it shows HDR.', {
                    potential: now.potential
                  })
                : t('Now: SDR.')}
        </p>
      )}
    </fieldset>
  )
}

/**
 * GPU dragging (engine 0.19.2, Phase A §4.3): while a slider moves, the
 * preview is graded on the graphics chip from a frame uploaded once per
 * photo; the release and every export still render on the processor. On
 * unless turned off, and shown only where this build and computer have it
 * (Metal on a Mac, Direct3D 12 on Windows).
 */
function PerformanceSection(): React.JSX.Element | null {
  const say = useLibrary((s) => s.say)
  const [state, setState] = useState<GpuDragState | null>(null)
  useEffect(() => {
    void api.app.gpuDrag().then(setState)
  }, [])
  if (!state?.available) return null
  return (
    <fieldset>
      <legend>{t('Performance')}</legend>
      <label className="check">
        <input
          type="checkbox"
          checked={state.on}
          onChange={(e) =>
            void api.app
              .setGpuDrag(e.target.checked)
              .then(setState)
              .catch((err) => say(errorText(err), 'error'))
          }
        />
        {t('Drag sliders on the graphics chip')}
        <InfoTip
          label={t('Drag sliders on the graphics chip')}
          tip={{
            what: t(
              'While a slider moves, the preview can be graded on the graphics chip: at the full preview size, where the processor shows a smaller draft. When you let go, the picture renders on the processor, as an export does.'
            ),
            expect: state.constrained
              ? t(
                  'It takes an edit made only of Contrast, Highlights, Shadows, Whites, Blacks, Saturation, HSL and Dehaze, on a photo that is not a RAW. A RAW, and an edit with anything else (white balance, curves, a profile, effects, masks, smoothing), drags on the processor, as before. On this Mac only the open photo keeps its copy on the graphics chip, and Highlights, Shadows, Whites and Blacks drag without Keep texture until you let go. Turn it off if a drag looks different from the picture you let go on.'
                )
              : t(
                  'It takes an edit made only of Contrast, Highlights, Shadows, Whites, Blacks, Saturation, HSL and Dehaze, on a photo that is not a RAW. A RAW, and an edit with anything else (white balance, curves, a profile, effects, masks, smoothing), drags on the processor, as before. The open photo keeps a copy on the graphics chip (about 130–250 MB). Turn it off if a drag looks different from the picture you let go on.'
                )
          }}
        />
      </label>
    </fieldset>
  )
}

/** A size on disk, as people read it ("1.4 GB", "320 MB"). */
function sizeLabel(bytes: number): string {
  const gb = bytes / 1024 ** 3
  const n = (v: number, digits: number): string =>
    new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(v)
  return gb >= 1
    ? t('{{size}} GB', { size: n(gb, 1) })
    : t('{{size}} MB', { size: n(bytes / 1024 ** 2, 0) })
}

/**
 * The Library's previews (the Loupe's, Compare's and Survey's pictures):
 * how much room they take, the most they may, and emptying them. Past the
 * cap the least recently shown go; they are made again when shown.
 */
function StorageSection(): React.JSX.Element {
  const say = useLibrary((s) => s.say)
  const [state, setState] = useState<PreviewCacheState | null>(null)
  useEffect(() => {
    void api.library.previewCache().then(setState, () => undefined)
  }, [])
  const cap = state?.cap ?? DEFAULT_PREVIEW_CAP
  // A cap set some other way is offered too, in its place.
  const caps = PREVIEW_CAPS.includes(cap)
    ? PREVIEW_CAPS
    : [...PREVIEW_CAPS, cap].sort((a, b) => a - b)
  return (
    <fieldset>
      <legend>{t('Storage')}</legend>
      <div className="pref-row">
        <Select<string>
          label={t('Library previews')}
          value={String(cap)}
          options={caps.map((c) => ({
            value: String(c),
            label: t('Up to {{size}}', { size: sizeLabel(c) })
          }))}
          onChange={(v) =>
            void api.library
              .setPreviewCap(Number(v))
              .then(setState)
              .catch((err) => say(errorText(err), 'error'))
          }
        />
        <InfoTip
          label={t('Library previews')}
          tip={{
            what: t(
              'The large pictures the Loupe, Compare and Survey show, kept so a photo comes up at once the next time.'
            ),
            expect: t(
              'Past the limit the ones shown longest ago go first, and are made again when shown. Your photos and their edits are never touched.'
            )
          }}
        />
      </div>
      <div className="row between">
        <span className="muted small t-num">
          {state ? t('{{size}} in use', { size: sizeLabel(state.bytes) }) : '…'}
        </span>
        <button
          className="sm"
          disabled={!state || state.bytes === 0}
          onClick={() =>
            void api.library
              .clearPreviews()
              .then((s) => {
                setState(s)
                say(t('Library previews cleared'))
              })
              .catch((err) => say(errorText(err), 'error'))
          }
        >
          {t('Clear previews')}
        </button>
      </div>
    </fieldset>
  )
}

/** How the interface draws itself: the efficient UI always, or only while Playroom is behind. */
function InterfaceSection(): React.JSX.Element {
  const alwaysFlat = useUi((s) => s.alwaysFlat)
  const setAlwaysFlat = useUi((s) => s.setAlwaysFlat)
  const cullSuggest = useUi((s) => s.cullSuggest)
  const setCullSuggest = useUi((s) => s.setCullSuggest)
  const theme = useUi((s) => s.theme)
  const setTheme = useUi((s) => s.setTheme)
  const nodeView = useUi((s) => s.nodeView)
  const setNodeView = useUi((s) => s.setNodeView)
  return (
    <fieldset>
      <legend>{t('Interface')}</legend>
      <div className="pref-row">
        <Select<Theme>
          label={t('Theme')}
          value={theme}
          options={THEMES.map((x) => ({ value: x.value, label: t(x.label) }))}
          onChange={setTheme}
        />
        <InfoTip
          label={t('Theme')}
          tip={{
            what: t(
              'How Playroom looks: Signature, flat and quiet in layered blacks; Modern, black, purple and electric cyan, with glow; Studio, neutral greys for judging colour; High contrast, pure black and white with strong lines.'
            ),
            expect: t(
              'Only the interface changes: your photos and their edits look the same in every theme.'
            )
          }}
        />
      </div>
      <label className="check">
        <input type="checkbox" checked={nodeView} onChange={(e) => setNodeView(e.target.checked)} />
        {t('Node view (advanced)')}
        <InfoTip
          label={t('Node view')}
          tip={{
            what: t(
              'The masks pane shows the grade as Resolve’s nodes: the photo’s own correction, then each qualifier, each mask and any advanced layer, in the order they run. Switch a node off, pick it to edit it, drag it within its group.'
            ),
            expect: t('Off, the masks pane is the plain list of masks.')
          }}
        />
      </label>
      <label className="check" hidden={FLAT_THEMES.includes(theme)}>
        <input
          type="checkbox"
          checked={alwaysFlat}
          onChange={(e) => setAlwaysFlat(e.target.checked)}
        />
        {t('Always flat')}
        <InfoTip
          label={t('Always flat')}
          tip={{
            what: t(
              'Glass panels become flat colour, and nothing animates: no moving backgrounds, no transitions.'
            ),
            expect: t(
              'Playroom already does this while another app is in front. On, it stays that way when Playroom is in front too: lighter on the battery and the graphics chip.'
            )
          }}
        />
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={cullSuggest}
          onChange={(e) => setCullSuggest(e.target.checked)}
        />
        {t('Suggest rejects in the Library')}
        <InfoTip
          label={t('Suggest rejects')}
          tip={{
            what: t(
              'Photos that look like rejects (a soft frame in a burst, a subject softer than its background, too dark or too bright, eyes that may be closed) show dimmed and grey; hover one for why, and Keep or Reject it.'
            ),
            expect: t(
              'Measured on this computer while it is idle and plugged in, or at once with Filters → Suggested rejects. A star, a pick or Keep means it is never suggested again, and what you keep and reject tunes the suggestions. Nothing is ever deleted.'
            )
          }}
        />
      </label>
    </fieldset>
  )
}

/**
 * The language Playroom speaks: the system's (when it is one of ours), or one
 * chosen. Choosing draws the app again in it. Not English: a note that the
 * translation is ours, with a way to report its wording.
 */
function LanguageSection({ onReport }: { onReport: () => void }): React.JSX.Element {
  const setting = useLanguage((s) => s.setting)
  const language = useLanguage((s) => s.language)
  // What choosing System gives, as main reads the OS (the same reading it switches by).
  const system = useLanguage((s) => s.system)
  const systemName = LANGUAGES.find((l) => l.code === system)?.name ?? system
  return (
    <fieldset style={{ paddingTop: 14 }}>
      <Select<LanguageSetting>
        label={t('Language')}
        value={setting}
        options={[
          { value: 'system', label: t('System ({{language}})', { language: systemName }) },
          ...LANGUAGES.map((l) => ({ value: l.code, label: l.name }))
        ]}
        onChange={(v) => void chooseLanguage(v)}
      />
      {isBetaTranslation(language) && (
        <p className="muted small">
          {t('Beta translation: written by us, not yet checked by a native speaker.')}{' '}
          <button className="link" onClick={onReport}>
            {t('Report wording')}
          </button>
        </p>
      )}
    </fieldset>
  )
}

/** General: the language, the account, the licence and updates. */
function GeneralSettings({
  prefs,
  onReport
}: {
  prefs: Prefs | null
  onReport: () => void
}): React.JSX.Element {
  const say = useLibrary((s) => s.say)
  const update = useUpdates()
  const busy = update?.phase === 'checking' || update?.phase === 'downloading'
  return (
    <>
      <LanguageSection onReport={onReport} />
      <AccountSection />
      <LicenceSection />
      <fieldset>
        <legend>{t('Updates')}</legend>
        <p className="muted small">
          Pixl Playroom {prefs?.version ?? update?.currentVersion ?? ''}
          {prefs ? ` · ${prefs.platform} ${prefs.arch}` : ''}
        </p>
        {update && (
          <>
            {update.currentVersion.includes('-beta') ? (
              <p className="muted small">
                {t(
                  'This beta follows the beta channel: it gets every beta, and the release when it comes.'
                )}
              </p>
            ) : (
              <Select
                label={t('Channel')}
                value={update.channel}
                options={[
                  { value: 'latest', label: t('Stable') },
                  { value: 'beta', label: t('Beta (early builds)') }
                ]}
                onChange={(c) =>
                  void api.updates.setChannel(c).catch((e) => say(errorText(e), 'error'))
                }
              />
            )}
            <p className="prefs-status" role="status" aria-live="polite">
              {updateLine(update)}
            </p>
            <div className="prefs-row">
              <button
                disabled={update.phase === 'disabled' || busy}
                onClick={() => void api.updates.check().catch((e) => say(errorText(e), 'error'))}
              >
                {t('Check now')}
              </button>
              {update.phase === 'downloaded' && (
                <button className="primary" onClick={() => void api.updates.install()}>
                  {t('Restart to update')}
                </button>
              )}
              {latestNotes(update.currentVersion) && (
                <button className="link" onClick={() => openReleaseNotes(update.currentVersion)}>
                  {t('What’s new')}
                </button>
              )}
            </div>
          </>
        )}
      </fieldset>
    </>
  )
}

/** Privacy & about: crash reports, reporting a problem, the legal pages. */
function PrivacySettings({
  prefs,
  setPrefs
}: {
  prefs: Prefs | null
  setPrefs: React.Dispatch<React.SetStateAction<Prefs | null>>
}): React.JSX.Element {
  const say = useLibrary((s) => s.say)
  return (
    <>
      <fieldset>
        <legend>{t('Privacy')}</legend>
        <label className="check">
          <input
            type="checkbox"
            checked={prefs?.crashReports === 'on'}
            disabled={!prefs}
            onChange={async (e) => {
              const crashReports = await api.prefs.setCrashReports(e.target.checked ? 'on' : 'off')
              setPrefs((p) => (p ? { ...p, crashReports } : p))
            }}
          />
          {t('Send crash reports')}
        </label>
        <p className="muted small">
          {t(
            'When Playroom crashes or hits an error, send a report so it can be fixed: what went wrong, the app version and your system. Never your photos, and never your folder names.'
          )}
        </p>
      </fieldset>

      <ReportSection />

      <fieldset>
        <legend>{t('About')}</legend>
        <div className="prefs-links">
          <a href={`${LEGAL}/eula/`} target="_blank" rel="noreferrer">
            {t('Licence agreement')}
          </a>
          <a href={`${LEGAL}/privacy/`} target="_blank" rel="noreferrer">
            {t('Privacy policy')}
          </a>
          <button
            className="link"
            onClick={() => void api.app.openNotices().catch((e) => say(errorText(e), 'error'))}
          >
            {t('Third-party notices')}
          </button>
          {prefs?.version.includes('-beta') && (
            <button
              className="link"
              onClick={() => void api.app.openBetaTerms().catch((e) => say(errorText(e), 'error'))}
            >
              {t('Beta terms')}
            </button>
          )}
        </div>
      </fieldset>
    </>
  )
}

/** Asked once, at the first launch that finds no answer. */
export function CrashConsentDialog(): React.JSX.Element {
  const setDialog = useLibrary((s) => s.setDialog)
  const answer = (on: boolean): void => {
    void api.prefs.setCrashReports(on ? 'on' : 'off').finally(() => setDialog(null))
  }
  return (
    <Modal
      title={t('Help make Playroom better')}
      // Closing without an answer asks again next launch.
      onClose={() => setDialog(null)}
      icon="settings"
      footer={
        <>
          <button onClick={() => answer(false)}>{t('Don’t send')}</button>
          <button className="primary" onClick={() => answer(true)}>
            {t('Send crash reports')}
          </button>
        </>
      }
    >
      <p>
        {t(
          'When Playroom crashes or hits an error, it can send a report so the problem gets fixed: what went wrong, the app version and your system. Never your photos, and never your folder names.'
        )}
      </p>
      <p className="muted small">{t('You can change this any time in Settings.')}</p>
    </Modal>
  )
}

/**
 * Asked once of everyone, the first time a photo opens in Develop (before its
 * first edit makes a project): where projects and exports are saved, each
 * shown as it is now. Closing keeps what is shown.
 */
export function LocationsDialog(): React.JSX.Element {
  const setDialog = useLibrary((s) => s.setDialog)
  const say = useLibrary((s) => s.say)
  const { info, save } = useLocations()
  const done = (): void => {
    void api.app
      .setSetting(LOCATIONS_ASKED, true)
      .catch((e) => say(errorText(e), 'error'))
      .finally(() => setDialog(null))
  }
  return (
    <Modal
      title={t('Where should projects and exports go?')}
      onClose={done}
      icon="library"
      footer={
        <button className="primary" onClick={done}>
          {t('Done')}
        </button>
      }
    >
      <p>
        {t(
          'Your first edit to a photo makes its project: one .pixl file with its edits, copies and history. Your photos themselves are never changed.'
        )}
      </p>
      {info && <LocationField kind="projects" info={info} save={save} />}
      <p>{t('Exports are the finished files you save from a photo.')}</p>
      {info && <LocationField kind="exports" info={info} save={save} />}
      <p className="muted small">
        {t(
          'Projects and files already made stay where they are. You can change this any time in Settings.'
        )}
      </p>
    </Modal>
  )
}
