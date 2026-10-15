/**
 * The renders behind the gamut warning (E22), the Metrics tab's gamut
 * coverage (E76's chromaticity) and the soft proof: the first two beside
 * the picture, from the same grade, each made only to be measured or drawn
 * over it; the proof the picture itself, made in steps. Built here, apart
 * from the session (render.ts), so the tests can send them to the engine.
 */
import type {
  ColorPolicy,
  ColorSpaceRef,
  ConvertRequest,
  Measure,
  RenderingIntent,
  SourceInfo
} from '../shared/engine-types'
import { STRIP_ALL } from '../shared/engine-types'
import type { Compiled } from '../shared/compile'
import { GAMUT_SCALE } from '../shared/gamutwarning'
import {
  isBuiltin,
  NOT_A_PROFILE,
  profileName,
  proofKey,
  proofUse,
  readIccHeader,
  returnPolicy,
  type ProofSettings
} from '../shared/proof'
import type { ProofIssue } from '../shared/ipc'
import { blankRequest, displayPolicy } from './source'
import { CICP_DISPLAY_P3, encodePng16, iccpChunk } from './pngio'
import { profileBytes } from './iccprofiles'
import type { ProxyFile } from './proxy'

/** The space a gamut warning measures against, and how a conversion would reach it. */
export interface GamutTarget {
  to: ColorSpaceRef
  intent: RenderingIntent
  black_point_compensation: boolean
}

type Graded = Pick<Compiled, 'grade' | 'framing' | 'lens' | 'retouch'>

/** The gamut coverage's u′v′ density, cells a side (0.0025 each over the engine's 0…0.65). */
export const COVERAGE_SIZE = 256

/**
 * The gamut warning's plane: the settled SDR picture's render (its source,
 * grade and colour) with `inspect: GamutWarning` against the export's
 * space, written as a one-channel PNG (`GAMUT_SCALE` ΔE2000 at full scale).
 */
export function gamutWarningRequest(
  src: Pick<ProxyFile, 'path' | 'input'>,
  out: string,
  info: SourceInfo,
  graded: Graded,
  target: GamutTarget,
  threads: number
): ConvertRequest {
  return {
    ...blankRequest(src.path, out, src.input),
    pixel: { depth: 'Eight', channels: 1 },
    encode: { Png: { compression: 'Fast', filter: 'Sub' } },
    metadata: STRIP_ALL,
    color: displayPolicy(info, 'DisplayP3'),
    grade: graded.grade,
    framing: graded.framing,
    lens: graded.lens,
    retouch: graded.retouch,
    inspect: {
      GamutWarning: {
        to: target.to,
        intent: target.intent,
        black_point_compensation: target.black_point_compensation,
        scale: GAMUT_SCALE
      }
    },
    threads
  }
}

/**
 * The gamut coverage's render: the SDR picture's grade, its float buffer
 * measured before the egress (`at: 'Working'`, linear PixlRGB) for its u′v′
 * density, so colours past the screen's gamut count where they really are.
 * Its pixels are only a byproduct: a small frame, left in the engine's
 * host. A warp's empty corners are left out. A photo with no grade has no
 * float buffer (the engine refuses by `measure.at`): its proxy, the picture
 * then, is measured as it is instead (render.ts `gamutCoverage`).
 */
export function coverageRequest(
  src: Pick<ProxyFile, 'path' | 'input'>,
  info: SourceInfo,
  graded: Graded,
  transparent: boolean,
  threads: number
): ConvertRequest {
  const measure: Measure = {
    at: 'Working',
    domain: 'Linear',
    bins: 16,
    percentiles: [],
    clip_low: 0,
    clip_high: 1,
    hue_bins: 1,
    stride: 1,
    transparent: 'Exclude',
    noise: false,
    scopes: { chromaticity: { size: COVERAGE_SIZE } }
  }
  return {
    ...blankRequest(src.path, '', src.input),
    sink: 'Bytes',
    pixel: { depth: 'Eight', channels: transparent ? 4 : 3 },
    encode: { Pixels: { sample: 'U8' } },
    metadata: { exif: false, icc: true, xmp: false, iptc: false },
    color: displayPolicy(info, 'DisplayP3'),
    grade: graded.grade,
    framing: graded.framing,
    lens: graded.lens,
    retouch: graded.retouch,
    threads,
    measure
  }
}

