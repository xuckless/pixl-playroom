/**
 * Recipe → engine request parts. The one place the slider units are given
 * meaning: every constant that says "−100 on this slider is that many stops"
 * lives here, is pure, and is the same for a preview and an export — only
 * the context (scale of the pixels, which crop to show) differs.
 *
 * The grade is one base layer, the local-adjustment layers, then the
 * Advanced view's custom layers. The base layer runs a linear-light stage
 * (noise on a RAW, white balance, calibration, exposure) and then a
 * display-referred stage in Display P3 (profile, tone, curves, colour, detail,
 * effects) — physics where it belongs, the look where Lightroom puts it.
 */
import type {
  Blend,
  BlendMode,
  ColorGrade,
  CropRect,
  Curve,
  Curves,
  Framing,
  Grade,
  GradeLayer,
  GradeOp,
  GradeSpace,
  HslBands,
  Mask,
  MaskComponent,
  Orientation,
  Primary,
  Rgb,
  WhitePoint
} from './engine-types'
import { compose, swapsAxes, transformPoint, userOrientation } from './orientation'
import {
  HSL_BANDS,
  type CurvePointSetting,
  type LocalAdjust,
  type LocalLayer,
  type MaskComponentSetting,
  type Recipe
} from './recipe'
import { opFromAbsolute, opFromRelative, type OpWhite } from './wb'

// ── Spaces ───────────────────────────────────────────────────────────────────

/** Where the look runs: display-referred, the gamut modern cameras shoot. */
export const LOOK_SPACE: GradeSpace = {
  Encoded: { space: 'DisplayP3', intent: 'RelativeColorimetric', black_point_compensation: false }
}

/** 18% grey in the look space (sRGB transfer, shared by Display P3). */
export const MID_GREY_ENCODED = 0.4613

export const IDENTITY_PRIMARY: Primary = {
  exposure: 0,
  lift: { r: 0, g: 0, b: 0 },
  gamma: { r: 1, g: 1, b: 1 },
  gain: { r: 1, g: 1, b: 1 },
  contrast: 1,
  contrast_pivot: MID_GREY_ENCODED,
  saturation: 1,
  hue_shift: 0
}

// ── Context ──────────────────────────────────────────────────────────────────

export interface CompileContext {
  isRaw: boolean
  /** A RAW's as-shot white, which makes its temperature slider absolute. */
  asShot: WhitePoint | null
  /**
   * The source's own orientation as the engine should apply it: a file's EXIF
   * orientation, `Normal` for a developed RAW (already upright) and for a
   * proxy (built upright).
   */
  sourceOrientation: Orientation
  /** The full-resolution base frame (the file upright, before the user's turns). */
  frameWidth: number
  frameHeight: number
  /** Buffer pixels per full-resolution pixel: 1 for an export, < 1 for a proxy. */
  scale: number
  /** Reproducible grain for this photo. */
  seed: number
  /**
   * The raster planes (painted brushes and drawn gradients), by component id,
   * as grey PNG paths already turned into the user-oriented frame (the main
   * process writes them).
   */
  brushPaths: Record<string, string>
  /** False while the crop tool is open: show the whole, unrotated frame. */
  applyCrop: boolean
}

