/**
 * A RAW's camera colour (engine 0.17): `Container` is the file's own (LibRaw's
 * Adobe matrix for a camera format, a DNG's tags); `pixl:1` is PIXL's fit for
 * the body from its camera database (46 bodies in version 1). The engine
 * never falls back on its own (`Pixl` on a camera the version lacks is
 * refused, naming the camera), so choosing is the host's: here.
 *
 * The choice is recorded per photo (`photos.raw_colour`, mirrored in the
 * sidecar and the project) so it is not re-derived from a probe that may
 * differ (a DNG's names come from IFD0), and it names the version, as the
 * engine's guide asks of saved recipes. It moves pixels (and the white a
 * temperature and tint start from), so it is part of every cache's name
 * (`developMark`) and of what marks a pixel step as made on another develop.
 *
 * Engine 0.21 (E21) adds a DNG camera profile (`.dcp`) the person imports:
 * `dcp:<id>`, the first 8 hex digits of the file's SHA-256. The profile
 * itself is stated data (the engine's guide: store the profile, not the
 * path), kept by main and carried in the photo's sidecar or project; this
 * module looks it up by id (`registerDcp`). Its tone curve is never applied
 * (the owner, 2026-10-14: Playroom's tone tools shape the picture, in HDR
 * too), and its BaselineExposureOffset is, as Adobe's renderer does
 * (`exposureOffsetOf`): the engine leaves both to the host.
 *
 * Pure, for tests/rawcolour.test.ts.
 */
import type { CameraColour, DcpProfile, SourceInfo, WhitePoint } from './engine-types'
import { RAW_DEVELOP_REV } from './pixels'
import { t } from './i18n'

export type DcpColour = `dcp:${string}`
export type RawColour = 'container' | 'pixl:1' | DcpColour

/** The version of PIXL's camera database Playroom asks for. */
export const PIXL_COLOUR_VERSION = 1

const DCP = /^dcp:[0-9a-f]{8}$/

export const parseRawColour = (v: unknown): RawColour | null =>
  v === 'container' || v === 'pixl:1'
    ? v
    : typeof v === 'string' && DCP.test(v)
      ? (v as DcpColour)
      : null

/** A camera profile's id in a raw colour, or null for a built-in colour. */
export const dcpIdOf = (c: string | null | undefined): string | null =>
  c && DCP.test(c) ? c.slice(4) : null

/** The camera profiles this process knows, by id (main's store, a sidecar's, a test's). */
const profiles = new Map<string, DcpProfile>()

/**
 * A camera profile as a sidecar, project or the index hands it back: an
 * object with the fields the engine states, or null for anything else.
 */
