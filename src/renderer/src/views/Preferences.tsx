/**
 * Settings (⌘, / Ctrl+,): the PIXL account, the licence, updates, crash reports, reporting a
 * problem, the legal pages, and the key bindings. And the one question the
 * first launch asks: may crash reports be sent?
 */
import { useEffect, useRef, useState } from 'react'
import { MAX_PROBLEM_TEXT } from '../../../shared/crash'
import type { AccountStatus } from '../../../shared/account'
import type { Prefs, UpdateState } from '../../../shared/ipc'
import { ACCOUNT_URL, BUY_URL, LICENCE_RULES, type LicenceStatus } from '../../../shared/licence'
import { latestNotes } from '../../../shared/releasenotes'
import { InfoTip } from '../components/InfoTip'
import { Icon, type IconName } from '../components/icons'
import { Modal, Select } from '../components/ui'
import { api, errorText } from '../lib/api'
import { takeReportFocus } from '../lib/report'
import { useLibrary } from '../state/library'
import { useUi } from '../state/ui'
import { KeyBindingsSection } from './KeyBindings'
import { ModelsSection } from './ModelsSection'
import { openReleaseNotes } from '../state/whatsNew'
import {
  DEFAULT_DISPLAY_SETTING,
  normaliseDisplaySetting,
  type DisplayHdr,
  type DisplayHdrSetting
} from '../../../shared/hdrdisplay'

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
      <legend>Report a problem</legend>
      <p className="muted small">
        Found a bug? Say what you did, what happened and what you expected. It goes to the Playroom
        team only; add an email if you&apos;d like a reply.
      </p>
      <textarea
        ref={text}
        className="report-text"
        value={message}
        maxLength={MAX_PROBLEM_TEXT}
        placeholder="What happened?"
        aria-label="What happened?"
        onChange={(e) => {
          setMessage(e.target.value)
          setSent(null)
        }}
        onKeyDown={stop}
      />
      <input
        type="email"
        value={email}
        placeholder="Email for a reply (optional)"
        aria-label="Email for a reply (optional)"
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
        Include Playroom&apos;s recent log (it names the files it worked on; your home folder is
        hidden)
      </label>
      <div className="prefs-row">
        <button className="primary" disabled={busy || !message.trim()} onClick={() => void send()}>
          {busy ? 'Sending…' : 'Send report'}
        </button>
        {sent && (
          <span className="prefs-status" role="status">
            Sent, thank you. Reference {sent}.
          </span>
        )}
      </div>
      {error && <p className="error small">{error}</p>}
    </fieldset>
  )
}

function updateLine(s: UpdateState): string {
  switch (s.phase) {
    case 'disabled':
      return 'Updates are off in development builds.'
    case 'checking':
      return 'Checking for updates…'
    case 'available':
      return `Version ${s.version} is available; downloading…`
    case 'downloading':
      return `Downloading ${s.version ?? 'the update'}… ${Math.round(s.progress?.percent ?? 0)}%`
    case 'downloaded':
      return `Version ${s.version} is ready. It installs when you quit, or restart now.`
    case 'not-available':
      return 'Playroom is up to date.'
    case 'error':
      return `Couldn't check for updates: ${s.error ?? 'unknown error'}`
    default:
      return 'Playroom checks for updates at launch and every few hours.'
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
      if (done && next.signedIn === (done === 'Signed in')) say(done)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }
  const who = status.name && status.email ? `${status.name} (${status.email})` : status.email
  return (
    <fieldset>
      <legend>PIXL account</legend>
      <p className="prefs-status" role="status" aria-live="polite">
        {status.signedIn
          ? `Signed in as ${who ?? 'your PIXL account'}.`
          : status.signingIn
            ? 'Finish signing in in your browser…'
            : 'Not signed in.'}
      </p>
      <p className="muted small">
        One account for every PIXL app. Beta access, your trial and your licence live on it.
      </p>
      <div className="prefs-row">
        {status.signedIn ? (
          <>
            <button
              disabled={busy}
              onClick={() => void run(() => api.account.signOut(), 'Signed out')}
            >
              Sign out
            </button>
            <a href={ACCOUNT_URL} target="_blank" rel="noreferrer">
              Manage account
            </a>
          </>
        ) : status.signingIn ? (
          <button onClick={() => void api.account.cancelSignIn()}>Cancel</button>
        ) : (
          <button
            className="primary"
            disabled={busy}
            onClick={() => void run(() => api.account.signIn(), 'Signed in')}
          >
            Sign in…
          </button>
        )}
      </div>
      {error && <p className="error small">{error}</p>}
    </fieldset>
  )
}