export interface Compiled {
  grade: Grade | null
  framing: Framing | null
  /** Engine layer index of each local layer, for `Inspect::LayerMask`. */
  layerIndex: Record<string, number>
  /** What the preview could not show at this scale, and why. */
  notes: string[]
  /** The user-oriented frame, full resolution. */
  orientedWidth: number
  orientedHeight: number
  /** The crop the engine was given (after auto-fit for a straighten), normalised. */
  crop: CropRect | null
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const round4 = (v: number): number => Math.round(v * 1e4) / 1e4

function primary(p: Partial<Primary>): Primary {
  return { ...IDENTITY_PRIMARY, ...p }
}

function curve(points: CurvePointSetting[]): Curve {
  const sorted = [...points].sort((a, b) => a.x - b.x)
  const out: CurvePointSetting[] = []
  for (const p of sorted) {
    const x = clamp(p.x, 0, 1)
    if (out.length > 0 && x <= out[out.length - 1].x) continue
    out.push({ x: round4(x), y: round4(p.y) })
  }
  return { points: out }
}

export function isIdentityCurve(points: CurvePointSetting[]): boolean {
  return points.every((p) => Math.abs(p.x - p.y) < 1e-6)
}

function curvesOp(c: Partial<Curves>): GradeOp {
  return {
    Curves: {
      master: null,
      red: null,
      green: null,
      blue: null,
      luma_vs_saturation: null,
      hue_vs_saturation: null,
      hue_vs_hue: null,
      ...c
    }
  }
}

/**
 * The parametric tone curve as control points: each region's slider bends the
 * curve by up to a quarter of the range with a smooth bump over its region
 * (Lightroom's Highlights/Lights/Darks/Shadows with movable splits).
 */
export function parametricCurve(tc: Recipe['toneCurve']): CurvePointSetting[] | null {
  const amounts = [tc.shadows, tc.darks, tc.lights, tc.highlights]
  if (amounts.every((a) => a === 0)) return null
  const [s1, s2, s3] = tc.splits.map((s) => clamp(s, 5, 95) / 100)
  const edges = [0, s1, s2, s3, 1]
  const bump = (x: number, a: number, b: number): number => {
    // A raised cosine over [a − w, b + w], flat-topped over [a, b].
    const w = (b - a) * 0.5
    if (x <= a - w || x >= b + w) return 0
    if (x < a) return 0.5 - 0.5 * Math.cos((Math.PI * (x - (a - w))) / w)
    if (x > b) return 0.5 + 0.5 * Math.cos((Math.PI * (x - b)) / w)
    return 1
  }
  const pts: CurvePointSetting[] = []
  for (let i = 0; i <= 16; i++) {
    const x = i / 16
    let y = x
    for (let r = 0; r < 4; r++) y += (amounts[r] / 100) * 0.25 * bump(x, edges[r], edges[r + 1])
    // Pin the ends: a region slider bends the curve, it does not move black or white.
    if (i === 0) y = 0
    if (i === 16) y = 1
    pts.push({ x, y: clamp(y, 0, 1) })
  }
  return pts
}

/** The profile looks, as control points on encoded values. */
const STANDARD_CURVE: CurvePointSetting[] = [
  { x: 0, y: 0 },
  { x: 0.1, y: 0.075 },
  { x: 0.3, y: 0.275 },
  { x: 0.5, y: 0.515 },
  { x: 0.75, y: 0.795 },
  { x: 0.92, y: 0.945 },
  { x: 1, y: 1 }
]
const VIVID_CURVE: CurvePointSetting[] = [
  { x: 0, y: 0 },
  { x: 0.1, y: 0.06 },
  { x: 0.3, y: 0.255 },
  { x: 0.5, y: 0.53 },
  { x: 0.75, y: 0.82 },
  { x: 0.92, y: 0.96 },
  { x: 1, y: 1 }
]

/**
 * Highlight protection for a positive exposure: a 1D shaper over
 * `[0, 2^exposure]` that is the identity up to a knee at 0.75 and rolls the
 * rest smoothly onto `[0.75, 1]` (a rational shoulder, slope-continuous at the
 * knee, reaching 1 exactly at the new white). Without it, a stop of exposure
 * carries everything above half-white past 1.0 through the look stage and
 * clips it hard at the output.
 */
export function shoulderCube(exposure: number, size = 1024): string {
  const top = 2 ** exposure
  const knee = 0.75
  const a = (top - knee) / (1 - knee)
  const lines = [
    'TITLE "Playroom highlight shoulder"',
    `LUT_1D_SIZE ${size}`,
    `DOMAIN_MIN 0 0 0`,
    `DOMAIN_MAX ${top} ${top} ${top}`
  ]
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * top
    let y: number
    if (x <= knee) y = x
    else {
      const t = (x - knee) / (top - knee)
      y = knee + (1 - knee) * ((a * t) / (1 + (a - 1) * t))
    }
    const v = y.toFixed(6)
    lines.push(`${v} ${v} ${v}`)
  }
  return lines.join('\n') + '\n'
}

// ── White balance ────────────────────────────────────────────────────────────

/** The base white balance as an engine op white, or null for the identity. */
export function baseWhite(
  r: Recipe,
  ctx: Pick<CompileContext, 'isRaw' | 'asShot'>
): OpWhite | null {
  if (r.wb.mode === 'as-shot') return null
  const op =
    ctx.isRaw && ctx.asShot
      ? opFromAbsolute(r.wb.temperature, r.wb.tint / 3000, ctx.asShot)
      : opFromRelative(r.wb.temperature, r.wb.tint)
  if (Math.abs(op.kelvin - 6504) < 0.5 && Math.abs(op.tint) < 1e-6) return null
  return op
}

