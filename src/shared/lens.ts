/**
 * Lens corrections: Playroom's side of them. The engine applies a lens
 * correction exactly as stated and never looks a lens up, so everything
 * about *which* correction — matching a profile to the lens the file names,
 * evaluating it at this shot's focal length and aperture, the manual
 * sliders — happens here.
 *
 * A **profile** is a JSON file describing one lens (Lensfun's models: poly3,
 * poly5 or ptlens distortion; linear or poly3 TCA; the `pa` vignetting
 * polynomial), sampled at several focal lengths (and, for vignetting,
 * apertures and distances). The catalogue is Lensfun's database, converted
 * by `scripts/lensfun-profiles.mjs`: bundled with the app and kept current
 * from the models server (`main/lensprofiles.ts`); the user can import
 * their own. When one applies, the recipe keeps the correction it resolved
 * to, so the photo renders the same on a machine without the profile.
 *
 * Lensfun states its coefficients on the calibration camera's frame:
 * distortion and TCA with r = 1 at half its shorter side, vignetting at half
 * its diagonal. A photo from another sensor size or shape keeps the numbers
 * as they are and moves r = 1 to where that length falls on it (the
 * engine's `Focal` unit: a fraction of the canvas's longer side), from the
 * two crop factors and aspect ratios — exact where rescaling the
 * coefficients would not be (a poly3's or ptlens's constant term).
 *
 * Everything here is pure: the renderer and the main process both use it.
 */
import type {
  Defringe,
  RadiusUnit,
  Distortion,
  DistortionModel,
  LateralCa,
  LateralCaModel,
  LensCorrection,
  LensGeometry,
  ShotLens,
  Vignetting
} from './engine-types'

// ── Profiles ─────────────────────────────────────────────────────────────────

/**
 * What r = 1 is for a profile's models: a length of the photo's own frame,
 * or `Lensfun`, lengths of the calibration camera's (see `calibration`).
 */
export type ProfileUnit = 'HalfShorterSide' | 'HalfDiagonal' | 'FarthestCorner' | 'Lensfun'

export interface DistortionSample {
  focal: number
  model: 'poly3' | 'poly5' | 'ptlens'
  /** poly3: [k1]; poly5: [k1, k2]; ptlens: [a, b, c]. */
  k: number[]
}

export interface TcaSample {
  focal: number
  /** linear: [scale]; poly3: [v, c, b], per channel. */
  model: 'linear' | 'poly3'
  red: number[]
  blue: number[]
}

export interface VignettingSample {
  focal: number
  aperture: number
  /** Focus distance in metres, where the numbers depend on it. */
  distance?: number
  /** The falloff polynomial `1 + k1 r² + k2 r⁴ + k3 r⁶` (Lensfun `pa`); divided out. */
  k: number[]
}

/** One lens, as a profile file holds it. */
export interface LensProfile {
  /** Its file name without `.json`; unique in the store. */
  id: string
  maker: string
  model: string
  /** Other names the lens goes by in files (EXIF `LensModel` variants). */
  aliases?: string[]
  mount?: string
  /** Every mount it fits (a Lensfun lens often lists several). */
  mounts?: string[]
  /** Its projection when not rectilinear (fisheye, equisolid…): only TCA and vignetting are kept. */
  type?: string
  /** Its focal range, mm: a shot outside it is not this lens. */
  focal?: number[]
  /** Where the numbers came from, for the credit (Lensfun, a vendor, measured). */
  source?: string
  /** What r = 1 is for every model in the profile. */
  unit: ProfileUnit
  /** `Lensfun` unit: the calibration camera's crop factor and aspect ratio (long / short). */
  calibration?: { crop: number; aspect: number }
  distortion?: DistortionSample[]
  tca?: TcaSample[]
  vignetting?: VignettingSample[]
}

