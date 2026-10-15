/**
 * Soft proofing in the toolbar: the Proof button (S) in the View segment,
 * and its chevron opening the setup (⌥S) — the profile, the intent, black
 * point compensation, paper and ink, what surrounds the proof, and a proof
 * copy. A change is tried on the engine before it is used, and proofs at
 * once (turning proofing on); one the engine refuses says why on its row,
 * and the proof in force stays.
 */
import { useEffect, useRef, useState } from 'react'
import { INTENT_INFO } from '../../../shared/exportGuards'
import {
  isBuiltin,
  mergeBySha,
  pickerLabels,
  profileGroups,
  profileId,
  profileKind,
  profileName,
  PROOF_SURROUNDS,
  warnOnly,
  type FoundProfile,
  type ProofIntent,
  type ProofProfile,
  type ProofSettings
} from '../../../shared/proof'
import { HoverHint } from '../components/HoverHint'
import { Icon } from '../components/icons'
import { Popover } from '../components/Popover'
import { api } from '../lib/api'
import { useKeyHint, withKey } from '../lib/commands'
import { t } from '../lib/i18n'
import { asIcc, chooseProfileFile, issueText, makeProofCopy } from '../lib/proofing'
import { useDevelop } from '../state/develop'
import { useUi } from '../state/ui'

const INTENTS: ProofIntent[] = ['Perceptual', 'RelativeColorimetric']

/** A file's size in the picker's line ("1.2 MB", "560 KB"). */
function sizeOf(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/**
 * The profiles, grouped, inline in the setup (a list that opens under the
 * profile's button): Recent, Screen and web, Printers, Other RGB and grey,
 * CMYK (greyed: the engine warns against them, with no preview), Browse….
 */
function ProfileList({
  found,
  current,
  onPick,
  onBrowse
}: {
  found: FoundProfile[]
  current: ProofProfile
  onPick: (p: ProofProfile) => void
  onBrowse: () => void
}): React.JSX.Element {
  const recent = useUi((s) => s.proofRecent)
  const labels = pickerLabels(found)
  const groups = profileGroups(found, recent)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus()
  }, [])
  const label = (p: ProofProfile): string =>
    isBuiltin(p) ? profileName(p) : (labels.get(p.sha) ?? p.name)
  return (
    <div
      ref={ref}
      className="pp-list"
      role="listbox"
      aria-label={t('Profiles')}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
        e.preventDefault()
        const list = [...e.currentTarget.querySelectorAll<HTMLElement>('.pp-option')]
        const at = list.indexOf(document.activeElement as HTMLElement)
        const next = e.key === 'ArrowDown' ? Math.min(list.length - 1, at + 1) : Math.max(0, at - 1)
        list[next]?.focus()
      }}
    >
      {groups.map((g) =>
        g.profiles.length === 0 && g.id !== 'printers' ? null : (
          <div key={g.id} role="group" aria-label={t(g.label)}>
            <div className="pp-group micro">{t(g.label)}</div>
            {g.id === 'printers' && g.profiles.length === 0 && (
              <p className="pp-empty muted small">
                {t(
                  'No printer profiles found. Your printer or lab’s website has them; Browse… to add one.'
                )}
              </p>
            )}
            {g.profiles.map((p) => {
              const warn = warnOnly(p)
              return (
                <button
                  key={`${g.id}:${profileId(p)}`}
                  type="button"
                  role="option"
                  aria-selected={profileId(p) === profileId(current)}
                  className={`pp-option${warn ? ' warn' : ''}`}
                  title={warn ? t('Warning only: preview needs a newer engine') : undefined}
                  onClick={() => onPick(p)}
                >
                  <span className="pp-mark">{profileId(p) === profileId(current) ? '●' : ''}</span>
                  <span className="pp-name">{label(p)}</span>
                  {warn && <span className="hint">{t('Warning only')}</span>}
                </button>
              )
            })}
          </div>
        )
      )}
      <button type="button" className="pp-option pp-browse" onClick={onBrowse}>
        <span className="pp-mark" />
        <span className="pp-name">{t('Browse…')}</span>
      </button>
    </div>
  )
}

