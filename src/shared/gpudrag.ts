/**
 * The GPU drag path's decisions (engine 0.19.2, Phase A §4.3 and §4.4),
 * pure, for tests/gpudrag.test.ts. Main does the calls (main/gpudrag.ts and
 * render.ts); everything here only says what to ask for and when.
 *
 * The shape of it: once per app a GPU session; once per open photo the
 * grade's input rendered on the CPU and uploaded as a frame; each drag frame
 * graded on the GPU from that frame. The release, the settled picture and
 * every export stay on the CPU, from the file, as before. The engine never
 * falls back by itself: a drag it refuses is Playroom's signal to render
 * that drag on the CPU, and `gpuRefusal` saves asking for the grades it is
 * known to refuse.
 */

import {
  opKind,
  type AdjustmentSmoothing,
  type ColorPolicy,
  type ConvertRequest,
  type Framing,
  type Grade,
  type GradeOp,
  type GradeSpace,
  type GpuSessionSpec,
  type InputFormat,
  type LensCorrection,
  type Limits,
  type Measure,
  type MetadataPolicy,
  type Region,
  type Retouch
} from './engine-types'
import { hash32 } from './recipe'

/** The index setting that turns GPU dragging off (Preferences); missing is on. */
export const GPU_DRAG_SETTING = 'develop.gpuDrag'

/** Stored value → on: only an explicit `false` turns it off (default on where the GPU is). */
export function gpuDragOn(stored: unknown): boolean {
  return stored !== false
}

/**
 * The GPU session for this platform (Phase A §4.3): Metal on macOS, Direct3D
 * 12 on Windows, the high-performance adapter. Elsewhere the addon has no
 * GPU path: null.
 */
export function gpuBackend(platform: string): GpuSessionSpec | null {
  if (platform === 'darwin') return { backend: 'Metal', adapter: 'HighPerformance' }
  if (platform === 'win32') return { backend: 'Dx12', adapter: 'HighPerformance' }
  return null
}

/** 8 GB and a little over what macOS reports for it. */
const EIGHT_GB_MB = 8 * 1024 + 512

/**
 * The 8 GB / M1 Mac (Phase A §4.3, §3.2): a frame is 131–175 MB of GPU
 * memory (+78.7 MB with a local-Laplacian base), shared with the system on
 * Apple silicon, so only one is kept open at a time; and until the closing
 * run measures the M1, Tone drags there without its base. The plain M1
 * chip (not Pro, Max or Ultra), or any Mac with 8 GB or less.
 */
export function constrainedMac(platform: string, cpuModel: string, totalMb: number): boolean {
  if (platform !== 'darwin') return false
  return /^Apple M1$/.test(cpuModel.trim()) || totalMb <= EIGHT_GB_MB
}

/** What the GPU grades in this release (Phase A §4.3); every other op is refused. */
const GPU_OPS = new Set<string>(['Primary', 'Tone', 'HslBands', 'Dehaze'])

/** A stage space the GPU refuses: an HDR signal, or one through an ICC profile. */
function refusedSpace(space: GradeSpace): boolean {
  if (space === 'LinearWorking') return false
  const s = space.Encoded.space
  return typeof s === 'object' || s === 'Rec2100Pq' || s === 'Rec2100Hlg'
}

function smoothed(s: AdjustmentSmoothing | null | undefined): boolean {
  return !!s && s.strength > 0
}

/** Where in an op the GPU refuses it, as a field path below the op, or null. */
function refusedIn(op: GradeOp): string | null {
  const kind = opKind(op)
  if (!GPU_OPS.has(kind)) return ''
  if ('Tone' in op) {
    if (op.Tone.base && 'Guided' in op.Tone.base) return '.Tone.base'
    if (smoothed(op.Tone.smoothing)) return '.Tone.smoothing'
  }
  if ('HslBands' in op && smoothed(op.HslBands.smoothing)) return '.HslBands.smoothing'
  if ('Dehaze' in op && smoothed(op.Dehaze.smoothing)) return '.Dehaze.smoothing'
  return null
}

/**
 * The first field of `grade` the GPU drag path is known to refuse (Phase A
 * §4.3's list), or null when it should take it: a layer's mask, an opacity
 * other than 1, a blend other than Normal, an HDR or ICC stage, Tone's
 * Guided base, any smoothing above 0, and every op but Primary, Tone,
 * HslBands and Dehaze. Asking first would only cost a round trip to be told
 * so; the engine's own refusal still decides anything this misses.
 * A disabled layer is left to the engine (it is not graded).
 */
