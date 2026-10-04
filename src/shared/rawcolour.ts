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
 * Pure, for tests/rawcolour.test.ts.
 */
import type { CameraColour, SourceInfo, WhitePoint } from './engine-types'
import { RAW_DEVELOP_REV } from './pixels'

export type RawColour = 'container' | 'pixl:1'

/** The version of PIXL's camera database Playroom asks for. */
export const PIXL_COLOUR_VERSION = 1

export const parseRawColour = (v: unknown): RawColour | null =>
  v === 'container' || v === 'pixl:1' ? v : null

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
  return c === 'pixl:1' && !pixlSupported(info) ? 'container' : c
}

export function cameraColourOf(c: RawColour): CameraColour {
  return c === 'pixl:1' ? { Pixl: { version: PIXL_COLOUR_VERSION } } : 'Container'
}

/**
 * What names this develop in caches and on the pixel steps laid on it:
 * `RAW_DEVELOP_REV` for the file's own colour (so every name and stamp made
 * before this stands), with `p1` after it for PIXL's version 1.
 */
export function developMark(c: RawColour): string {
  return c === 'pixl:1' ? `${RAW_DEVELOP_REV}p${PIXL_COLOUR_VERSION}` : RAW_DEVELOP_REV
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
  return 'Container (the file’s own)'
}

/** Why a photo has no PIXL colour to offer, or null when it has. */
export function rawColourReason(info: Colourable | null | undefined): string | null {
  if (pixlSupported(info)) return null
  return info?.camera_colour
    ? 'This camera is not in PIXL’s database yet: the file’s own colour is used.'
    : 'Only camera RAW files and DNGs have a camera colour.'
}
