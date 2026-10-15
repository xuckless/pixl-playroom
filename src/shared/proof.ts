/**
 * Soft proofing (its second part, after the gamut warning): the photo shown
 * as a printer, a paper or another colour space will make it. The proof is
 * the engine's own colour management (Little CMS) both ways: the settled
 * picture rendered into the proof's profile, then from there back to the
 * screen (main/proofing.ts `proofSteps`), so it is the same at fit and at
 * 1:1. Pure, for main, the window and the tests.
 */
import type { RenderingIntent } from './engine-types'
import { t, tk } from './i18n'

/** The spaces the engine knows by name (no file): offered first, as Screen and web. */
export type BuiltinProof = 'Srgb' | 'DisplayP3' | 'AdobeRgb'
export const BUILTIN_PROOFS: readonly BuiltinProof[] = ['Srgb', 'DisplayP3', 'AdobeRgb']
/** A built-in space's name (a proper name, never translated). */
export const BUILTIN_NAME: Record<BuiltinProof, string> = {
  Srgb: 'sRGB',
  DisplayP3: 'Display P3',
  AdobeRgb: 'Adobe RGB'
}

/**
 * An ICC profile chosen for the proof: found again by its SHA-256 if the
 * file moved; its class (header byte 12: `prtr` a printer, `mntr` a
 * screen…) and data space (byte 16, `RGB`, `CMYK`…) as the header says.
 */
export interface IccProof {
  sha: string
  name: string
  path: string
  cls: string
  space: string
}

export type ProofProfile = BuiltinProof | IccProof

/** The intents offered: Absolute is the way back when simulating paper and ink, Saturation is not for photographs. */
export type ProofIntent = 'Perceptual' | 'RelativeColorimetric'

/** How the photo is proofed. Remembered for every photo; a proof copy carries its own. */
export interface ProofSettings {
  profile: ProofProfile
  intent: ProofIntent
  /** Black point compensation into the proof's profile. */
  bpc: boolean
  /** Simulate paper and ink: the paper's own white and the ink's own black, not the screen's. */
  simulate: boolean
}

/** What the loupe shows around a proof: paper (dim white, or the paper's own), grey or black. */
export type ProofSurround = 'paper' | 'grey' | 'black'
export const PROOF_SURROUNDS: { value: ProofSurround; label: string }[] = [
  { value: 'paper', label: tk('Paper') },
  { value: 'grey', label: tk('Grey') },
  { value: 'black', label: tk('Black') }
]

export const DEFAULT_PROOF: ProofSettings = {
  profile: 'Srgb',
  intent: 'RelativeColorimetric',
  bpc: true,
  simulate: false
}

/** The profiles Recent keeps. */
export const RECENT_PROOFS = 5

export const isBuiltin = (p: unknown): p is BuiltinProof =>
  typeof p === 'string' && (BUILTIN_PROOFS as readonly string[]).includes(p)

/** A stored profile as one Playroom could have stored, or null. */
export function normaliseProfile(v: unknown): ProofProfile | null {
  if (isBuiltin(v)) return v
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  const str = (k: string): string | null => (typeof o[k] === 'string' ? (o[k] as string) : null)
  const sha = str('sha')
  const path = str('path')
  if (!sha || !/^[0-9a-f]{64}$/.test(sha) || !path) return null
  return {
    sha,
    path,
    name: str('name') || path.split(/[\\/]/).pop() || sha.slice(0, 8),
    cls: str('cls') ?? '',
    space: str('space') ?? ''
  }
}

/** Stored settings (a layout, a copy's sidecar) as settings, with the defaults where they say nothing usable. */
export function normaliseProof(v: unknown): ProofSettings {
  const o = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>
  return {
    profile: normaliseProfile(o.profile) ?? DEFAULT_PROOF.profile,
    intent: o.intent === 'Perceptual' ? 'Perceptual' : 'RelativeColorimetric',
    bpc: typeof o.bpc === 'boolean' ? o.bpc : DEFAULT_PROOF.bpc,
    simulate: o.simulate === true
  }
}

/** What names a profile across machines and moves: a built-in's name, a file's SHA-256. */
export function profileId(p: ProofProfile): string {
  return isBuiltin(p) ? `builtin:${p}` : `icc:${p.sha}`
}

export function profileName(p: ProofProfile): string {
  return isBuiltin(p) ? BUILTIN_NAME[p] : p.name
}