export function gpuRefusal(grade: Grade | null): string | null {
  if (!grade) return null
  for (const [i, l] of grade.layers.entries()) {
    if (!l.enabled) continue
    const at = `grade.layers[${i}]`
    if (l.mask) return `${at}.mask`
    if (l.opacity !== 1) return `${at}.opacity`
    if (l.blend.mode !== 'Normal') return `${at}.blend`
    for (const [s, stage] of l.stages.entries()) {
      if (refusedSpace(stage.space)) return `${at}.stages[${s}].space`
      for (const [o, op] of stage.ops.entries()) {
        const why = refusedIn(op)
        if (why !== null) return `${at}.stages[${s}].ops[${o}]${why}`
      }
    }
  }
  return null
}

/**
 * A grade with its values left out: which layers, masks, blends, spaces and
 * ops, and the kind of Tone's base. A slider drag changes values, not this,
 * so a drag the engine refused once is not asked of the GPU again until the
 * release (Phase A §4.3: the refusal is the signal; remembered cheaply).
 */
export function gradeShape(grade: Grade | null): string {
  if (!grade) return 'none'
  return JSON.stringify(
    grade.layers.map((l) => [
      l.enabled,
      l.mask !== null,
      l.opacity === 1,
      l.blend.mode,
      l.stages.map((s) => [
        typeof s.space === 'string' ? s.space : JSON.stringify(s.space),
        s.ops.map((op) => {
          const kind = opKind(op)
          if ('Tone' in op) return `${kind}:${op.Tone.base ? Object.keys(op.Tone.base)[0] : '-'}`
          return kind
        })
      ])
    ])
  )
}

/** Whether a grade runs an op that measures the whole photo first (Dehaze, Denoise: Phase A §4.4). */
export function measuresPhoto(grade: Grade | null): boolean {
  const walk = (ops: GradeOp[]): boolean =>
    ops.some((op) => 'Dehaze' in op || 'Denoise' in op || ('Masked' in op && walk(op.Masked.ops)))
  return !!grade?.layers.some((l) => l.enabled && l.stages.some((s) => walk(s.ops)))
}

/** The metadata of both GPU requests: none but the ICC profile. */
const ICC_ONLY: MetadataPolicy = { exif: false, icc: true, xmp: false, iptc: false }

/** What the grade-input render reads, and the display it is for. */
export interface GradeInputParts {
  /** The full proxy (the frame the drags are of: Phase A §4.3 "upload at full proxy size"). */
  path: string
  input: InputFormat
  /** The draft's own colour (the display space the drags name). */
  color: ColorPolicy
  /** What runs before the grade, live (the prepared proxies may carry them already). */
  lens: LensCorrection | null
  retouch: Retouch | null
  threads: number
  limits: Limits | null
}

/**
 * The grade's input as the GPU frame is uploaded from (Phase A §4.3, its
 * exact request): everything before the grade (the RAW develop, the lens,
 * retouch, the pixel steps already in the proxy), rendered on the CPU at the
 * frame's full size into F16 pixels, with no grade, framing, resize, region,
 * overlays, output sharpening, SDR rendition or measuring. Not a draft: a
 * Full HDR draft is the master's output, and grading it again would apply
 * the grade on top of the master.
 */
export function gradeInputRequest(p: GradeInputParts): ConvertRequest {
  return {
    source: { Path: p.path },
    sink: 'Bytes',
    input: p.input,
    resize: 'None',
    resampler: 'Lanczos3',
    pixel: { depth: 'F32', channels: null },
    encode: { Pixels: { sample: 'F16' } },
    metadata: ICC_ONLY,
    color: p.color,
    linear_resample: false,
    raw: null,
    upscaler: null,
    grade: null,
    dither: 'None',
    hdr: null,
    sdr: null,
    gain_map: null,
    threads: p.threads,
    framing: null,
    region: null,
    inspect: 'GradeInput',
    overlays: null,
    enhance: null,
    lens: p.lens,
    retouch: p.retouch,
    output_sharpen: null,
    limits: p.limits,
    measure: null,
    grade_device: 'Cpu'
  }
}

/**
 * What names an upload: a new one is needed exactly when this changes, i.e.
 * when something BEFORE the grade does (the proxy the pixel steps or a lens
 * bake made, a live lens or retouch, the display space). A grade edit never
 * changes it (Phase A §4.3).
 */