/** Whether this photo's temperature slider is absolute Kelvin. */
export function absoluteWb(ctx: Pick<CompileContext, 'isRaw' | 'asShot'>): boolean {
  return ctx.isRaw && ctx.asShot !== null
}

// ── Calibration ──────────────────────────────────────────────────────────────

/**
 * The calibration panel as a 3×3 matrix in linear Rec.2020: each primary's
 * chroma (its offset from its own mean) is turned about the grey axis by up to
 * ±20° and scaled by up to ±60%, then the three new primaries are rescaled so
 * white stays white.
 */
export function calibrationMatrix(c: Recipe['calibration']): [Rgb, Rgb, Rgb] | null {
  const shifts: [number, number][] = [
    [c.redHue, c.redSaturation],
    [c.greenHue, c.greenSaturation],
    [c.blueHue, c.blueSaturation]
  ]
  if (shifts.every(([h, s]) => h === 0 && s === 0)) return null
  const u = [1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)]
  const cols = shifts.map(([hue, sat], i) => {
    const p = [0, 0, 0]
    p[i] = 1
    const m = (p[0] + p[1] + p[2]) / 3
    const c0 = p.map((v) => v - m)
    const th = ((hue / 100) * 20 * Math.PI) / 180
    const cross = [
      u[1] * c0[2] - u[2] * c0[1],
      u[2] * c0[0] - u[0] * c0[2],
      u[0] * c0[1] - u[1] * c0[0]
    ]
    const k = 1 + (sat / 100) * 0.6
    return c0.map((v, j) => m + k * (v * Math.cos(th) + cross[j] * Math.sin(th)))
  })
  // M has the new primaries as columns; solve M·w = (1,1,1) for the weights.
  const M = [0, 1, 2].map((r) => [cols[0][r], cols[1][r], cols[2][r]])
  const det =
    M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) -
    M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) +
    M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0])
  if (Math.abs(det) < 1e-9) return null
  const solve = (col: number): number => {
    const A = M.map((row) => [...row])
    for (let r = 0; r < 3; r++) A[r][col] = 1
    const d =
      A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) -
      A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) +
      A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0])
    return d / det
  }
  const w = [solve(0), solve(1), solve(2)]
  const row = (r: number): Rgb => ({
    r: round4(M[r][0] * w[0]),
    g: round4(M[r][1] * w[1]),
    b: round4(M[r][2] * w[2])
  })
  return [row(0), row(1), row(2)]
}

// ── Geometry ─────────────────────────────────────────────────────────────────

/**
 * The largest centred crop with the canvas's own aspect that stays inside a
 * `w × h` picture rotated by `degrees` — the crop a straighten gets when the
 * user has not drawn one.
 */
export function autoCrop(degrees: number, w: number, h: number): CropRect {
  const th = (Math.abs(degrees) * Math.PI) / 180
  const c = Math.cos(th)
  const s = Math.sin(th)
  const k = Math.min(w / (w * c + h * s), h / (w * s + h * c))
  const shrink = k * 0.999 // stay clear of the half-pixel the engine checks
  return { x: (1 - shrink) / 2, y: (1 - shrink) / 2, width: shrink, height: shrink }
}

/** Whether every corner of `crop` (normalised canvas) lies inside the rotated `w × h` picture. */
export function cropFits(crop: CropRect, degrees: number, w: number, h: number): boolean {
  const th = (degrees * Math.PI) / 180
  const c = Math.cos(th)
  const s = Math.sin(th)
  const corners = [
    [crop.x, crop.y],
    [crop.x + crop.width, crop.y],
    [crop.x, crop.y + crop.height],
    [crop.x + crop.width, crop.y + crop.height]
  ]
  return corners.every(([nx, ny]) => {
    const qx = nx * w - w / 2
    const qy = ny * h - h / 2
    // Back into the picture by the inverse rotation.
    const px = c * qx + s * qy
    const py = -s * qx + c * qy
    return Math.abs(px) <= w / 2 + 0.5 && Math.abs(py) <= h / 2 + 0.5
  })
}

/** The user-oriented frame's size and orientation for a recipe. */
export function orientedFrame(
  r: Recipe,
  frameWidth: number,
  frameHeight: number
): { user: Orientation; width: number; height: number } {
  const user = userOrientation(r.geometry.quarterTurns, r.geometry.flipHorizontal)
  const swap = swapsAxes(user)
  return { user, width: swap ? frameHeight : frameWidth, height: swap ? frameWidth : frameHeight }
}

/**
 * Shrink `crop` about its centre (and pull it inside the canvas) until every
 * corner lies inside the picture rotated by `degrees`. A straighten changed
 * after a crop was drawn must never hand the engine a crop it will refuse.
 */