export function readProfile(v: unknown): DcpProfile | null {
  const o = typeof v === 'string' ? safeJson(v) : v
  if (!o || typeof o !== 'object') return null
  const p = o as Partial<DcpProfile>
  if (!p.camera || typeof p.camera !== 'object' || !Array.isArray(p.hue_sat_maps)) return null
  return {
    name: typeof p.name === 'string' ? p.name : null,
    unique_camera_model: typeof p.unique_camera_model === 'string' ? p.unique_camera_model : null,
    calibration_signature:
      typeof p.calibration_signature === 'string' ? p.calibration_signature : null,
    copyright: typeof p.copyright === 'string' ? p.copyright : null,
    camera: p.camera,
    hue_sat_maps: p.hue_sat_maps,
    hue_sat_map_encoding: p.hue_sat_map_encoding === 'Srgb' ? 'Srgb' : 'Linear',
    look_table: p.look_table ?? null,
    look_table_encoding: p.look_table_encoding === 'Srgb' ? 'Srgb' : 'Linear',
    tone_curve: Array.isArray(p.tone_curve) ? p.tone_curve : null,
    baseline_exposure_offset:
      typeof p.baseline_exposure_offset === 'number' ? p.baseline_exposure_offset : 0
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

/** Make a camera profile known by its id (`dcp:<id>`). */
export function registerDcp(id: string, profile: DcpProfile): void {
  profiles.set(id, profile)
}

/** A known camera profile, by its colour or id. */
export function dcpOf(c: string | null | undefined): DcpProfile | null {
  const id = dcpIdOf(c) ?? (c && /^[0-9a-f]{8}$/.test(c) ? c : null)
  return id ? (profiles.get(id) ?? null) : null
}

/**
 * The colour a develop can use now: a camera profile this process does not
 * hold (a sidecar from another machine, before its profile is read) is the
 * file's own until it is, never a develop that fails.
 */
export function usableColour(c: RawColour): RawColour {
  return dcpIdOf(c) && !dcpOf(c) ? 'container' : c
}

/** Camera names compared as a profile's UniqueCameraModel is written: case and spacing aside. */
const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
    .trim()

/**
 * Whether a camera profile is for this RAW's body. The engine never matches
 * a profile to a camera; Playroom offers only those whose UniqueCameraModel
 * names the probe's camera (as LibRaw or EXIF name it, or as PIXL's database
 * does).
 */
export function profileFits(
  profile: Pick<DcpProfile, 'unique_camera_model'>,
  info: Colourable | null | undefined
): boolean {
  const cc = info?.camera_colour
  const ucm = profile.unique_camera_model
  if (!cc || !ucm) return false
  const want = norm(ucm)
  const names = [`${cc.make} ${cc.model}`, cc.model, cc.pixl_camera ?? '']
  return names.some((n) => n && norm(n) === want)
}

type Colourable = Pick<SourceInfo, 'camera_colour'>

/** Whether PIXL's camera database (the version Playroom asks for) holds this RAW's body. */
export function pixlSupported(info: Colourable | null | undefined): boolean {
  return !!info?.camera_colour?.pixl_versions.includes(PIXL_COLOUR_VERSION)
}

/** What a RAW is developed with when nothing was chosen: PIXL's colour where it holds the body. */
export function defaultRawColour(info: Colourable | null | undefined): RawColour {
  return pixlSupported(info) ? 'pixl:1' : 'container'
}

/**
 * The colour to use: the recorded one, but a recorded `pixl:1` on a file whose
 * body the database does not hold (a DNG whose names differ, a changed file)
 * reads as `container`, never as an error. Nothing recorded: the default.
 */
export function resolveRawColour(
  recorded: string | null | undefined,
  info: Colourable | null | undefined
): RawColour {
  const c = parseRawColour(recorded)
  if (c === null) return defaultRawColour(info)
  return c === 'pixl:1' && !pixlSupported(info) ? 'container' : usableColour(c)
}

/**
 * Whether a RAW's recorded colour moves to PIXL's: the file's own
 * (`container`) recorded as a default (not chosen) on a body PIXL's database
 * now holds (the owner, 2026-10-14: PIXL's colour whenever it has the body).
 * A `container` the person chose stays.
 */
export function upgradesToPixl(
  recorded: string | null | undefined,
  chosen: boolean,
  info: Colourable | null | undefined
): boolean {
  return parseRawColour(recorded) === 'container' && !chosen && pixlSupported(info)
}

/**
 * The engine's camera colour for a develop. A camera profile's tables (its
 * HueSatMaps and LookTable) run in `Scene` only: under `Develop` (a linear
 * DNG) it is its matrices (`Stated`). Its tone curve is never stated.
 */
export function cameraColourOf(c: RawColour, mode: 'scene' | 'develop' = 'scene'): CameraColour {
  if (c === 'pixl:1') return { Pixl: { version: PIXL_COLOUR_VERSION } }
  const profile = dcpOf(c)
  if (!profile) return 'Container'
  return mode === 'develop' ? { Stated: profile.camera } : { Dcp: { ...profile, tone_curve: null } }
}

/**
 * What names this develop in caches and on the pixel steps laid on it:
 * `RAW_DEVELOP_REV` for the file's own colour (so every name and stamp made
 * before this stands), with `p1` after it for PIXL's version 1 and `d<id>`
 * for a camera profile.
 */
export function developMark(c: RawColour): string {
  if (c === 'pixl:1') return `${RAW_DEVELOP_REV}p${PIXL_COLOUR_VERSION}`
  const id = dcpIdOf(c)
  return id ? `${RAW_DEVELOP_REV}d${id}` : RAW_DEVELOP_REV
}

/**
 * The stops a camera profile asks to be added to the exposure (its
 * BaselineExposureOffset), as Adobe's renderer adds them: the engine does
 * not, so a profile would render that much brighter or darker than in
 * Lightroom. 0 for any other colour.
 */
export function exposureOffsetOf(c: RawColour | null | undefined): number {
  const offset = dcpOf(c)?.baseline_exposure_offset ?? 0
  return Number.isFinite(offset) ? offset : 0
}

/**
 * The white the develop balanced for: under PIXL's colour the one found
 * through PIXL's calibrations (where a temperature and tint start), else, or
 * when the database gave none, the file's own.
 */
export function asShotFor(
  info: Pick<SourceInfo, 'as_shot_white' | 'camera_colour'>,
  c: RawColour
): WhitePoint | null {
  return (c === 'pixl:1' ? info.camera_colour?.as_shot_white : null) ?? info.as_shot_white
}

/** The probe as the rest of the app should read it for this colour: its as-shot white swapped. */
export function effectiveInfo<T extends Pick<SourceInfo, 'as_shot_white' | 'camera_colour'>>(
  info: T,
  c: RawColour
): T {
  const white = asShotFor(info, c)
  return white === info.as_shot_white ? info : { ...info, as_shot_white: white }
}

/** The colour in words, for the info panel and the select: "PIXL · Canon EOS R5". */
export function rawColourLabel(info: Colourable | null | undefined, c: RawColour): string {
  const cc = info?.camera_colour
  if (c === 'pixl:1') return `PIXL${cc?.pixl_camera ? ` · ${cc.pixl_camera}` : ''}`
  const profile = dcpOf(c)
  if (profile) return profileLabel(profile)
  return t('Container (the file’s own)')
}

/** A camera profile in words: its name, else its camera's ("Adobe Standard"). */
export function profileLabel(profile: Pick<DcpProfile, 'name' | 'unique_camera_model'>): string {
  return profile.name || profile.unique_camera_model || t('Camera profile')
}

/** Why a photo has no PIXL colour to offer, or null when it has. */
export function rawColourReason(info: Colourable | null | undefined): string | null {
  if (pixlSupported(info)) return null
  return info?.camera_colour
    ? t('This camera is not in PIXL’s database yet: the file’s own colour is used.')
    : t('Only camera RAW files and DNGs have a camera colour.')
}