/** Everything that changes the proof's pixels: part of each proofed picture's signature. */
export function proofKey(s: ProofSettings): string {
  return [profileId(s.profile), s.intent, s.bpc ? 'bpc' : '-', s.simulate ? 'sim' : '-'].join('|')
}

/**
 * The way back from the proof's profile to the screen: simulating paper and
 * ink keeps the paper's white and the ink's black as they are (Absolute, no
 * black point compensation); otherwise white is the screen's white and black
 * its black (Relative, with compensation).
 */
export function returnPolicy(s: Pick<ProofSettings, 'simulate'>): {
  intent: RenderingIntent
  black_point_compensation: boolean
} {
  return s.simulate
    ? { intent: 'AbsoluteColorimetric', black_point_compensation: false }
    : { intent: 'RelativeColorimetric', black_point_compensation: true }
}

// ── ICC headers ──

/** The largest file read as a profile: printer profiles run to a few MB. */
export const MAX_ICC_BYTES = 32 * 1024 * 1024

/** What a profile's header (and its description tag) says. */
export interface IccHeader {
  size: number
  /** The major version (byte 8): 2 and 4 are read; 5 is iccMAX. */
  version: number
  cls: string
  space: string
  pcs: string
  /** The description (`desc`), or null when it has none to read. */
  name: string | null
}

const sig = (b: ArrayLike<number>, at: number): string =>
  String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]).replace(/\s+$/, '')

const u32 = (b: ArrayLike<number>, at: number): number =>
  ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0

/** The `desc` tag's text: v2's ASCII `desc` type, or v4's `mluc` (its first record, UTF-16BE). */
function description(b: ArrayLike<number>): string | null {
  if (b.length < 132) return null
  const count = u32(b, 128)
  for (let i = 0; i < Math.min(count, 256); i++) {
    const e = 132 + i * 12
    if (e + 12 > b.length) return null
    if (sig(b, e) !== 'desc') continue
    const off = u32(b, e + 4)
    const size = u32(b, e + 8)
    if (off + Math.min(size, 12) > b.length || size < 12) return null
    const type = sig(b, off)
    if (type === 'desc') {
      const n = u32(b, off + 8)
      const end = Math.min(off + 12 + n, off + size, b.length)
      let s = ''
      for (let j = off + 12; j < end && b[j] !== 0; j++) s += String.fromCharCode(b[j])
      return s.trim() || null
    }
    if (type === 'mluc') {
      const records = u32(b, off + 8)
      if (records === 0 || off + 28 > b.length) return null
      // The English record when there is one, else the first.
      let pick = off + 16
      for (let r = 0; r < Math.min(records, 64); r++) {
        const at = off + 16 + r * u32(b, off + 12)
        if (at + 12 > b.length) break
        if (String.fromCharCode(b[at], b[at + 1]) === 'en') {
          pick = at
          break
        }
      }
      const len = u32(b, pick + 4)
      const start = off + u32(b, pick + 8)
      const end = Math.min(start + len, off + size, b.length)
      let s = ''
      for (let j = start; j + 1 < end; j += 2) s += String.fromCharCode((b[j] << 8) | b[j + 1])
      return s.replace(/\0+$/, '').trim() || null
    }
    return null
  }
  return null
}

/** A profile's header, or null for a file that is not an ICC profile ('acsp' at byte 36). */
export function readIccHeader(b: ArrayLike<number>): IccHeader | null {
  if (b.length < 128 || sig(b, 36) !== 'acsp') return null
  return {
    size: u32(b, 0),
    version: b[8],
    cls: sig(b, 12),
    space: sig(b, 16),
    pcs: sig(b, 20),
    name: description(b)
  }
}

/**
 * What engine 0.21 can do with a profile: `proof`, an RGB output profile it
 * renders into and back; `warning`, a CMYK or grey one it can measure the
 * gamut warning against but not render into (its preview needs a newer
 * engine); `none`, with why, for one it cannot use at all.
 */
export type ProofUse = { use: 'proof' } | { use: 'warning' } | { use: 'none'; why: string }

/** Why a file is no profile at all (no 'acsp', too small or too large). */
export const NOT_A_PROFILE = tk('not an ICC profile')

const CLASS_WHY: Record<string, string> = {
  link: tk('device link'),
  abst: tk('abstract profile'),
  nmcl: tk('named colours'),
  scnr: tk('input profile')
}