export function fitCrop(crop: CropRect, degrees: number, w: number, h: number): CropRect {
  const cx = Math.min(1, Math.max(0, crop.x + crop.width / 2))
  const cy = Math.min(1, Math.max(0, crop.y + crop.height / 2))
  const at = (k: number): CropRect => {
    const cw = Math.min(crop.width * k, 1)
    const ch = Math.min(crop.height * k, 1)
    const x = Math.min(Math.max(0, cx - cw / 2), 1 - cw)
    const y = Math.min(Math.max(0, cy - ch / 2), 1 - ch)
    return { x, y, width: cw, height: ch }
  }
  if (cropFits(at(1), degrees, w, h)) return at(1)
  let lo = 0
  let hi = 1
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2
    if (cropFits(at(mid), degrees, w, h)) lo = mid
    else hi = mid
  }
  return at(lo * 0.999)
}

/** The largest centred crop of `aspect` (width/height, in pixels) inside the rotated picture. */
export function aspectCrop(aspect: number, degrees: number, w: number, h: number): CropRect {
  const frameAspect = w / h
  const base =
    aspect > frameAspect
      ? { width: 1, height: frameAspect / aspect }
      : { width: aspect / frameAspect, height: 1 }
  return fitCrop({ x: (1 - base.width) / 2, y: (1 - base.height) / 2, ...base }, degrees, w, h)
}

/** The crop the engine gets: the user's (made to fit), the aspect's, or an auto-fit for a bare straighten. */
export function effectiveCrop(r: Recipe, w: number, h: number): CropRect | null {
  const { straighten, crop, aspect } = r.geometry
  if (crop) return fitCrop(crop, straighten, w, h)
  if (aspect !== null && aspect > 0) return aspectCrop(aspect, straighten, w, h)
  if (straighten !== 0) return autoCrop(straighten, w, h)
  return null
}

/**
 * A crop rectangle (normalised straightened canvas) as the vignette sees it:
 * centre and half size in normalised frame coordinates, and the rotation of
 * the rectangle within the frame (the opposite of the straighten).
 */
export function vignettePlacement(
  crop: CropRect | null,
  degrees: number,
  w: number,
  h: number
): { centre: { x: number; y: number }; half: { x: number; y: number }; rotation: number } {
  const c = crop ?? { x: 0, y: 0, width: 1, height: 1 }
  const qx = (c.x + c.width / 2) * w - w / 2
  const qy = (c.y + c.height / 2) * h - h / 2
  const th = (degrees * Math.PI) / 180
  const px = Math.cos(th) * qx + Math.sin(th) * qy
  const py = -Math.sin(th) * qx + Math.cos(th) * qy
  return {
    centre: { x: (px + w / 2) / w, y: (py + h / 2) / h },
    half: { x: c.width / 2, y: c.height / 2 },
    rotation: -degrees
  }
}

// ── Masks ────────────────────────────────────────────────────────────────────

/** How a range mask's smoothness becomes the key's blur: the render's buffer size decides the pixels. */
export interface KeyScale {
  /** The user-oriented frame at full resolution. */
  width: number
  height: number
  /** Buffer pixels per full-resolution pixel. */
  scale: number
}

/**
 * The key's blur radius in buffer pixels for a smoothness of 0…100: up to 1%
 * of the frame's shorter side, and never past what the engine accepts (under
 * half the buffer's shorter side).
 */
export function smoothnessRadius(smoothness: number, k: KeyScale): number {
  const short = Math.min(k.width, k.height) * k.scale
  const r = Math.round((clamp(smoothness, 0, 100) / 100) * 0.01 * short)
  return Math.max(0, Math.min(r, Math.floor(short / 2) - 1))
}

/**
 * A mask's Amount: every adjustment scaled by amount/100 (the tint's hue is
 * a direction, not a strength, and stays). The sliders' own clamps bound the
 * 200% end.
 */
export function scaleLocalAdjust(a: LocalAdjust, amount: number): LocalAdjust {
  const k = clamp(amount, 0, 200) / 100
  if (k === 1) return a
  const out = { ...a }
  for (const key of Object.keys(out) as (keyof LocalAdjust)[]) {
    if (key === 'tintHue') continue
    out[key] = a[key] * k
  }
  return out
}