/** The setup itself, in a popover under the Proof button. */
function ProofPopover({
  anchor,
  onClose
}: {
  anchor: React.RefObject<HTMLElement | null>
  onClose: () => void
}): React.JSX.Element {
  const settings = useUi((s) => s.proof)
  const surround = useUi((s) => s.proofSurround)
  const setSurround = useUi((s) => s.setProofSurround)
  const applyProof = useDevelop((s) => s.applyProof)
  const issue = useDevelop((s) => s.proofIssue)
  const k = useKeyHint()
  const [found, setFound] = useState<FoundProfile[] | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const [error, setError] = useState<string | null>(issue ? issueText(issue) : null)
  const [busy, setBusy] = useState(false)
  // Scanned again each time the setup opens (no watching).
  useEffect(() => {
    let live = true
    api.develop
      .proofProfiles()
      .then((f) => live && setFound(f))
      .catch(() => live && setFound([]))
    return () => {
      live = false
    }
  }, [])
  const apply = async (next: ProofSettings): Promise<void> => {
    setBusy(true)
    const why = await applyProof(next)
    setBusy(false)
    setError(why ? issueText(why) : null)
  }
  const pick = (p: ProofProfile): void => {
    setListOpen(false)
    void apply({ ...settings, profile: p })
  }
  const browse = async (): Promise<void> => {
    const chosen = await chooseProfileFile()
    if (!chosen) return
    if (typeof chosen === 'string') return setError(chosen)
    setFound((f) => mergeBySha([...(f ?? []), chosen.profile]))
    pick(asIcc(chosen.profile))
  }
  const p = settings.profile
  const file = isBuiltin(p) ? undefined : found?.find((f) => f.sha === p.sha)
  const intentWhat = INTENT_INFO.find((i) => i.value === settings.intent)?.what ?? ''
  return (
    <Popover anchor={anchor} onClose={onClose} className="proof-pop" align="right">
      <span className="micro">
        {t('Soft proof')}
        {k('view.proofSetup') && ` · ${k('view.proofSetup')}`}
      </span>
      <div className="pp-field">
        <span className="pp-label">{t('Profile')}</span>
        <button
          type="button"
          className={`glass-select pp-profile${listOpen ? ' on' : ''}`}
          aria-haspopup="listbox"
          aria-expanded={listOpen}
          onClick={() => setListOpen((o) => !o)}
        >
          <span className="gs-value">{profileName(p)}</span>
          <Icon name="chevronDown" />
        </button>
        <span className="muted small">
          {profileKind(p)}
          {file && ` · ${sizeOf(file.size)}`}
          {busy && ` · ${t('Trying it…')}`}
        </span>
        {error && (
          <p className="pp-error small" role="alert">
            {error}
          </p>
        )}
        {listOpen &&
          (found ? (
            <ProfileList found={found} current={p} onPick={pick} onBrowse={() => void browse()} />
          ) : (
            <p className="muted small">{t('Looking for profiles…')}</p>
          ))}
      </div>
      <div className="pp-field">
        <span className="pp-label">{t('Intent')}</span>
        <div className="seg" role="group" aria-label={t('Intent')}>
          {INTENTS.map((i) => (
            <button
              key={i}
              type="button"
              className={settings.intent === i ? 'on' : ''}
              aria-pressed={settings.intent === i}
              onClick={() => void apply({ ...settings, intent: i })}
            >
              {i === 'Perceptual' ? t('Perceptual') : t('Relative')}
            </button>
          ))}
        </div>
        <p className="muted small">{t(intentWhat)}</p>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={settings.bpc}
          onChange={(e) => void apply({ ...settings, bpc: e.target.checked })}
        />
        {t('Black point compensation')}
      </label>
      <label
        className="check"
        title={t(
          'The paper’s own white and the ink’s own black, as the print will show them, instead of the screen’s.'
        )}
      >
        <input
          type="checkbox"
          checked={settings.simulate}
          onChange={(e) => void apply({ ...settings, simulate: e.target.checked })}
        />
        {t('Simulate paper and ink')}
      </label>
      <div className="pp-field">
        <span className="pp-label">{t('Surround')}</span>
        <div className="seg" role="group" aria-label={t('Surround')}>
          {PROOF_SURROUNDS.map((s) => (
            <button
              key={s.value}
              type="button"
              className={surround === s.value ? 'on' : ''}
              aria-pressed={surround === s.value}
              onClick={() => setSurround(s.value)}
            >
              {t(s.label)}
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        className="pp-copy"
        title={withKey(t('Make a proof copy'), 'proof.copy')}
        onClick={() => {
          onClose()
          void makeProofCopy()
        }}
      >
        <Icon name="copy" />
        {t('Proof copy')}
      </button>
    </Popover>
  )
}

/**
 * The Proof button and its chevron, in the View segment: S turns proofing
 * on and off (the same edit, unproofed then proofed: the A/B), ⌥S or the
 * chevron opens the setup.
 */
export function ProofButton(): React.JSX.Element {
  const on = useDevelop((s) => s.proof)
  const setProof = useDevelop((s) => s.setProof)
  const open = useDevelop((s) => s.proofSetup)
  const setOpen = useDevelop((s) => s.setProofSetup)
  const session = useDevelop((s) => s.session)
  const name = useUi((s) => profileName(s.proof.profile))
  const k = useKeyHint()
  const anchor = useRef<HTMLSpanElement>(null)
  return (
    <span ref={anchor} className="proof-seg">
      <HoverHint
        hint={{
          title: t('Soft proof'),
          keys: k('view.proof'),
          what: t(
            'Shows the photo as a printer, a paper or another colour space will make it, by the engine’s own colour management. Drags show the screen’s picture; the proof follows when you let go.'
          ),
          now: on ? t('Proofing with {{name}}.', { name }) : undefined
        }}
      >
        <button
          className={on ? 'on' : ''}
          aria-pressed={on}
          aria-disabled={!session}
          onClick={() => session && void setProof(!on)}
        >
          {t('Proof')}
          {k('view.proof') && <span className="k">{k('view.proof')}</span>}
        </button>
      </HoverHint>
      <button
        className="proof-chevron"
        aria-label={withKey(t('Proof setup'), 'view.proofSetup')}
        title={withKey(t('Proof setup'), 'view.proofSetup')}
        aria-expanded={open}
        aria-disabled={!session}
        onClick={() => session && setOpen(!open)}
      >
        <Icon name="chevronDown" />
      </button>
      {open && session && <ProofPopover anchor={anchor} onClose={() => setOpen(false)} />}
    </span>
  )
}