export function proofUse(h: IccHeader): ProofUse {
  if (h.version >= 5) return { use: 'none', why: tk('iccMAX profile') }
  if (CLASS_WHY[h.cls]) return { use: 'none', why: CLASS_WHY[h.cls] }
  if (!['mntr', 'prtr', 'spac'].includes(h.cls)) return { use: 'none', why: tk('unknown kind') }
  if (h.space === 'RGB') return { use: 'proof' }
  if (h.space === 'CMYK' || h.space === 'GRAY') return { use: 'warning' }
  return { use: 'none', why: tk('not RGB, CMYK or grey') }
}

/** "This profile can't be used: device link", the reason in the user's language. */
export function unusableText(why: string): string {
  return t('This profile can’t be used: {{why}}', { why: t(why) })
}

// ── the profiles found ──

/** A profile found on this computer (or added with Browse…). */
export interface FoundProfile extends IccProof {
  use: ProofUse['use']
  why?: string
  /** Bytes. */
  size: number
}

/**
 * The same profile under several paths (Epson's drivers repeat theirs in
 * each driver version) listed once: the first found, which the scan reaches
 * in folder order (the person's, the computer's, the system's, printers').
 */
export function mergeBySha(found: FoundProfile[]): FoundProfile[] {
  const seen = new Set<string>()
  return found.filter((f) => !seen.has(f.sha) && seen.add(f.sha))
}

/** The folder a profile is in, by name: what tells two of the same name apart. */
function folderOf(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts.length > 1 ? parts[parts.length - 2] : ''
}