function maskComponent(
  c: MaskComponentSetting,
  user: Orientation,
  brushPaths: Record<string, string>,
  keyScale: KeyScale
): MaskComponent | null {
  const base = {
    mode: c.mode,
    opacity: clamp(c.opacity / 100, 0, 1),
    invert: c.invert,
    feather: { radius: round4(clamp((c.feather / 100) * 0.1, 0, 0.5)), edge: 'Zero' as const }
  }
  switch (c.kind) {
    case 'brush':
    case 'linear':
    case 'radial': {
      // Painted and gradient planes alike: written to disk by the main process.
      const path = brushPaths[c.id]
      if (!path) return null
      return { ...base, shape: { Raster: { source: { Png: path }, resampler: 'Bilinear' } } }
    }
    case 'polygon': {
      if (c.points.length < 3) return null
      const points = c.points.map((p) => {
        const q = transformPoint(user, p)
        return { x: round4(clamp(q.x, 0, 1)), y: round4(clamp(q.y, 0, 1)) }
      })
      return { ...base, shape: { Polygon: { contours: [{ points }], fill_rule: 'NonZero' } } }
    }
    case 'range': {
      if (!c.hue && !c.saturation && !c.luma) return null
      return {
        ...base,
        shape: {
          Range: {
            hue: c.hue,
            saturation: c.saturation,
            luma: c.luma,
            blur_radius: smoothnessRadius(c.smoothness ?? 0, keyScale),
            invert: false
          }
        }
      }
    }
    default:
      // A kind this version cannot draw never reaches the engine.
      return null
  }
}

export function layerMask(
  l: LocalLayer,
  user: Orientation,
  brushPaths: Record<string, string>,
  keyScale: KeyScale = { width: 1, height: 1, scale: 0 }
): Mask | null {
  const components = l.components
    .map((c) => maskComponent(c, user, brushPaths, keyScale))
    .filter((c): c is MaskComponent => c !== null)
  if (components.length === 0) return null
  // The engine refuses a first component that is not Add (it would select nothing).
  if (components[0].mode !== 'Add') components[0] = { ...components[0], mode: 'Add' }
  const keys = components.some((c) => 'Range' in c.shape)
  return { components, invert: l.invert, space: keys ? LOOK_SPACE : null }
}

/**
 * `Normal` needs no space and costs nothing in the working space; every other
 * mode means what a compositing application means by it, which is a formula
 * on display-referred values (and Screen/Overlay/Soft/Hard Light are refused
 * in linear light anyway).
 */
function blendFor(mode: BlendMode): Blend {
  return mode === 'Normal' ? { mode, space: 'LinearWorking' } : { mode, space: LOOK_SPACE }
}

// ── The compiler ─────────────────────────────────────────────────────────────

function stage(space: GradeSpace, ops: GradeOp[]): { space: GradeSpace; ops: GradeOp[] }[] {
  return ops.length > 0 ? [{ space, ops }] : []
}

function sharpenOp(
  amount: number,
  radius: number,
  detail: number,
  masking: number,
  scale: number,
  notes: string[]
): GradeOp | null {
  if (amount <= 0) return null
  const px = radius * scale
  if (px < 0.5) {
    notes.push('Sharpening is shown at 1:1 only: at this zoom its radius is under half a pixel.')
    return null
  }
  return {
    Sharpen: {
      amount: round4(clamp(amount / 50, 0, 3)),
      radius: round4(clamp(px, 0.5, 3)),
      detail: clamp(detail / 100, 0, 1),
      masking: clamp(masking / 100, 0, 1)
    }
  }
}

function hslOp(r: Recipe): GradeOp | null {
  if (r.treatment === 'bw') {
    if (HSL_BANDS.every((b) => r.bwMix[b] === 0)) return null
    const bands = Object.fromEntries(
      HSL_BANDS.map((b) => [b, { hue: 0, saturation: 0, luminance: round4(r.bwMix[b] * 0.006) }])
    ) as unknown as HslBands
    return { HslBands: bands }
  }
  if (
    HSL_BANDS.every(
      (b) => r.hsl[b].hue === 0 && r.hsl[b].saturation === 0 && r.hsl[b].luminance === 0
    )
  )
    return null
  const bands = Object.fromEntries(
    HSL_BANDS.map((b) => [
      b,
      {
        hue: round4(clamp(r.hsl[b].hue * 0.3, -180, 180)),
        saturation: round4(clamp(r.hsl[b].saturation / 100, -1, 1)),
        luminance: round4(clamp(r.hsl[b].luminance * 0.006, -1, 1))
      }
    ])
  ) as unknown as HslBands
  return { HslBands: bands }
}