export function inputKey(request: ConvertRequest): string {
  return hash32(JSON.stringify(request)).toString(16)
}

/** One drag frame's own parts. */
export interface DragParts {
  grade: Grade | null
  /** The display space, as the CPU draft's (`ConvertTo` Display P3, or Full HDR's master). */
  color: ColorPolicy
  /** Full HDR: F16 pixels (F32 working), as an HDR draft is; else 8-bit. */
  hdr: boolean
  /** A crop as a region of the frame (`dragRegion`), or the whole frame. */
  region: Region | null
  measure: Measure | null
  threads: number
}

/**
 * A drag frame on the GPU (Phase A §4.3, step 3): from the uploaded frame,
 * so everything before the grade is null here (it is in the frame), no
 * framing and no resize, a display `color`, RGBA pixels for the window.
 */
export function gpuDragRequest(p: DragParts): ConvertRequest {
  return {
    source: { GpuFrame: null },
    sink: 'Bytes',
    input: 'GpuFrame',
    resize: 'None',
    resampler: 'Lanczos3',
    pixel: { depth: p.hdr ? 'F32' : 'Eight', channels: 4 },
    encode: { Pixels: { sample: p.hdr ? 'F16' : 'U8' } },
    metadata: ICC_ONLY,
    color: p.color,
    linear_resample: false,
    raw: null,
    upscaler: null,
    grade: p.grade,
    dither: 'None',
    hdr: null,
    sdr: null,
    gain_map: null,
    threads: p.threads,
    framing: null,
    region: p.region,
    inspect: null,
    overlays: null,
    enhance: null,
    lens: null,
    retouch: null,
    output_sharpen: null,
    limits: null,
    measure: p.measure,
    grade_device: 'Gpu'
  }
}

/**
 * The picture's framing on a GPU drag, which takes none: no framing is the
 * whole frame (null); a crop alone (upright, not straightened or warped) is
 * a region of the frame, which a drag may have (§4.3), and since the grade
 * runs before the framing that is the cropped render's own pixels; anything
 * else (a turn, a straighten, an Upright) the frame can't show, so the drag
 * stays on the CPU. `margin` is the grade's reach (`regionReach`).
 */
export function dragRegion(
  framing: Framing | null,
  width: number,
  height: number,
  margin: number
): Region | null | 'cpu' {
  if (!framing) return null
  if (framing.orientation !== 'Normal' || framing.rotate_degrees !== 0 || framing.transform)
    return 'cpu'
  const c = framing.crop
  if (!c) return null
  const x = Math.max(0, Math.min(width - 1, Math.round(c.x * width)))
  const y = Math.max(0, Math.min(height - 1, Math.round(c.y * height)))
  return {
    x,
    y,
    width: Math.max(1, Math.min(width - x, Math.round(c.width * width))),
    height: Math.max(1, Math.min(height - y, Math.round(c.height * height))),
    margin: Math.max(0, Math.ceil(margin))
  }
}

/**
 * What a failed GPU drag (or a drag given `held`) means:
 * - `held`: the held measurements don't fit (a different op, size or
 *   setting: refused by `held`, §4.4): drop them, render once without;
 * - `measure`: the GPU path won't measure its output: drag without it;
 * - `stale`: the frame or the host is gone (a restart): upload again;
 * - `refused`: anything else, the engine's refusal of this drag (§4.3):
 *   render it on the CPU, as today. Never the user's error.
 */
export type DragVerdict = 'held' | 'measure' | 'stale' | 'refused'

export function dragVerdict(err: { code?: string; field?: string }): DragVerdict {
  const f = err.field ?? ''
  if (f === 'held' || f.startsWith('held.')) return 'held'
  if (f === 'measure' || f.startsWith('measure.')) return 'measure'
  if (err.code === 'Stale' || err.code === 'EngineCrashed' || err.code === 'EngineUnavailable')
    return 'stale'
  return 'refused'
}

/**
 * What a held measurement is of (§4.4: drop it when the photo, the framing
 * or the size changes): where the drag reads its pixels (the GPU frame's
 * input, or the CPU draft's proxy), and the framing or region it shows.
 * A held one is passed only to a render of the same key.
 */
export function heldKey(from: string, framing: unknown): string {
  return JSON.stringify([from, framing])
}