function licenceLine(s: LicenceStatus): string {
  const st = s.state
  switch (st.kind) {
    case 'signed-out':
      return 'Sign in above to start your free trial, or to use your licence.'
    case 'checking':
      return 'Checking your account…'
    case 'no-trial':
      return `Your ${LICENCE_RULES.trialDays}-day free trial is ready to start.`
    case 'trial':
      return `Free trial: ${st.daysLeft} day${st.daysLeft === 1 ? '' : 's'} left.`
    case 'trial-ended':
      return 'Your free trial has ended.'
    case 'licensed':
      return `Licensed. Pixl Playroom works on up to ${s.deviceLimit} of your devices.`
    case 'beta':
      return 'Beta access. Thanks for testing.'
    case 'revalidate':
      return 'Connect to the internet so Playroom can confirm your licence.'
    case 'device-limit':
      return `Your licence is already on ${s.deviceLimit} devices. Free one to use it here.`
    case 'no-beta':
      return 'This account isn’t in the beta yet.'
    case 'beta-ended':
      return 'The beta has ended.'
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
      Check now
    </button>
  )
  const buy = (
    <a href={BUY_URL} target="_blank" rel="noreferrer">
      Buy a licence
    </a>
  )
  return (
    <fieldset>
      <legend>Licence</legend>
      <p className="prefs-status" role="status" aria-live="polite">
        {licenceLine(status)}
      </p>
      {status.locked && <p className="note small">{status.locked}</p>}
      {status.discount && (
        <p className="small">
          Your tester discount: <strong>{status.discount.code}</strong>, until{' '}
          {shortDate(status.discount.expires)}.
        </p>
      )}
      {!status.enforced && (
        <p className="muted small">
          Licences aren&apos;t required yet: every feature works either way. Once they are, an ended
          trial stops exporting only; editing keeps working.
        </p>
      )}
      {status.state.kind === 'device-limit' && (
        <ul className="prefs-devices">
          {status.state.devices.map((d) => (
            <li key={d.id}>
              <span>{d.name}</span>
              <button
                disabled={busy}
                onClick={() => void run(() => api.licence.freeDevice(d.id), `${d.name} freed`)}
              >
                Free
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
              onClick={() => void run(() => api.licence.startTrial(), 'Free trial started')}
            >
              Start free trial
            </button>
          )}
          {kind !== 'no-trial' && check}
          {kind === 'no-trial' || kind === 'trial' || kind === 'trial-ended' || kind === 'beta'
            ? buy
            : null}
          {(kind === 'licensed' || kind === 'device-limit') && (
            <a href={ACCOUNT_URL} target="_blank" rel="noreferrer">
              Manage devices
            </a>
          )}
        </div>
      )}
      {error && <p className="error small">{error}</p>}
    </fieldset>
  )
}

type ProjectsLocation = 'beside' | 'home' | { folder: string }

/**
 * Where a photo's `.pixl` project is made, on its first edit: beside the
 * photo, or in a projects folder (one subfolder per photo folder). Projects
 * already made stay where they are.
 */
function ProjectsSection(): React.JSX.Element {
  const say = useLibrary((s) => s.say)
  const [loc, setLoc] = useState<ProjectsLocation>('beside')
  const [embed, setEmbed] = useState(true)
  useEffect(() => {
    void api.app.getSetting<boolean>('projects.embedOriginal').then((v) => setEmbed(v !== false))
    void api.app.getSetting<ProjectsLocation>('projects.location').then((v) => {
      if (v === 'home' || (v && typeof v === 'object' && typeof v.folder === 'string')) setLoc(v)
    })
  }, [])
  const save = (v: ProjectsLocation): void => {
    setLoc(v)
    void api.app.setSetting('projects.location', v).catch((e) => say(errorText(e), 'error'))
  }
  const choose = async (): Promise<void> => {
    const folder = await api.library.chooseFolder()
    if (folder) save({ folder })
  }
  const mode = typeof loc === 'object' ? 'folder' : loc
  return (
    <fieldset>
      <legend>
        Projects
        <InfoTip
          label="Projects"
          tip={{
            what: 'A photo’s first edit makes its project: one .pixl file with its edits, copies, snapshots and whole history.',
            expect:
              'They go wherever the file goes. A folder that cannot be written (a locked card) puts its projects in ~/Pixl Projects; projects already made stay where they are.'
          }}
        />
      </legend>
      <Select
        label="Make projects"
        value={mode}
        options={[
          { value: 'beside', label: 'Beside the photo' },
          { value: 'home', label: 'In ~/Pixl Projects' },
          { value: 'folder', label: 'In a folder of my choice…' }
        ]}
        onChange={(v) => {
          if (v === 'folder') void choose()
          else save(v as 'beside' | 'home')
        }}
      />
      {typeof loc === 'object' && (
        <div className="prefs-row">
          <span className="muted small">{loc.folder}</span>
          <button onClick={() => void choose()}>Change…</button>
        </div>
      )}
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
        Carry a copy of the original in each project
        <InfoTip
          label="Carry the original"
          tip={{
            what: 'The project then needs nothing else: move or lose the photo and it still opens, develops and exports.',
            expect:
              'Each original is kept as small as it can be without losing a bit (a RAW as lossless DNG, a JPEG repacked into JPEG XL), so a project takes about as much space as its photo again.'
          }}
        />
      </label>
    </fieldset>
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
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'library', label: 'Projects & interface', icon: 'library' },
  { id: 'display', label: 'Display', icon: 'overlay' },
  { id: 'ai', label: 'AI models', icon: 'smart' },
  { id: 'keys', label: 'Key bindings', icon: 'grip' },
  { id: 'privacy', label: 'Privacy & about', icon: 'info' }
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
    <Modal title="Settings" onClose={() => setDialog(null)} wide icon="settings" className="prefs">
      <nav className="ew-steps" aria-label="Settings sections">
        {SECTIONS.map((x) => (
          <button
            key={x.id}
            className={`ew-step${x.id === section ? ' on' : ''}`}
            aria-current={x.id === section ? 'page' : undefined}
            onClick={() => setSection(x.id)}
          >
            <Icon name={x.icon} />
            {x.label}
          </button>
        ))}
      </nav>
      <div className={`ps-body ${section}`} key={section}>
        {section === 'general' && <GeneralSettings prefs={prefs} />}
        {section === 'library' && (
          <>
            <ProjectsSection />
            <InterfaceSection />
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
 * and peak can be stated. On Windows, Auto-fill is a stand-in until
 * Playroom reads the screen there too.
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
  // Until Playroom reads a Windows screen: whether Chromium sees HDR, and typical numbers.
  const autoFill = (): void => {
    const hdr = window.matchMedia('(dynamic-range: high)').matches
    save({ mode: 'stated', whiteNits: 203, peakNits: hdr ? 1000 : 203 })
    say(
      hdr
        ? 'This screen shows HDR: filled with typical values (white 203, peak 1000). Set your screen’s own if you know them.'
        : 'This screen shows SDR now: the preview stays SDR.',
      'info'
    )
  }
  return (
    <fieldset>
      <legend>
        Display
        <InfoTip
          label="Display"
          tip={{
            what: 'The screen Full HDR renders for: how bright its standard white is and how bright it can go.',
            expect: mac
              ? 'Automatic reads your Mac’s screen, and follows its brightness. State the numbers only to preview for another screen.'
              : 'Set your screen’s SDR white and peak brightness (in Windows’ HDR settings, or its specifications).'
          }}
        />
      </legend>
      <Select
        label="Brightness"
        value={setting.mode}
        options={[
          {
            value: 'auto',
            label: mac ? 'Automatic (read the screen)' : 'Automatic (SDR until stated)'
          },
          { value: 'stated', label: 'Stated' }
        ]}
        onChange={(v) => save({ ...setting, mode: v as DisplayHdrSetting['mode'] })}
      />
      {setting.mode === 'stated' && (
        <div className="prefs-row display-nits">
          <label className="field">
            <span>SDR white (cd/m²)</span>
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
            <span>Peak (cd/m²)</span>
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
      {!mac && (
        <div className="prefs-row">
          <button className="sm" onClick={autoFill}>
            Auto-fill from this screen
          </button>
        </div>
      )}
      {now && (
        <p className="muted small">
          {now.hdr
            ? `Now: ${now.headroom}× headroom (white ${now.whiteNits}, peak ${Math.round(now.peakNits)} cd/m²)${now.potential ? `, up to ${now.potential}× on this screen` : ''}.`
            : now.potential && now.potential > 1
              ? `Now: SDR. This screen reaches ${now.potential}× when it shows HDR.`
              : 'Now: SDR.'}
        </p>
      )}
    </fieldset>
  )
}

/** How the interface draws itself: the efficient UI always, or only while Playroom is behind. */
function InterfaceSection(): React.JSX.Element {
  const alwaysFlat = useUi((s) => s.alwaysFlat)
  const setAlwaysFlat = useUi((s) => s.setAlwaysFlat)
  return (
    <fieldset>
      <legend>Interface</legend>
      <label className="check">
        <input
          type="checkbox"
          checked={alwaysFlat}
          onChange={(e) => setAlwaysFlat(e.target.checked)}
        />
        Always flat
        <InfoTip
          label="Always flat"
          tip={{
            what: 'Glass panels become flat colour, and nothing animates: no moving backgrounds, no transitions.',
            expect:
              'Playroom already does this while another app is in front. On, it stays that way when Playroom is in front too: lighter on the battery and the graphics chip.'
          }}
        />
      </label>
    </fieldset>
  )
}

/** General: the account, the licence and updates. */
function GeneralSettings({ prefs }: { prefs: Prefs | null }): React.JSX.Element {
  const say = useLibrary((s) => s.say)
  const update = useUpdates()
  const busy = update?.phase === 'checking' || update?.phase === 'downloading'
  return (
    <>
      <AccountSection />
      <LicenceSection />
      <fieldset>
        <legend>Updates</legend>
        <p className="muted small">
          Pixl Playroom {prefs?.version ?? update?.currentVersion ?? ''}
          {prefs ? ` · ${prefs.platform} ${prefs.arch}` : ''}
        </p>
        {update && (
          <>
            {update.currentVersion.includes('-beta') ? (
              <p className="muted small">
                This beta follows the beta channel: it gets every beta, and the release when it
                comes.
              </p>
            ) : (
              <Select
                label="Channel"
                value={update.channel}
                options={[
                  { value: 'latest', label: 'Stable' },
                  { value: 'beta', label: 'Beta (early builds)' }
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
                Check now
              </button>
              {update.phase === 'downloaded' && (
                <button className="primary" onClick={() => void api.updates.install()}>
                  Restart to update
                </button>
              )}
              {latestNotes(update.currentVersion) && (
                <button className="link" onClick={() => openReleaseNotes(update.currentVersion)}>
                  What’s new
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
        <legend>Privacy</legend>
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
          Send crash reports
        </label>
        <p className="muted small">
          When Playroom crashes or hits an error, send a report so it can be fixed: what went wrong,
          the app version and your system. Never your photos, and never your folder names.
        </p>
      </fieldset>

      <ReportSection />

      <fieldset>
        <legend>About</legend>
        <div className="prefs-links">
          <a href={`${LEGAL}/eula/`} target="_blank" rel="noreferrer">
            Licence agreement
          </a>
          <a href={`${LEGAL}/privacy/`} target="_blank" rel="noreferrer">
            Privacy policy
          </a>
          <button
            className="link"
            onClick={() => void api.app.openNotices().catch((e) => say(errorText(e), 'error'))}
          >
            Third-party notices
          </button>
          {prefs?.version.includes('-beta') && (
            <button
              className="link"
              onClick={() => void api.app.openBetaTerms().catch((e) => say(errorText(e), 'error'))}
            >
              Beta terms
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
      title="Help make Playroom better"
      // Closing without an answer asks again next launch.
      onClose={() => setDialog(null)}
      icon="settings"
      footer={
        <>
          <button onClick={() => answer(false)}>Don&apos;t send</button>
          <button className="primary" onClick={() => answer(true)}>
            Send crash reports
          </button>
        </>
      }
    >
      <p>
        When Playroom crashes or hits an error, it can send a report so the problem gets fixed: what
        went wrong, the app version and your system. Never your photos, and never your folder names.
      </p>
      <p className="muted small">You can change this any time in Settings.</p>
    </Modal>
  )
}