function colorGradeOp(cg: Recipe['colorGrade']): GradeOp | null {
  const wheels = [cg.shadows, cg.midtones, cg.highlights, cg.global]
  if (wheels.every((w) => w.saturation === 0 && w.luminance === 0)) return null
  const wheel = (w: Recipe['colorGrade']['shadows']): ColorGrade['shadows'] => ({
    hue: ((w.hue % 360) + 360) % 360,
    saturation: clamp(w.saturation / 100, 0, 1),
    luminance: clamp(w.luminance / 100, -1, 1)
  })
  return {
    ColorGrade: {
      shadows: wheel(cg.shadows),
      midtones: wheel(cg.midtones),
      highlights: wheel(cg.highlights),
      global: wheel(cg.global),
      blending: clamp(cg.blending / 100, 0, 1),
      balance: clamp(cg.balance / 100, -1, 1)
    }
  }
}

/** The base layer's two stages: physics, then the look. */
function baseStages(
  r: Recipe,
  ctx: CompileContext,
  crop: CropRect | null,
  oriented: { width: number; height: number },
  notes: string[]
): { space: GradeSpace; ops: GradeOp[] }[] {
  const linear: GradeOp[] = []
  const look: GradeOp[] = []
  const d = r.detail
  const denoise =
    d.noiseLuminance > 0 || d.noiseColor > 0
      ? ({
          Denoise: {
            luminance: clamp(d.noiseLuminance / 100, 0, 1),
            luminance_detail: clamp(d.noiseLuminanceDetail / 100, 0, 1),
            color: clamp(d.noiseColor / 100, 0, 1),
            color_detail: clamp(d.noiseColorDetail / 100, 0, 1)
          }
        } as GradeOp)
      : null

  // ── linear light ──
  // Sensor noise is closest to additive and Gaussian before anything else
  // touches it, so a RAW is denoised first.
  if (denoise && ctx.isRaw) linear.push(denoise)
  const wb = baseWhite(r, ctx)
  if (wb)
    linear.push({ WhiteBalance: { temperature_kelvin: round4(wb.kelvin), tint: round4(wb.tint) } })
  const mix = calibrationMatrix(r.calibration)
  if (mix) linear.push({ ChannelMixer: { red: mix[0], green: mix[1], blue: mix[2] } })
  if (r.basic.exposure !== 0) {
    linear.push({ Primary: primary({ exposure: round4(r.basic.exposure), contrast_pivot: 0.18 }) })
    if (r.basic.exposure > 0) {
      linear.push({ Lut: { lut: { Cube: shoulderCube(r.basic.exposure) }, amount: 1 } })
    }
  }

  // ── the look ──
  if (denoise && !ctx.isRaw) look.push(denoise)
  // The engine's detail and effect constants are set for display-referred
  // values, so dehaze runs at the head of the look stage.
  if (r.presence.dehaze !== 0) {
    look.push({ Dehaze: { amount: clamp(r.presence.dehaze / 100, -1, 1), radius: 0.01 } })
  }
  switch (r.profile.kind) {
    case 'standard':
      look.push(curvesOp({ master: curve(STANDARD_CURVE) }))
      break
    case 'vivid':
      look.push(curvesOp({ master: curve(VIVID_CURVE) }))
      look.push({ Vibrance: { amount: 0.15, skin_protection: 0.7 } })
      break
    case 'monochrome':
      look.push(curvesOp({ master: curve(STANDARD_CURVE) }))
      break
    case 'lut':
      if (r.profileAmount > 0) {
        look.push({
          Lut: { lut: { Path: r.profile.path }, amount: clamp(r.profileAmount / 100, 0, 1) }
        })
      }
      break
    case 'neutral':
      break
  }
  const b = r.basic
  if (b.highlights || b.shadows || b.whites || b.blacks) {
    look.push({
      Tone: {
        highlights: clamp(b.highlights / 100, -1, 1),
        shadows: clamp(b.shadows / 100, -1, 1),
        whites: clamp(b.whites / 100, -1, 1),
        blacks: clamp(b.blacks / 100, -1, 1)
      }
    })
  }
  if (b.contrast !== 0) {
    look.push({ Primary: primary({ contrast: round4(1 + (b.contrast / 100) * 0.6) }) })
  }
  const p = r.presence
  if (p.texture !== 0) {
    look.push({
      LocalContrast: {
        amount: clamp((p.texture / 100) * 0.8, -1, 1),
        radius: 0.0015,
        midtones: 0.2
      }
    })
  }
  if (p.clarity !== 0) {
    look.push({
      LocalContrast: { amount: clamp(p.clarity / 100, -1, 1), radius: 0.012, midtones: 0.8 }
    })
  }
  const para = parametricCurve(r.toneCurve)
  if (para) look.push(curvesOp({ master: curve(para) }))
  const tc = r.toneCurve
  const pc: Partial<Curves> = {}
  if (!isIdentityCurve(tc.master)) pc.master = curve(tc.master)
  if (!isIdentityCurve(tc.red)) pc.red = curve(tc.red)
  if (!isIdentityCurve(tc.green)) pc.green = curve(tc.green)
  if (!isIdentityCurve(tc.blue)) pc.blue = curve(tc.blue)
  if (Object.keys(pc).length > 0) look.push(curvesOp(pc))
  const bw = r.treatment === 'bw' || r.profile.kind === 'monochrome'
  const hsl = hslOp(bw ? { ...r, treatment: 'bw' } : r)
  if (hsl) look.push(hsl)
  if (!bw && p.vibrance !== 0) {
    look.push({ Vibrance: { amount: clamp(p.vibrance / 100, -1, 1), skin_protection: 0.6 } })
  }
  if (bw) look.push({ Primary: primary({ saturation: 0 }) })
  else if (p.saturation !== 0)
    look.push({ Primary: primary({ saturation: round4(1 + p.saturation / 100) }) })
  const cg = colorGradeOp(r.colorGrade)
  if (cg) look.push(cg)
  if (r.calibration.shadowsTint !== 0) {
    const a = round4((r.calibration.shadowsTint / 100) * 0.02)
    look.push({ Primary: primary({ lift: { r: a / 2, g: -a, b: a / 2 } }) })
  }
  const sharpen = sharpenOp(
    d.sharpenAmount,
    d.sharpenRadius,
    d.sharpenDetail,
    d.sharpenMasking,
    ctx.scale,
    notes
  )
  if (sharpen) look.push(sharpen)
  const e = r.effects
  if (e.vignetteAmount !== 0) {
    const v = vignettePlacement(crop, r.geometry.straighten, oriented.width, oriented.height)
    look.push({
      Vignette: {
        amount: clamp(e.vignetteAmount / 100, -1, 1),
        midpoint: clamp(e.vignetteMidpoint / 100, 0, 1),
        roundness: clamp(e.vignetteRoundness / 100, -1, 1),
        feather: clamp(e.vignetteFeather / 100, 0, 1),
        highlights: clamp(e.vignetteHighlights / 100, 0, 1),
        centre: { x: round4(v.centre.x), y: round4(v.centre.y) },
        half_size: { x: round4(Math.max(v.half.x, 1e-4)), y: round4(Math.max(v.half.y, 1e-4)) },
        rotation_degrees: clamp(v.rotation, -45, 45)
      }
    })
  }
  if (e.grainAmount > 0) {
    look.push({
      Grain: {
        amount: clamp(e.grainAmount / 100, 0, 1),
        size: round4(0.0004 + (clamp(e.grainSize, 0, 100) / 100) * 0.004),
        roughness: clamp(e.grainRoughness / 100, 0, 1),
        seed: ctx.seed
      }
    })
  }
  return [...stage('LinearWorking', linear), ...stage(LOOK_SPACE, look)]
}