/**
 * The gamut warning of an HDR source's SDR picture: measured on that picture
 * as a 16-bit Display P3 file (`proofSteps`' first step), since the engine
 * measures none through a tone map.
 */
export function gamutOnFile(
  file: string,
  out: string,
  target: GamutTarget,
  threads: number,
  input: 'Tiff' | 'Png' = 'Tiff'
): ConvertRequest {
  return {
    ...blankRequest(file, out, input),
    pixel: { depth: 'Eight', channels: 1 },
    encode: { Png: { compression: 'Fast', filter: 'Sub' } },
    metadata: STRIP_ALL,
    color: {
      ConvertTo: {
        to: 'DisplayP3',
        intent: 'RelativeColorimetric',
        black_point_compensation: false
      }
    },
    inspect: {
      GamutWarning: {
        to: target.to,
        intent: target.intent,
        black_point_compensation: target.black_point_compensation,
        scale: GAMUT_SCALE
      }
    },
    threads
  }
}

// ── the soft proof ──

/** A proof as the engine is asked for it: into `to` by the chosen intent, and back. */
export interface ProofPlan extends GamutTarget {
  back: { intent: RenderingIntent; black_point_compensation: boolean }
}

export function proofPlan(s: ProofSettings, to: ColorSpaceRef): ProofPlan {
  return {
    to,
    intent: s.intent,
    black_point_compensation: s.bpc,
    back: returnPolicy(s)
  }
}

/**
 * A proof's settings as the engine takes them: its plan (a built-in space
 * by name, a file's bytes), whether engine 0.21 can only warn against it
 * (a CMYK or grey profile), or why there is no proof (the file is nowhere,
 * or is no profile the engine can use). Never another profile in its place.
 */
export type ProofTarget =
  | { ok: true; key: string; name: string; plan: ProofPlan; warnOnly: boolean }
  | { ok: false; issue: ProofIssue }

export async function resolveProof(s: ProofSettings): Promise<ProofTarget> {
  const key = proofKey(s)
  const name = profileName(s.profile)
  if (isBuiltin(s.profile))
    return { ok: true, key, name, plan: proofPlan(s, s.profile), warnOnly: false }
  const bytes = await profileBytes(s.profile)
  if (!bytes) return { ok: false, issue: { kind: 'missing', key, name } }
  const header = readIccHeader(bytes)
  const use = header ? proofUse(header) : ({ use: 'none', why: NOT_A_PROFILE } as const)
  if (use.use === 'none') return { ok: false, issue: { kind: 'unusable', key, name, why: use.why } }
  return {
    ok: true,
    key,
    name,
    plan: proofPlan(s, { Icc: bytes }),
    warnOnly: use.use === 'warning'
  }
}

/** Whether a request's picture is an HDR source tone mapped for the screen. */
export const toneMapped = (req: Pick<ConvertRequest, 'color'>): boolean =>
  typeof req.color === 'object' && 'ToneMap' in req.color

/** The space a picture's colour policy writes (the screen's), which the proof comes back to. */
function screenSpace(color: ColorPolicy): ColorSpaceRef {
  if (typeof color === 'object' && 'ConvertTo' in color) return color.ConvertTo.to
  if (typeof color === 'object' && 'ToneMap' in color) return color.ToneMap.to
  throw new Error('a soft proof is of an SDR picture: no HDR master')
}