/** A profile evaluated for one shot: what the recipe keeps. */
export interface ResolvedProfile {
  /** The profile's name as shown, and what the shot was evaluated at. */
  name: string
  focal: number | null
  aperture: number | null
  unit: ProfileUnit
  /** Where r = 1 falls on this photo, when the profile's lengths are not its own (`Lensfun`). */
  geometryUnit?: RadiusUnit
  vignettingUnit?: RadiusUnit
  /** The crop factor the units were worked out for, and where it came from. */
  crop?: { value: number; from: 'exif' | 'camera' | 'calibration' }
  distortion: DistortionModel | null
  tca: LateralCaModel | null
  /** The falloff polynomial's coefficients (r², r⁴, …), divided out. */
  vignetting: number[] | null
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const nums = (v: unknown, n?: number): v is number[] =>
  Array.isArray(v) && v.every(isNum) && (n === undefined || v.length === n)

const DIST_ARITY = { poly3: 1, poly5: 2, ptlens: 3 } as const
const TCA_ARITY = { linear: 1, poly3: 3 } as const

/** Check a profile read from a file; returns it, or why it is refused. */
export function validateProfile(v: unknown, id: string): LensProfile | string {
  if (typeof v !== 'object' || v === null) return 'not a JSON object'
  const p = v as Record<string, unknown>
  if (typeof p.maker !== 'string' || typeof p.model !== 'string')
    return '`maker` and `model` must be strings'
  if (!['HalfShorterSide', 'HalfDiagonal', 'FarthestCorner', 'Lensfun'].includes(p.unit as string))
    return '`unit` must be HalfShorterSide, HalfDiagonal, FarthestCorner or Lensfun'
  const cal = p.calibration as Record<string, unknown> | undefined
  if (
    p.unit === 'Lensfun' &&
    !(cal && isNum(cal.crop) && cal.crop > 0 && isNum(cal.aspect) && cal.aspect > 0)
  )
    return 'a `Lensfun` profile needs `calibration`: its camera’s `crop` and `aspect`'
  const list = (key: string): Record<string, unknown>[] | string => {
    const x = p[key]
    if (x === undefined) return []
    if (!Array.isArray(x) || !x.every((e) => typeof e === 'object' && e !== null))
      return `\`${key}\` must be a list of samples`
    return x as Record<string, unknown>[]
  }
  const dist = list('distortion')
  const tca = list('tca')
  const vig = list('vignetting')
  for (const l of [dist, tca, vig]) if (typeof l === 'string') return l
  for (const s of dist as Record<string, unknown>[]) {
    const n = DIST_ARITY[s.model as keyof typeof DIST_ARITY]
    if (!isNum(s.focal) || !n || !nums(s.k, n))
      return 'each distortion sample needs `focal`, `model` (poly3, poly5, ptlens) and its `k`'
  }
  for (const s of tca as Record<string, unknown>[]) {
    const n = TCA_ARITY[s.model as keyof typeof TCA_ARITY]
    if (!isNum(s.focal) || !n || !nums(s.red, n) || !nums(s.blue, n))
      return 'each tca sample needs `focal`, `model` (linear, poly3), `red` and `blue`'
  }
  for (const s of vig as Record<string, unknown>[]) {
    if (!isNum(s.focal) || !isNum(s.aperture) || !nums(s.k) || (s.k as number[]).length < 1)
      return 'each vignetting sample needs `focal`, `aperture` and `k`'
    if ((s.k as number[]).length > 3) return 'vignetting takes at most three coefficients'
  }
  if (!(dist as unknown[]).length && !(tca as unknown[]).length && !(vig as unknown[]).length)
    return 'the profile corrects nothing'
  return {
    id,
    maker: p.maker,
    model: p.model,
    aliases: Array.isArray(p.aliases) ? p.aliases.filter((a) => typeof a === 'string') : [],
    mount: typeof p.mount === 'string' ? p.mount : undefined,
    mounts: Array.isArray(p.mounts) ? p.mounts.filter((m) => typeof m === 'string') : undefined,
    type: typeof p.type === 'string' ? p.type : undefined,
    focal: nums(p.focal) ? p.focal : undefined,
    source: typeof p.source === 'string' ? p.source : undefined,
    unit: p.unit as ProfileUnit,
    calibration:
      p.unit === 'Lensfun'
        ? { crop: cal!.crop as number, aspect: cal!.aspect as number }
        : undefined,
    distortion: dist as unknown as DistortionSample[],
    tca: tca as unknown as TcaSample[],
    vignetting: vig as unknown as VignettingSample[]
  }
}

/** Letters and digits only, lower case: "EF-S 18-55mm f/4-5.6" → "efs1855mmf456". */
const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')

export function profileName(p: Pick<LensProfile, 'maker' | 'model'>): string {
  return p.model.toLowerCase().startsWith(p.maker.toLowerCase()) ? p.model : `${p.maker} ${p.model}`
}

/** A camera as the catalogue knows it: what its crop factor is (Lensfun's cameras). */
export interface CameraEntry {
  maker: string
  model: string
  aliases?: string[]
  variant?: string
  mount: string | null
  crop: number
}

/** A mount and the mounts whose lenses fit it (through an adapter or as is). */
export interface MountEntry {
  name: string
  compat?: string[]
}

/** The camera a photo was taken with, as its EXIF names it. */
export interface ShotCamera {
  make: string | null
  model: string | null
}

/** A name without its maker's prefix, squashed: "Canon EF-S 18-55mm" → "efs1855mm". */
function bare(name: string, maker: string | null | undefined): string {
  const n = squash(name)
  const m = maker ? squash(maker) : ''
  return m && n.startsWith(m) && n.length > m.length ? n.slice(m.length) : n
}

/** The catalogue's entry for a camera, matched as lenses are, ignoring the maker prefix. */
export function findCamera(camera: ShotCamera | null, cameras: CameraEntry[]): CameraEntry | null {
  if (!camera?.model) return null
  const want = bare(camera.model, camera.make)
  if (!want) return null
  const names = (c: CameraEntry): string[] =>
    [c.model, ...(c.aliases ?? [])].map((n) => bare(n, c.maker))
  const makerOk = (c: CameraEntry): boolean =>
    !camera.make || squash(c.maker).startsWith(squash(camera.make).slice(0, 4))
  return cameras.find((c) => makerOk(c) && names(c).includes(want)) ?? null
}

/**
 * The photo's crop factor: from its EXIF (the 35 mm equivalent focal over
 * the focal), else its camera's in the catalogue; null when neither says.
 */
export function shotCrop(
  lens: ShotLens | null,
  camera: CameraEntry | null
): { value: number; from: 'exif' | 'camera' } | null {
  if (lens?.focal_mm && lens.focal_35mm && lens.focal_35mm >= lens.focal_mm * 0.9)
    return { value: Math.round((lens.focal_35mm / lens.focal_mm) * 1000) / 1000, from: 'exif' }
  if (camera) return { value: camera.crop, from: 'camera' }
  return null
}

/** Mounts a camera's lenses may have: its own and every one listed as fitting it. */
export function mountsFor(mount: string | null, mounts: MountEntry[]): Set<string> | null {
  if (!mount) return null
  const out = new Set([mount])
  for (const c of mounts.find((m) => m.name === mount)?.compat ?? []) out.add(c)
  return out
}

/**
 * A lens's focal range: as the profile states it, else as its name does
 * ("18-55mm", "50mm"), else null.
 */
export function focalRange(p: Pick<LensProfile, 'focal' | 'model'>): [number, number] | null {
  if (p.focal?.length) return [p.focal[0], p.focal[p.focal.length - 1]]
  const m = /(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?\s*mm/i.exec(p.model)
  if (!m) return null
  const lo = Number(m[1])
  const hi = m[2] ? Number(m[2]) : lo
  return lo > 0 && hi >= lo ? [lo, hi] : null
}

/**
 * How well a profile answers to a file's lens, 0 when it does not: its model
 * or an alias equal to the file's, ignoring the maker, case and punctuation
 * (100), or one containing the other (less, by how much is left over); a
 * shot outside the lens's focal range is not this lens. Among equals, a
 * profile of a mount the camera takes, then one calibrated on a sensor the
 * size of the photo's, wins.
 */
function lensScore(
  p: LensProfile,
  want: string,
  focal: number | null,
  mounts: Set<string> | null,
  crop: number | null
): number {
  const range = focalRange(p)
  if (focal && range) {
    const [lo, hi] = range
    if (focal < lo * 0.97 || focal > hi * 1.03) return 0
  }
  let best = 0
  for (const n of [p.model, ...(p.aliases ?? [])].map((x) => bare(x, p.maker))) {
    if (!n) continue
    if (n === want) best = Math.max(best, 100)
    else {
      const [short, long] = n.length < want.length ? [n, want] : [want, n]
      if (short.length >= 6 && long.includes(short))
        best = Math.max(best, 40 + 40 * (short.length / long.length))
    }
  }
  if (!best) return 0
  if (mounts && (p.mounts ?? (p.mount ? [p.mount] : [])).some((m) => mounts.has(m))) best += 5
  if (crop && p.calibration) best += 4 / (1 + Math.abs(Math.log(p.calibration.crop / crop)) * 8)
  return best
}

/**
 * The profile for the lens a file names, among `profiles`: the best scoring
 * (see `lensScore`), or null. `camera` (its mount) and `crop` break ties.
 */
export function matchProfile(
  lens: ShotLens | null,
  profiles: LensProfile[],
  context: { mounts?: Set<string> | null; crop?: number | null } = {}
): LensProfile | null {
  const want = lens?.model ? bare(lens.model, lens.make) : ''
  if (!want) return null
  let best: LensProfile | null = null
  let score = 0
  for (const p of profiles) {
    const s = lensScore(
      p,
      want,
      lens?.focal_mm ?? null,
      context.mounts ?? null,
      context.crop ?? null
    )
    if (s > score) {
      best = p
      score = s
    }
  }
  return best
}

/**
 * Where a `Lensfun` profile's r = 1 falls on this photo, as fractions of the
 * canvas's longer side: the calibration frame's half shorter side
 * (distortion, TCA) and half diagonal (vignetting), scaled by the two crop
 * factors (a sensor's diagonal is 43.27 mm over its crop factor, and the
 * photo is taken to span it) and placed by the photo's aspect.
 */
export function lensfunUnits(
  calibration: { crop: number; aspect: number },
  photo: { crop: number; width: number; height: number }
): { geometry: number; vignetting: number } {
  const a = Math.max(photo.width, photo.height) / Math.max(1, Math.min(photo.width, photo.height))
  const ac = calibration.aspect
  const k = photo.crop / calibration.crop
  const long = a / Math.hypot(a, 1) // the photo's longer side, over its diagonal
  return {
    geometry: round6((k * (1 / Math.hypot(ac, 1)) * 0.5) / long),
    vignetting: round6((k * 0.5) / long)
  }
}

/** Linear interpolation of coefficient lists between the two samples around `x`. */
function interpolate<T>(
  samples: T[],
  x: number | null,
  key: (s: T) => number,
  k: (s: T) => number[]
): number[] {
  const sorted = [...samples].sort((a, b) => key(a) - key(b))
  if (sorted.length === 0) return []
  if (x === null || sorted.length === 1) return k(sorted[Math.floor(sorted.length / 2)])
  if (x <= key(sorted[0])) return k(sorted[0])
  const last = sorted[sorted.length - 1]
  if (x >= key(last)) return k(last)
  const i = sorted.findIndex((s) => key(s) >= x)
  const a = sorted[i - 1]
  const b = sorted[i]
  const t = (x - key(a)) / (key(b) - key(a))
  return k(a).map((v, j) => v + t * (k(b)[j] - v))
}

/**
 * A profile at this shot's focal length and aperture. Distortion and TCA
 * interpolate between the focal lengths around the shot's (a zoom's samples
 * rarely land on it); vignetting takes the samples at the nearest aperture
 * (in stops) and interpolates those by focal length. Without a focal length
 * the middle sample stands in.
 */
export function resolveProfile(
  p: LensProfile,
  lens: ShotLens | null,
  photo?: { crop: { value: number; from: 'exif' | 'camera' } | null; width: number; height: number }
): ResolvedProfile {
  // A manual or adapted lens reports 0 (or nothing): unknown, not a number to work with.
  const known = (v: number | null | undefined): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
  const focal = known(lens?.focal_mm)
  const aperture = known(lens?.f_number)
  const distanceM = known(lens?.focus_distance_m)
  let distortion: DistortionModel | null = null
  if (p.distortion?.length) {
    // One model per profile: the most common one's samples.
    const model = p.distortion[0].model
    const k = interpolate(
      p.distortion.filter((s) => s.model === model),
      focal,
      (s) => s.focal,
      (s) => s.k
    )
    distortion =
      model === 'poly3'
        ? { Poly3: { k1: k[0] } }
        : model === 'poly5'
          ? { Poly5: { k1: k[0], k2: k[1] } }
          : { PtLens: { a: k[0], b: k[1], c: k[2] } }
  }
  let tca: LateralCaModel | null = null
  if (p.tca?.length) {
    const model = p.tca[0].model
    const same = p.tca.filter((s) => s.model === model)
    const red = interpolate(
      same,
      focal,
      (s) => s.focal,
      (s) => s.red
    )
    const blue = interpolate(
      same,
      focal,
      (s) => s.focal,
      (s) => s.blue
    )
    tca =
      model === 'linear'
        ? { Scale: { red: red[0], blue: blue[0] } }
        : {
            Poly3: {
              red: { v: red[0], c: red[1], b: red[2] },
              blue: { v: blue[0], c: blue[1], b: blue[2] }
            }
          }
  }
  let vignetting: number[] | null = null
  if (p.vignetting?.length) {
    const stops = (n: number): number => 2 * Math.log2(n)
    // The distance the focus was at (or the farthest, which most shots are
    // near): Lensfun keeps a distance only where it changes the falloff.
    const far = (x: VignettingSample): number => x.distance ?? Infinity
    const byDistance = (list: VignettingSample[]): VignettingSample[] => {
      if (!list.some((x) => x.distance !== undefined)) return list
      const at = (x: VignettingSample): number =>
        distanceM === null
          ? -far(x)
          : Math.abs(Math.log(Math.min(far(x), 1000) / Math.max(0.05, distanceM)))
      const best = Math.min(...list.map(at))
      return list.filter((x) => at(x) - best < 1e-6)
    }
    const byAperture =
      aperture === null
        ? p.vignetting
        : (() => {
            const best = Math.min(
              ...p.vignetting.map((s) => Math.abs(stops(s.aperture) - stops(aperture)))
            )
            return p.vignetting.filter(
              (s) => Math.abs(Math.abs(stops(s.aperture) - stops(aperture)) - best) < 1e-6
            )
          })()
    // A profile's own odd samples (an aperture of 0) match nothing: all of them, then.
    const nearest = byDistance(byAperture.length > 0 ? byAperture : p.vignetting)
    vignetting =
      nearest.length > 0
        ? interpolate(
            nearest,
            focal,
            (s) => s.focal,
            (s) => s.k
          )
        : null
  }
  const out: ResolvedProfile = {
    name: profileName(p),
    focal,
    aperture,
    unit: p.unit,
    distortion,
    tca,
    vignetting
  }
  if (p.unit === 'Lensfun' && p.calibration && photo) {
    // Without a crop factor for the photo, it is taken to be the calibration
    // camera's own (a lens profiled on the system it is sold for).
    const crop = photo.crop ?? { value: p.calibration.crop, from: 'calibration' as const }
    const u = lensfunUnits(p.calibration, {
      crop: crop.value,
      width: photo.width,
      height: photo.height
    })
    out.geometryUnit = { Focal: { x: u.geometry, y: u.geometry } }
    out.vignettingUnit = { Focal: { x: u.vignetting, y: u.vignetting } }
    out.crop = crop
  }
  return out
}

// ── The recipe's lens settings → the engine's correction ─────────────────────

/** The lens panel's settings (in `Recipe.lens`). */
export interface LensSetting {
  profile: {
    enabled: boolean
    /** The profile chosen by id, or null to take the one matching the lens. */
    id: string | null
    /** The correction it resolved to for this photo (null: none found). */
    resolved: ResolvedProfile | null
    /** 0…200 %: how much of the profile's distortion and vignetting to correct. */
    distortion: number
    vignetting: number
  }
  /** −100…100: positive pulls barrel distortion in, negative pushes pincushion out. */
  distortion: number
  /** −100…100: positive brightens the corners, negative darkens them. */
  vignetting: number
  /** 0…100: how far out the manual vignetting starts. */
  vignettingMidpoint: number
  /** Remove lateral chromatic aberration, as measured on this photo. */
  removeCa: boolean
  /** The measurement (at amount 1), kept so the photo renders the same everywhere. */
  ca: LateralCa | null
  defringe: {
    /** 0…100 each; hues in degrees. */
    purpleAmount: number
    purpleHue: number
    greenAmount: number
    greenHue: number
  }
}

export function defaultLens(): LensSetting {
  return {
    profile: { enabled: false, id: null, resolved: null, distortion: 100, vignetting: 100 },
    distortion: 0,
    vignetting: 0,
    vignettingMidpoint: 50,
    removeCa: false,
    ca: null,
    defringe: { purpleAmount: 0, purpleHue: 300, greenAmount: 0, greenHue: 115 }
  }
}

/** Where the manual corrections sit: the frame's centre, r = 1 at its corners. */
export const MANUAL_GEOMETRY: LensGeometry = {
  centre: { x: 0.5, y: 0.5 },
  unit: 'HalfDiagonal'
}

/** How far the manual distortion slider's end bends (Lensfun poly3 `k1`). */
const MANUAL_K1 = 0.15
/** How much light the manual vignetting slider's end moves at the corners. */
const MANUAL_VIGNETTE = 0.6

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const round6 = (v: number): number => Math.round(v * 1e6) / 1e6

const geometryOf = (unit: RadiusUnit): LensGeometry => ({ centre: { x: 0.5, y: 0.5 }, unit })

/**
 * Where a resolved profile's models are measured on the photo. A `Lensfun`
 * profile resolved without the photo's size (an old recipe) falls back to
 * its calibration frame's own lengths, which hold on the same camera.
 */
function profileGeometry(p: ResolvedProfile, what: 'geometry' | 'vignetting'): LensGeometry {
  const unit = what === 'geometry' ? p.geometryUnit : p.vignettingUnit
  if (unit) return geometryOf(unit)
  if (p.unit === 'Lensfun')
    return geometryOf(what === 'geometry' ? 'HalfShorterSide' : 'HalfDiagonal')
  return geometryOf(p.unit)
}

/** Whether the profile's distortion is what corrects this photo (the manual slider steps aside). */
export function profileDistorts(l: LensSetting): boolean {
  return l.profile.enabled && !!l.profile.resolved?.distortion && l.profile.distortion > 0
}

/** `(1 + Σ a_i r^(2i+2)) × (1 + Σ b_j r^(2j+2))` as coefficients of r², r⁴, … */
function multiply(a: number[], b: number[]): number[] {
  const pa = [1, ...a]
  const pb = [1, ...b]
  const out = new Array(pa.length + pb.length - 1).fill(0)
  pa.forEach((x, i) => pb.forEach((y, j) => (out[i + j] += x * y)))
  return out.slice(1)
}

/**
 * The manual vignetting's falloff polynomial (divided out): a strength
 * split between r² and r⁴ by the midpoint — a high midpoint keeps the
 * change in the corners.
 */
function manualFalloff(amount: number, midpoint: number): number[] {
  const s = (clamp(amount, -100, 100) / 100) * MANUAL_VIGNETTE
  const m = clamp(midpoint, 0, 100) / 100
  return [-s * (1 - m), -s * m]
}

/**
 * The engine's lens correction for these settings, or null when nothing is
 * corrected. Distortion comes from the profile when it has one, else the
 * manual slider; the profile's and the manual vignetting multiply into one
 * polynomial; lateral CA is the measurement (a profile's TCA when nothing
 * was measured). A warp's outside pixels are cropped away, keeping the
 * frame's aspect, so every crop and mask stays a fraction of the same shape.
 */
export function lensCorrection(l: LensSetting): LensCorrection | null {
  const p = l.profile.enabled ? l.profile.resolved : null
  let distortion: Distortion | null = null
  if (p?.distortion && l.profile.distortion > 0) {
    distortion = {
      model: p.distortion,
      geometry: profileGeometry(p, 'geometry'),
      amount: round6(clamp(l.profile.distortion / 100, 0, 2)),
      scale: 1
    }
  } else if (l.distortion !== 0) {
    distortion = {
      model: { Poly3: { k1: round6((-clamp(l.distortion, -100, 100) / 100) * MANUAL_K1) } },
      geometry: MANUAL_GEOMETRY,
      amount: 1,
      scale: 1
    }
  }
  let lateral: LateralCa | null = null
  if (l.removeCa && l.ca) lateral = { ...l.ca, amount: 1 }
  else if (l.removeCa && p?.tca)
    lateral = { model: p.tca, geometry: profileGeometry(p, 'geometry'), amount: 1 }
  const profileVig =
    p?.vignetting && l.profile.vignetting > 0
      ? p.vignetting.map((k) => k * clamp(l.profile.vignetting / 100, 0, 2))
      : null
  const manualVig = l.vignetting !== 0 ? manualFalloff(l.vignetting, l.vignettingMidpoint) : null
  let vignetting: Vignetting | null = null
  if (profileVig || manualVig) {
    // Both in the profile's unit when there is one: the manual slider means
    // the same shape either way, and the product is one polynomial.
    const k = profileVig && manualVig ? multiply(profileVig, manualVig) : (profileVig ?? manualVig)!
    vignetting = {
      k: k.slice(0, 5).map(round6),
      apply: 'Divide',
      at: 'Source',
      geometry: profileVig && p ? profileGeometry(p, 'vignetting') : MANUAL_GEOMETRY,
      amount: 1
    }
  }
  if (!distortion && !lateral && !vignetting) return null
  const warps = distortion !== null || lateral !== null
  return {
    distortion,
    lateral_ca: lateral,
    vignetting,
    outside: warps ? 'Crop' : null,
    resampler: warps ? 'Lanczos3' : null
  }
}

/** Fringe bands' width and softness, degrees: Lightroom's purple is about 270–330°. */
const FRINGE_WIDTH = 50
const FRINGE_SOFTNESS = 15

/**
 * Defringe as the engine's op, or null when both amounts are 0. The edge key
 * is a luminance step of 0.03–0.10 at about two pixels of a 24 MP frame.
 */
export function defringeOp(l: LensSetting): { Defringe: Defringe } | null {
  const d = l.defringe
  if (!(d.purpleAmount > 0) && !(d.greenAmount > 0)) return null
  const band = (hue: number, amount: number): Defringe['purple'] => ({
    hue: { centre: ((hue % 360) + 360) % 360, width: FRINGE_WIDTH, softness: FRINGE_SOFTNESS },
    amount: clamp(amount / 100, 0, 1)
  })
  return {
    Defringe: {
      purple: band(d.purpleHue, d.purpleAmount),
      green: band(d.greenHue, d.greenAmount),
      edges: { sigma: 0.0006, low: 0.03, high: 0.1 }
    }
  }
}

/** The file's lens as one line: "Canon EF-S 18-55mm · 18 mm · f/11". */
export function describeLens(lens: ShotLens | null): string | null {
  if (!lens?.model && !lens?.focal_mm) return null
  const parts: string[] = []
  const name = [lens.make && !lens.model?.startsWith(lens.make) ? lens.make : null, lens.model]
    .filter(Boolean)
    .join(' ')
  if (name) parts.push(name)
  if (lens.focal_mm) parts.push(`${Math.round(lens.focal_mm * 10) / 10} mm`)
  if (lens.f_number) parts.push(`f/${Math.round(lens.f_number * 10) / 10}`)
  return parts.join(' · ')
}