/** A profile's file name without its extension or the UUID macOS adds to a display's. */
function fileOf(path: string, uuid: 'drop' | 'short'): string {
  return (path.split(/[\\/]/).pop() ?? '')
    .replace(/\.(icc|icm)$/i, '')
    .replace(/-([0-9a-f]{8})(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i, uuid === 'drop' ? '' : ' $1')
}

/**
 * A profile's label in the picker: its name, and where another has the same
 * name (macOS names every display's "Display"; a driver repeats its own in
 * each version) what tells it apart: its file's name, the start of the UUID
 * macOS gives a display's file, or its folder.
 */
export function pickerLabels(found: FoundProfile[]): Map<string, string> {
  const count = (key: (f: FoundProfile) => string): Map<string, number> => {
    const m = new Map<string, number>()
    for (const f of found) m.set(key(f), (m.get(key(f)) ?? 0) + 1)
    return m
  }
  const names = count((f) => f.name)
  const files = count((f) => `${f.name}\0${fileOf(f.path, 'drop')}`)
  return new Map(
    found.map((f) => {
      if ((names.get(f.name) ?? 0) < 2) return [f.sha, f.name]
      const file = fileOf(f.path, 'drop')
      const unique = (files.get(`${f.name}\0${file}`) ?? 0) < 2
      const hint =
        file && file !== f.name ? (unique ? file : fileOf(f.path, 'short')) : folderOf(f.path)
      return [f.sha, hint ? `${f.name} · ${hint}` : f.name]
    })
  )
}

export type ProfileGroupId = 'recent' | 'screen' | 'printers' | 'other' | 'cmyk'

export interface ProfileGroup {
  id: ProfileGroupId
  label: string
  profiles: ProofProfile[]
}

/**
 * The picker's groups: Recent, Screen and web (the built-ins), Printers,
 * Other RGB and grey, then CMYK. A profile the engine cannot use is left out;
 * Recent leaves out a file no longer found.
 */
export function profileGroups(found: FoundProfile[], recent: ProofProfile[]): ProfileGroup[] {
  const usable = mergeBySha(found).filter((f) => f.use !== 'none')
  const known = new Set(usable.map((f) => f.sha))
  const icc = (f: FoundProfile): IccProof => ({
    sha: f.sha,
    name: f.name,
    path: f.path,
    cls: f.cls,
    space: f.space
  })
  const byName = (a: FoundProfile, b: FoundProfile): number => a.name.localeCompare(b.name)
  const groups: ProfileGroup[] = [
    {
      id: 'recent',
      label: tk('Recent'),
      profiles: recent.filter((p) => isBuiltin(p) || known.has(p.sha))
    },
    { id: 'screen', label: tk('Screen and web'), profiles: [...BUILTIN_PROOFS] },
    {
      id: 'printers',
      label: tk('Printers'),
      profiles: usable
        .filter((f) => f.cls === 'prtr' && f.space !== 'CMYK')
        .sort(byName)
        .map(icc)
    },
    {
      id: 'other',
      label: tk('Other RGB and grey'),
      profiles: usable
        .filter((f) => f.cls !== 'prtr' && f.space !== 'CMYK')
        .sort(byName)
        .map(icc)
    },
    {
      id: 'cmyk',
      label: tk('CMYK'),
      profiles: usable
        .filter((f) => f.space === 'CMYK')
        .sort(byName)
        .map(icc)
    }
  ]
  return groups
}

/** A profile chosen, first in Recent (each once, the newest five). */
export function pushRecent(recent: ProofProfile[], p: ProofProfile): ProofProfile[] {
  const id = profileId(p)
  return [p, ...recent.filter((r) => profileId(r) !== id)].slice(0, RECENT_PROOFS)
}

/** Whether a profile can only warn (a CMYK or grey one): no preview with engine 0.21. */
export function warnOnly(p: ProofProfile): boolean {
  return !isBuiltin(p) && (p.space === 'CMYK' || p.space === 'GRAY')
}

/**
 * The paper's short name, for a proof copy's: the profile's name without a
 * file extension or a trailing "Profile", at most 40 characters.
 */
export function paperName(p: ProofProfile): string {
  const name = profileName(p)
    .replace(/\.(icc|icm)$/i, '')
    .replace(/\s+profile$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  return name.length > 40 ? `${name.slice(0, 39).trimEnd()}…` : name || profileName(p)
}

/** A proof copy's name: "<paper> proof", in the language it was made in. */
export function proofCopyName(p: ProofProfile): string {
  return t('{{paper}} proof', { paper: paperName(p) })
}

/** The intent's short name for the chip. */
export function intentShort(i: ProofIntent): string {
  return i === 'Perceptual' ? t('Perc') : t('Rel')
}

// ── the loupe's chip ──

/**
 * What the loupe says of the proof (LoupeHud): proofed (`warn`: a CMYK or
 * grey profile, warned against with no preview), on its way, a drag showing
 * the screen's picture, why it went off; null when there is nothing to say.
 */
export type ProofChip = 'on' | 'warn' | 'proofing' | 'drag' | 'missing' | 'unusable' | null

/**
 * The chip from the state: proofing and why not, and the picture on show
 * (a drag's frame is never proofed; a settled one says what it was proofed
 * with, which may be a setting since changed).
 */
export function proofChip(a: {
  on: boolean
  issue: { kind: 'missing' | 'unusable' } | null
  want: string
  picture: { kind: string; proof?: { key: string; warnOnly?: boolean } } | null
}): ProofChip {
  if (!a.on) return a.issue ? a.issue.kind : null
  if (a.picture?.kind === 'draft') return 'drag'
  const shown = a.picture?.proof
  if (shown && shown.key === a.want) return shown.warnOnly ? 'warn' : 'on'
  return 'proofing'
}

// ── the surround ──

/** The paper surround is kept this dim: an OLED's full white would reset the eye's adaptation. */
const PAPER_DIM = 0.8
/** A mid grey, as a viewing booth's walls. */
const SURROUND_GREY = 0.46

/**
 * What surrounds a proof in the loupe, as CSS: paper (dim white, or the
 * paper's own white while simulating paper and ink), grey or black.
 */
export function surroundColour(
  s: ProofSurround,
  paper: readonly [number, number, number] | null,
  simulate: boolean
): string {
  const p3 = (rgb: readonly number[]): string =>
    `color(display-p3 ${rgb.map((v) => Math.round(v * 1000) / 1000).join(' ')})`
  if (s === 'black') return p3([0, 0, 0])
  if (s === 'grey') return p3([SURROUND_GREY, SURROUND_GREY, SURROUND_GREY])
  const white = simulate && paper ? paper.map((v) => v / 255) : [1, 1, 1]
  return p3(white.map((v) => v * PAPER_DIM))
}

/** A profile's kind and data space for the line under the picker ("Printer · RGB"). */
export function profileKind(p: ProofProfile): string {
  if (isBuiltin(p)) return t('Built in · RGB')
  const cls: Record<string, string> = {
    prtr: tk('Printer'),
    mntr: tk('Display|screen'),
    spac: tk('Colour space')
  }
  return `${t(cls[p.cls] ?? tk('Profile'))} · ${p.space}`
}