/** A local layer's stages from its sliders. */
function localStages(
  l: LocalLayer,
  scale: number,
  notes: string[]
): { space: GradeSpace; ops: GradeOp[] }[] {
  const a = l.adjust
  const linear: GradeOp[] = []
  const look: GradeOp[] = []
  if (a.temperature !== 0 || a.tint !== 0) {
    const op = opFromRelative(a.temperature, a.tint)
    linear.push({ WhiteBalance: { temperature_kelvin: round4(op.kelvin), tint: round4(op.tint) } })
  }
  if (a.exposure !== 0)
    linear.push({ Primary: primary({ exposure: a.exposure, contrast_pivot: 0.18 }) })
  if (a.dehaze !== 0) look.push({ Dehaze: { amount: clamp(a.dehaze / 100, -1, 1), radius: 0.01 } })
  if (a.noise > 0) {
    look.push({
      Denoise: {
        luminance: clamp(a.noise / 100, 0, 1),
        luminance_detail: 0.5,
        color: 0,
        color_detail: 0.5
      }
    })
  }
  if (a.highlights || a.shadows || a.whites || a.blacks) {
    look.push({
      Tone: {
        highlights: clamp(a.highlights / 100, -1, 1),
        shadows: clamp(a.shadows / 100, -1, 1),
        whites: clamp(a.whites / 100, -1, 1),
        blacks: clamp(a.blacks / 100, -1, 1)
      }
    })
  }
  if (a.contrast !== 0 || a.saturation !== 0 || a.hue !== 0) {
    look.push({
      Primary: primary({
        contrast: round4(1 + (a.contrast / 100) * 0.6),
        saturation: round4(Math.max(0, 1 + a.saturation / 100)),
        hue_shift: round4(a.hue * 0.6)
      })
    })
  }
  if (a.texture !== 0) {
    look.push({
      LocalContrast: {
        amount: clamp((a.texture / 100) * 0.8, -1, 1),
        radius: 0.0015,
        midtones: 0.2
      }
    })
  }
  if (a.clarity !== 0) {
    look.push({
      LocalContrast: { amount: clamp(a.clarity / 100, -1, 1), radius: 0.012, midtones: 0.8 }
    })
  }
  if (a.tintAmount > 0) {
    const w = {
      hue: ((a.tintHue % 360) + 360) % 360,
      saturation: clamp(a.tintAmount / 100, 0, 1),
      luminance: 0
    }
    const zero = { hue: 0, saturation: 0, luminance: 0 }
    look.push({
      ColorGrade: {
        shadows: zero,
        midtones: zero,
        highlights: zero,
        global: w,
        blending: 0.5,
        balance: 0
      }
    })
  }
  if (a.sharpness > 0) {
    const s = sharpenOp(a.sharpness, 1, 25, 0, scale, notes)
    if (s) look.push(s)
  }
  return [...stage('LinearWorking', linear), ...stage(LOOK_SPACE, look)]
}