/** A step's 16-bit file, its profile embedded: what the next step reads its colour from. */
export function toFile(req: ConvertRequest, path: string, color: ColorPolicy): ConvertRequest {
  return {
    ...req,
    sink: { Path: path },
    pixel: { depth: 'Sixteen', channels: req.pixel.channels === 4 ? 4 : 3 },
    encode: { Tiff: { compression: 'None' } },
    metadata: { exif: false, icc: true, xmp: false, iptc: false },
    color,
    dither: 'None',
    inspect: null,
    measure: null
  }
}

/**
 * A picture's request (the settled picture, the before, a 1:1 tile, made
 * for the screen) as a soft proof, in the engine's own colour management:
 * the request rendered into the proof's profile, as a 16-bit file; then that
 * file back to what the request asked (its sink, pixels and measurements),
 * by `plan.back`. An HDR source's SDR picture is a tone map, which cannot
 * be followed by a conversion in one request: it is tone mapped first, as
 * it is shown, and that file converted. `mids` names the files between
 * (two; the first is used only for an HDR source). Returns the requests in
 * order; each but the last writes the next one's source.
 */
export function proofSteps(
  req: ConvertRequest,
  plan: ProofPlan,
  mids: [string, string]
): ConvertRequest[] {
  const screen = screenSpace(req.color)
  const into: ColorPolicy = {
    ConvertTo: {
      to: plan.to,
      intent: plan.intent,
      black_point_compensation: plan.black_point_compensation
    }
  }
  const steps = toneMapped(req)
    ? [
        toFile(req, mids[0], req.color),
        toFile({ ...blankRequest(mids[0], '', 'Tiff'), threads: req.threads }, mids[1], into)
      ]
    : [toFile(req, mids[1], into)]
  const back: ConvertRequest = {
    ...blankRequest(mids[1], '', 'Tiff'),
    sink: req.sink,
    pixel: req.pixel,
    encode: req.encode,
    metadata: req.metadata,
    color: { ConvertTo: { to: screen, ...plan.back } },
    threads: req.threads,
    measure: req.measure
  }
  return [...steps, back]
}

/**
 * A 2 × 1 picture in a profile's own space, the profile embedded: its white
 * (every channel full) and its black. What the proof setup checks a profile
 * with, and reads the paper's white from (shown back by Absolute
 * colorimetric, as Simulate paper and ink shows the photo).
 */
export function paperPng(icc: number[]): Buffer {
  return encodePng16(new Uint16Array([65535, 65535, 65535, 0, 0, 0]), 2, 1, 3, 1, [iccpChunk(icc)])
}

/** A Display P3 green past every printer's gamut beside a mid grey: what a warning-only profile is tried on. */
export function probePng(): Buffer {
  return encodePng16(new Uint16Array([10000, 65000, 10000, 32768, 32768, 32768]), 2, 1, 3, 1, [
    CICP_DISPLAY_P3
  ])
}

/**
 * The requests that try a proof's settings on the engine (the proof setup,
 * before they are used): an RGB profile's picture of its own white and
 * black into it by the chosen intent and back by Absolute colorimetric
 * (both transforms built, and the paper's white read from the result); a
 * warning-only profile's gamut warning. `png` holds `paperPng` or
 * `probePng`; `mid` is the file between.
 */
export function checkRequests(
  target: { plan: ProofPlan; warnOnly: boolean },
  png: string,
  mid: string,
  out: string
): ConvertRequest[] {
  if (target.warnOnly) return [gamutOnFile(png, out, target.plan, 1, 'Png')]
  const back = returnPolicy({ simulate: true })
  return proofSteps(
    {
      ...blankRequest(png, out, 'Png'),
      pixel: { depth: 'Eight', channels: 3 },
      metadata: { exif: false, icc: true, xmp: false, iptc: false },
      color: { ConvertTo: { to: 'DisplayP3', ...back } },
      threads: 1
    },
    { ...target.plan, back },
    [mid, mid]
  )
}