/**
 * Compile a recipe. `grade` is null when nothing moves a pixel, so an
 * untouched photo takes the engine's fast path.
 */
export function compile(r: Recipe, ctx: CompileContext): Compiled {
  const notes: string[] = []
  const oriented = orientedFrame(r, ctx.frameWidth, ctx.frameHeight)
  const crop = effectiveCrop(r, oriented.width, oriented.height)

  const layers: GradeLayer[] = []
  const layerIndex: Record<string, number> = {}
  const base = baseStages(r, ctx, crop, oriented, notes)
  if (base.length > 0) {
    layers.push({
      name: 'base',
      enabled: true,
      opacity: 1,
      mask: null,
      blend: { mode: 'Normal', space: 'LinearWorking' },
      stages: base
    })
  }
  const keyScale: KeyScale = { width: oriented.width, height: oriented.height, scale: ctx.scale }
  for (const l of r.layers) {
    const mask = layerMask(l, oriented.user, ctx.brushPaths, keyScale)
    if (!mask) continue
    let stages = localStages(
      { ...l, adjust: scaleLocalAdjust(l.adjust, l.amount ?? 100) },
      ctx.scale,
      notes
    )
    // A layer with nothing to do is still a valid place to look at its mask.
    if (stages.length === 0)
      stages = [{ space: 'LinearWorking', ops: [{ Primary: primary({ contrast_pivot: 0.18 }) }] }]
    layerIndex[l.id] = layers.length
    layers.push({
      name: l.name,
      enabled: l.enabled,
      opacity: clamp(l.opacity / 100, 0, 1),
      mask,
      blend: blendFor(l.blend),
      stages
    })
  }
  for (const c of r.custom) {
    if (!c.layer || typeof c.layer !== 'object') continue
    layers.push({
      ...(c.layer as GradeLayer),
      enabled: c.enabled && (c.layer as GradeLayer).enabled !== false
    })
  }

  const orientation = compose(ctx.sourceOrientation, oriented.user)
  const straighten = ctx.applyCrop ? r.geometry.straighten : 0
  const shownCrop = ctx.applyCrop ? crop : null
  const framing: Framing | null =
    orientation === 'Normal' && straighten === 0 && !shownCrop
      ? null
      : {
          orientation,
          rotate_degrees: round4(straighten),
          rotate_resampler: 'Lanczos3',
          crop: shownCrop
            ? {
                x: round4(shownCrop.x),
                y: round4(shownCrop.y),
                width: round4(Math.min(shownCrop.width, 1 - round4(shownCrop.x))),
                height: round4(Math.min(shownCrop.height, 1 - round4(shownCrop.y)))
              }
            : null
        }

  return {
    grade: layers.length > 0 ? { layers } : null,
    framing,
    layerIndex,
    notes,
    orientedWidth: oriented.width,
    orientedHeight: oriented.height,
    crop
  }
}
