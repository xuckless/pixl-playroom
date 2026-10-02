/**
 * Smart looks: a look that carries instructions as well as sliders. "Mask
 * the sky and darken it", "mask skin and warm it", "mask this colour range",
 * "mask the car", "AI denoise inside the subject". Applied, they become
 * ordinary masks and pixel steps, editable like any others.
 *
 * What each target needs, and whether this build has it, is `SmartReadiness`
 * (from the engine and the installed models); `planSmart` turns a look's
 * instructions into what to do on one photo: masks made at once (ranges,
 * gradients), the AI work in order (every segment before a step scoped to
 * its mask, since a denoise freezes its mask when it starts), what the user
 * is asked to point at, what is skipped and why, and how long it will take.
 * Nothing is faked: a target this build cannot do is skipped and said so.
 *
 * Pure: shared by the catalog, the look file reader and the runner.
 */
import type { KeyBand, MaskMode } from '../engine-types'
import { gradientPlaneSize } from '../gradients'
import type { PixelStep } from '../pixels'
import {
  newId,
  newLocalLayer,
  neutralSettings,
  type LocalLayer,
  type MaskComponentSetting,
  type LayerSettings
} from '../recipe'
import { rangeOf } from './ranges'

export type PersonPart = 'skin' | 'face' | 'hair' | 'eyes' | 'lips' | 'teeth' | 'clothes' | 'body'

export const PERSON_PARTS: PersonPart[] = [
  'skin',
  'face',
  'hair',
  'eyes',
  'lips',
  'teeth',
  'clothes',
  'body'
]

/** A point in the frame, 0…1 on each axis. */
export interface FramePoint {
  x: number
  y: number
}

/** What a mask part selects. Gradients are frame-relative, so they fit any photo. */
export type MaskTarget =
  | {
      kind: 'range'
      hue?: KeyBand
      saturation?: KeyBand
      luma?: KeyBand
      /** 0…100 */
      smoothness?: number
    }
  | { kind: 'linear'; start: FramePoint; end: FramePoint }
  | {
      kind: 'radial'
      centre: FramePoint
      /** Semi-axes as fractions of the frame's shorter side. */
      radiusX: number
      radiusY: number
      angle?: number
      /** 0…100: the outer share of the radius that fades. */
      softness?: number
    }
  | { kind: 'subject' }
  | { kind: 'background' }
  | { kind: 'sky' }
  | { kind: 'person'; part: PersonPart }
  /** Found by label ("car") by the detector, else pointed at by the user. */
  | { kind: 'object'; label: string }

export interface MaskPart {
  target: MaskTarget
  /** How it joins the parts before it (the first part adds). */
  mode: MaskMode
  invert?: boolean
}

export interface MaskInstruction {
  /** Within the look: what a step's `scope` names. */
  id: string
  /** The mask's name in the Masks panel ("Sky"). */
  name: string
  parts: MaskPart[]
  /** 0…100, for the parts that are not a model's (a range, a gradient). */
  feather?: number
  /** What the mask does, as dotted paths into a mask's settings ("basic.exposure": -0.4). */
  adjust: Record<string, number>
  /** 0…200, the mask's Amount (100 when unset). */
  amount?: number
  /** Without it the look is not itself: it is listed as not working on this build. */
  required?: boolean
}

/** `auto` takes the quickest model this build has (NAFNet, else DRUNet). */
export type SmartDenoiseModel = 'auto' | 'drunet' | 'nafnet'

export type StepInstruction =
  | {
      kind: 'denoise'
      model: SmartDenoiseModel
      /** 1…100: the step's opacity. */
      strength: number
      /** A mask's `id`: denoise inside it only. */
      scope?: string
    }
  | { kind: 'deblur'; strength: number; scope?: string }

export interface SmartPart {
  masks: MaskInstruction[]
  steps: StepInstruction[]
}

// ── What this build can do ──────────────────────────────────────────────────

export type Readiness = 'ready' | 'needs-model' | 'needs-engine'

/** Everything a smart look can ask for, by what it needs. */
export type SmartKey =
  | 'range'
  | 'linear'
  | 'radial'
  | 'subject'
  | 'background'
  | 'sky'
  | 'person'
  /** An object by label: the detector and SAM2. */
  | 'object'
  /** An object the user points at (a click or a box): SAM2 alone. */
  | 'pick'
  | 'drunet'
  | 'nafnet'
  | 'deblur'

export type SmartReadiness = Record<SmartKey, Readiness>

/** What the main process knows about this build: models it can run, and what the engine has. */
export interface SmartBuild {
  /** The engine runs models at all. */
  models: boolean
  /** The subject model (U²-Net) is installed. */
  subjectModel: boolean
  /** The DRUNet denoise model is installed. */
  drunetModel: boolean
  /** Enhance (NAFNet deblur) is available. */
  enhance: boolean
  /** In the engine release after 0.15: E28 sky, E30 people and SAM2, E45 detector, NAFNet denoise. */
  engine: { sky: boolean; people: boolean; sam2: boolean; detector: boolean; nafnet: boolean }
}

export function smartReadiness(b: SmartBuild): SmartReadiness {
  const model = (installed: boolean): Readiness =>
    !b.models ? 'needs-engine' : installed ? 'ready' : 'needs-model'
  const engine = (has: boolean): Readiness => (b.models && has ? 'ready' : 'needs-engine')
  return {
    range: 'ready',
    linear: 'ready',
    radial: 'ready',
    subject: model(b.subjectModel),
    background: model(b.subjectModel),
    sky: engine(b.engine.sky),
    person: engine(b.engine.people),
    object: engine(b.engine.detector && b.engine.sam2),
    pick: engine(b.engine.sam2),
    drunet: model(b.drunetModel),
    nafnet: engine(b.engine.nafnet),
    deblur: b.enhance ? 'ready' : 'needs-engine'
  }
}

/** Why something cannot run, for the browser and the Applied bar. */
export function whyNot(r: Readiness): string {
  return r === 'needs-model'
    ? 'needs a model: download it in Settings → AI models'
    : 'needs the next engine update'
}

const IMMEDIATE = new Set<MaskTarget['kind']>(['range', 'linear', 'radial'])

/** A part's own need; an object falls back to the user pointing at it. */
function partNeed(t: MaskTarget, r: SmartReadiness): { key: SmartKey; ready: boolean } {
  if (t.kind === 'object') {
    if (r.object === 'ready') return { key: 'object', ready: true }
    return { key: 'pick', ready: r.pick === 'ready' }
  }
  return { key: t.kind, ready: r[t.kind] === 'ready' }
}

function denoiseModel(m: SmartDenoiseModel, r: SmartReadiness): 'drunet' | 'nafnet' | null {
  if (m === 'nafnet') return r.nafnet === 'ready' ? 'nafnet' : null
  if (m === 'drunet') return r.drunet === 'ready' ? 'drunet' : null
  return r.nafnet === 'ready' ? 'nafnet' : r.drunet === 'ready' ? 'drunet' : null
}

/** What a smart look needs that this build lacks: why the browser marks it, or nothing. */
export function smartBlockers(s: SmartPart, r: SmartReadiness): string[] {
  const out: string[] = []
  for (const m of s.masks) {
    if (!m.required) continue
    for (const p of m.parts) {
      const need = partNeed(p.target, r)
      if (!need.ready) out.push(`${m.name}: ${whyNot(r[need.key])}`)
    }
  }
  return out
}

// ── The plan ────────────────────────────────────────────────────────────────

/** One thing to do, in order. A mask with any model's part is built part by part, then enabled. */
export type PlanOp =
  | { kind: 'component'; layerId: string; mask: string; component: MaskComponentSetting }
  | {
      kind: 'segment'
      layerId: string
      mask: string
      target: 'subject' | 'background' | 'sky'
      mode: MaskMode
      invert: boolean
    }
  | {
      kind: 'person'
      layerId: string
      mask: string
      part: PersonPart
      mode: MaskMode
      invert: boolean
    }
  | {
      kind: 'object'
      layerId: string
      mask: string
      label: string
      mode: MaskMode
      invert: boolean
      /** False: no detector here, the user points at it (SAM2 alone). */
      detect: boolean
    }
  | { kind: 'enable'; layerId: string; mask: string }
  | { kind: 'denoise'; model: 'drunet' | 'nafnet'; strength: number; layerId: string | null }
  | { kind: 'deblur'; strength: number; layerId: string | null }

export interface SmartPlan {
  /** New masks, in order: a mask of ranges and gradients whole; one waiting on a model off and empty. */
  layers: LocalLayer[]
  ops: PlanOp[]
  /** How many objects the user will be asked to point at. */
  picks: number
  skipped: { name: string; why: string }[]
  /** Every required mask can be made. */
  complete: boolean
  /** The model work's expected time, ms (what the user points at not counted). */
  etaMs: number
  /** What the look does on this photo, in words ("Sky mask", "AI denoise (DRUNet)"). */
  summary: string[]
}

/** How long model work takes when nothing has been measured here yet. */
export const SMART_RATES = {
  /** Per run, whatever the photo's size (the models work on a proxy). */
  segmentMs: 1500,
  personMs: 2500,
  detectMs: 900,
  sam2Ms: 1200,
  /** Per megapixel of the full-resolution step. */
  drunetMsPerMp: 9000,
  nafnetMsPerMp: 3000,
  deblurMsPerMp: 6000
}

export type SmartRates = typeof SMART_RATES

export interface SmartPhoto {
  frameWidth: number
  frameHeight: number
  /** What this machine measured (the denoise job's remembered rates), over the defaults. */
  rates?: Partial<SmartRates>
}

/** Mask settings a smart look may set: colour and tone, the mask's white, never its noise or lens. */
const ADJUST_ROOTS = ['basic', 'presence', 'toneCurve', 'hsl', 'colorGrade']
const ADJUST_EXTRA: Record<string, [number, number]> = {
  'basic.exposure': [-5, 5],
  'wb.temperature': [-100, 100],
  'wb.tint': [-100, 100]
}

/** The range a mask's adjustment must be in, or null when a look may not set it. */
export function adjustRange(path: string): [number, number] | null {
  if (ADJUST_EXTRA[path]) return ADJUST_EXTRA[path]
  const parts = path.split('.')
  if (!ADJUST_ROOTS.includes(parts[0])) return null
  return rangeOf(parts)
}

/** `settings` with `adjust` laid on (clamped; what a look may not set is left out). */
export function applyAdjust(settings: LayerSettings, adjust: Record<string, number>): void {
  for (const [path, value] of Object.entries(adjust)) {
    const range = adjustRange(path)
    if (!range || !Number.isFinite(value)) continue
    const keys = path.split('.')
    let node: Record<string, unknown> = settings as unknown as Record<string, unknown>
    for (const k of keys.slice(0, -1)) {
      const next = node[k]
      if (typeof next !== 'object' || next === null) {
        node = {}
        break
      }
      node = next as Record<string, unknown>
    }
    const last = keys[keys.length - 1]
    if (typeof node[last] !== 'number') continue
    node[last] = Math.min(range[1], Math.max(range[0], value))
    // A mask's white is relative, and only counts once it is custom.
    if (keys[0] === 'wb') settings.wb.mode = 'custom'
  }
}

function componentOf(
  part: MaskPart,
  feather: number,
  plane: { width: number; height: number }
): MaskComponentSetting {
  const base = {
    id: newId(),
    mode: part.mode,
    opacity: 100,
    invert: part.invert ?? false,
    feather
  }
  const t = part.target
  if (t.kind === 'range')
    return {
      ...base,
      kind: 'range',
      hue: t.hue ?? null,
      saturation: t.saturation ?? null,
      luma: t.luma ?? null,
      smoothness: t.smoothness ?? 0
    }
  if (t.kind === 'linear')
    return { ...base, kind: 'linear', start: { ...t.start }, end: { ...t.end }, ...plane }
  if (t.kind === 'radial')
    return {
      ...base,
      kind: 'radial',
      centre: { ...t.centre },
      radiusX: t.radiusX,
      radiusY: t.radiusY,
      angle: t.angle ?? 0,
      softness: t.softness ?? 50,
      ...plane
    }
  throw new Error(`not a component: ${t.kind}`)
}

const DENOISE_NAME = { drunet: 'DRUNet', nafnet: 'NAFNet' }

/** What `smart` does on a photo of this build. */
export function planSmart(smart: SmartPart, ready: SmartReadiness, photo: SmartPhoto): SmartPlan {
  const rates = { ...SMART_RATES, ...photo.rates }
  const mp = (photo.frameWidth * photo.frameHeight) / 1e6
  const plane = gradientPlaneSize(photo.frameWidth, photo.frameHeight)
  const plan: SmartPlan = {
    layers: [],
    ops: [],
    picks: 0,
    skipped: [],
    complete: true,
    etaMs: 0,
    summary: []
  }
  /** Each mask made: its layer, by instruction id. */
  const made = new Map<string, string>()

  for (const m of smart.masks) {
    const missing = m.parts
      .map((p) => partNeed(p.target, ready))
      .filter((n) => !n.ready)
      .map((n) => whyNot(ready[n.key]))
    if (missing.length > 0) {
      plan.skipped.push({ name: m.name, why: missing[0] })
      if (m.required) plan.complete = false
      continue
    }
    const layer = newLocalLayer(m.name)
    applyAdjust(layer.settings, m.adjust)
    layer.amount = Math.min(200, Math.max(0, m.amount ?? 100))
    const feather = m.feather ?? 5
    made.set(m.id, layer.id)
    plan.summary.push(`${m.name} mask`)
    if (m.parts.every((p) => IMMEDIATE.has(p.target.kind))) {
      layer.components = m.parts.map((p) => componentOf(p, feather, plane))
      plan.layers.push(layer)
      continue
    }
    // Waiting on a model: off and empty until every part is in, in order.
    layer.enabled = false
    plan.layers.push(layer)
    for (const p of m.parts) {
      const t = p.target
      const at = { layerId: layer.id, mask: m.id, mode: p.mode, invert: p.invert ?? false }
      if (IMMEDIATE.has(t.kind)) {
        plan.ops.push({
          kind: 'component',
          layerId: layer.id,
          mask: m.id,
          component: componentOf(p, feather, plane)
        })
      } else if (t.kind === 'subject' || t.kind === 'background' || t.kind === 'sky') {
        plan.ops.push({ kind: 'segment', ...at, target: t.kind })
        plan.etaMs += rates.segmentMs
      } else if (t.kind === 'person') {
        plan.ops.push({ kind: 'person', ...at, part: t.part })
        plan.etaMs += rates.personMs
      } else if (t.kind === 'object') {
        const detect = ready.object === 'ready'
        plan.ops.push({ kind: 'object', ...at, label: t.label, detect })
        plan.etaMs += (detect ? rates.detectMs : 0) + rates.sam2Ms
        if (!detect) plan.picks++
      }
    }
    plan.ops.push({ kind: 'enable', layerId: layer.id, mask: m.id })
  }

  // Steps after every mask: one scoped to a mask freezes it when it starts.
  for (const s of smart.steps) {
    const name = s.kind === 'denoise' ? 'AI denoise' : 'AI deblur'
    let layerId: string | null = null
    if (s.scope !== undefined) {
      const id = made.get(s.scope)
      if (!id) {
        plan.skipped.push({ name, why: 'its mask could not be made' })
        continue
      }
      layerId = id
    }
    const strength = Math.min(100, Math.max(1, s.strength))
    if (s.kind === 'denoise') {
      const model = denoiseModel(s.model, ready)
      if (!model) {
        const want = s.model === 'nafnet' ? ready.nafnet : ready.drunet
        plan.skipped.push({ name, why: whyNot(want) })
        continue
      }
      plan.ops.push({ kind: 'denoise', model, strength, layerId })
      plan.etaMs += mp * (model === 'nafnet' ? rates.nafnetMsPerMp : rates.drunetMsPerMp)
      plan.summary.push(`AI denoise (${DENOISE_NAME[model]})`)
    } else {
      if (ready.deblur !== 'ready') {
        plan.skipped.push({ name, why: whyNot(ready.deblur) })
        continue
      }
      plan.ops.push({ kind: 'deblur', strength, layerId })
      plan.etaMs += mp * rates.deblurMsPerMp
      plan.summary.push('AI deblur (NAFNet)')
    }
  }
  plan.etaMs = Math.round(plan.etaMs)
  return plan
}

/** A build with no models: what a look makes with sliders and shapes alone. */
const NO_MODELS = smartReadiness({
  models: false,
  subjectModel: false,
  drunetModel: false,
  enhance: false,
  engine: { sky: false, people: false, sam2: false, detector: false, nafnet: false }
})

/**
 * The masks a smart look makes without a model (its ranges and gradients),
 * whole: what a hover preview and a browser card show of it.
 */
export function immediateLayers(smart: SmartPart, photo: SmartPhoto): LocalLayer[] {
  return planSmart(smart, NO_MODELS, photo).layers.filter((l) => l.enabled)
}

/**
 * Layers for a preview, their ids made from the look's (`look:0`, …): the
 * same look shows the same picture every time, so a card made once is found
 * again rather than made anew.
 */
export function previewLayers(lookId: string, layers: LocalLayer[]): LocalLayer[] {
  return layers.map((l, i) => ({
    ...l,
    id: `${lookId}:${i}`,
    components: l.components.map((c, j) => ({ ...c, id: `${lookId}:${i}:${j}` }))
  }))
}

// ── Reading instructions from outside (a look file) ─────────────────────────

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const MODES: MaskMode[] = ['Add', 'Subtract', 'Intersect']
const MAX_MASKS = 8
const MAX_PARTS = 6
const MAX_STEPS = 4

function band(v: unknown, hue: boolean): KeyBand | undefined {
  if (!isObj(v) || !num(v.centre) || !num(v.width) || !num(v.softness)) return undefined
  const top = hue ? 360 : 1
  return {
    centre: clamp(v.centre, 0, top),
    width: clamp(v.width, 0, top),
    softness: clamp(v.softness, 0, top)
  }
}

const point = (v: unknown): FramePoint | undefined =>
  isObj(v) && num(v.x) && num(v.y) ? { x: clamp(v.x, -1, 2), y: clamp(v.y, -1, 2) } : undefined

function targetOf(v: unknown): MaskTarget | null {
  if (!isObj(v)) return null
  switch (v.kind) {
    case 'range': {
      const t: MaskTarget = { kind: 'range' }
      const h = band(v.hue, true)
      const s = band(v.saturation, false)
      const l = band(v.luma, false)
      if (h) t.hue = h
      if (s) t.saturation = s
      if (l) t.luma = l
      if (!h && !s && !l) return null
      if (num(v.smoothness)) t.smoothness = clamp(v.smoothness, 0, 100)
      return t
    }
    case 'linear': {
      const start = point(v.start)
      const end = point(v.end)
      return start && end ? { kind: 'linear', start, end } : null
    }
    case 'radial': {
      const centre = point(v.centre)
      if (!centre || !num(v.radiusX) || !num(v.radiusY)) return null
      return {
        kind: 'radial',
        centre,
        radiusX: clamp(v.radiusX, 0.001, 4),
        radiusY: clamp(v.radiusY, 0.001, 4),
        angle: num(v.angle) ? v.angle % 360 : 0,
        softness: num(v.softness) ? clamp(v.softness, 0, 100) : 50
      }
    }
    case 'subject':
    case 'background':
    case 'sky':
      return { kind: v.kind }
    case 'person':
      return PERSON_PARTS.includes(v.part as PersonPart)
        ? { kind: 'person', part: v.part as PersonPart }
        : null
    case 'object': {
      const label = typeof v.label === 'string' ? v.label.trim().toLowerCase().slice(0, 40) : ''
      return label ? { kind: 'object', label } : null
    }
    default:
      return null
  }
}

/**
 * Instructions read from outside, kept to what we understand and what a
 * look may do: unknown targets, settings a look may not set, and steps
 * scoped to masks it does not have are dropped (and said, in `dropped`).
 */
export function readSmart(raw: unknown): { smart: SmartPart | null; dropped: string[] } {
  const dropped: string[] = []
  if (!isObj(raw)) return { smart: null, dropped }
  const masks: MaskInstruction[] = []
  const rawMasks = Array.isArray(raw.masks) ? raw.masks.slice(0, MAX_MASKS) : []
  for (const [i, m] of rawMasks.entries()) {
    if (!isObj(m)) {
      dropped.push(`masks.${i}`)
      continue
    }
    const id = typeof m.id === 'string' && m.id ? m.id.slice(0, 40) : `m${i}`
    const name = typeof m.name === 'string' && m.name.trim() ? m.name.trim().slice(0, 40) : 'Mask'
    const parts: MaskPart[] = []
    const rawParts = Array.isArray(m.parts) ? m.parts.slice(0, MAX_PARTS) : []
    for (const [j, p] of rawParts.entries()) {
      const target = isObj(p) ? targetOf(p.target) : null
      if (!target || !isObj(p)) {
        dropped.push(`masks.${i}.parts.${j}`)
        continue
      }
      // The first part adds, whatever it says.
      const mode =
        parts.length === 0
          ? 'Add'
          : MODES.includes(p.mode as MaskMode)
            ? (p.mode as MaskMode)
            : 'Add'
      parts.push({ target, mode, ...(p.invert === true ? { invert: true } : {}) })
    }
    if (parts.length === 0 || masks.some((x) => x.id === id)) {
      dropped.push(`masks.${i}`)
      continue
    }
    const adjust: Record<string, number> = {}
    if (isObj(m.adjust))
      for (const [path, v] of Object.entries(m.adjust)) {
        const range = adjustRange(path)
        if (!range || !num(v)) {
          dropped.push(`masks.${i}.adjust.${path}`)
          continue
        }
        adjust[path] = clamp(v, range[0], range[1])
      }
    const out: MaskInstruction = { id, name, parts, adjust }
    if (num(m.feather)) out.feather = clamp(m.feather, 0, 100)
    if (num(m.amount)) out.amount = clamp(m.amount, 0, 200)
    if (m.required === true) out.required = true
    masks.push(out)
  }
  const steps: StepInstruction[] = []
  const rawSteps = Array.isArray(raw.steps) ? raw.steps.slice(0, MAX_STEPS) : []
  for (const [i, s] of rawSteps.entries()) {
    if (!isObj(s) || !num(s.strength)) {
      dropped.push(`steps.${i}`)
      continue
    }
    const scope = typeof s.scope === 'string' ? s.scope : undefined
    if (scope !== undefined && !masks.some((m) => m.id === scope)) {
      dropped.push(`steps.${i}`)
      continue
    }
    const strength = clamp(s.strength, 1, 100)
    const scoped = scope !== undefined ? { scope } : {}
    if (s.kind === 'denoise') {
      const model = (['auto', 'drunet', 'nafnet'] as const).find((x) => x === s.model) ?? 'auto'
      steps.push({ kind: 'denoise', model, strength, ...scoped })
    } else if (s.kind === 'deblur') steps.push({ kind: 'deblur', strength, ...scoped })
    else dropped.push(`steps.${i}`)
  }
  if (masks.length === 0 && steps.length === 0) return { smart: null, dropped }
  return { smart: { masks, steps }, dropped }
}

// ── A photo's masks and AI steps as instructions (a preset saved from it) ──

/** What `toInstructions` made of a photo's masks, and what it had to leave out. */
export interface Converted {
  smart: SmartPart | null
  /** One line per mask and step kept ("Sky: sky minus subject"), for the Save dialog. */
  kept: string[]
  /** What could not be kept, and why ("Mask 2: painted strokes belong to this photo"). */
  warnings: string[]
}

const PART_WORDS: Record<MaskTarget['kind'], (t: MaskTarget) => string> = {
  range: (t) => (t.kind === 'range' && t.hue ? 'a colour range' : 'a brightness range'),
  linear: () => 'a linear gradient',
  radial: () => 'a radial gradient',
  subject: () => 'the subject',
  background: () => 'the background',
  sky: () => 'the sky',
  person: (t) => (t.kind === 'person' ? t.part : 'a person'),
  object: (t) => (t.kind === 'object' ? `the ${t.label}` : 'an object')
}

function partWords(parts: MaskPart[]): string {
  return parts
    .map((p, i) => {
      const w = (p.invert ? 'all but ' : '') + PART_WORDS[p.target.kind](p.target)
      if (i === 0) return w
      return p.mode === 'Subtract'
        ? `minus ${w}`
        : p.mode === 'Intersect'
          ? `within ${w}`
          : `plus ${w}`
    })
    .join(' ')
}

/** A component as a part to ask for again, or why it cannot be. */
function partOf(c: MaskComponentSetting): MaskPart | string {
  const join = { mode: c.mode, ...(c.invert ? { invert: true } : {}) }
  switch (c.kind) {
    case 'range': {
      const target: MaskTarget = { kind: 'range', smoothness: c.smoothness }
      if (c.hue) target.hue = { ...c.hue }
      if (c.saturation) target.saturation = { ...c.saturation }
      if (c.luma) target.luma = { ...c.luma }
      return { target, ...join }
    }
    case 'linear':
      return { target: { kind: 'linear', start: { ...c.start }, end: { ...c.end } }, ...join }
    case 'radial':
      return {
        target: {
          kind: 'radial',
          centre: { ...c.centre },
          radiusX: c.radiusX,
          radiusY: c.radiusY,
          angle: c.angle,
          softness: c.softness
        },
        ...join
      }
    case 'polygon':
      return 'a drawn outline belongs to this photo'
    case 'brush': {
      const src = c.source
      if (!src) return 'painted strokes belong to this photo'
      if (src.kind === 'segment') return { target: { kind: src.target }, ...join }
      if (src.kind === 'person') {
        if (!PERSON_PARTS.includes(src.part as PersonPart))
          return `“${src.part}” is not a part we can find`
        return { target: { kind: 'person', part: src.part as PersonPart }, ...join }
      }
      if (!src.label) return 'an object pointed at by hand has no name to look for'
      return { target: { kind: 'object', label: src.label }, ...join }
    }
  }
}

/** The settings a mask changed, as a look may carry them (dotted paths), and how many it may not. */
function adjustOf(settings: LayerSettings): { adjust: Record<string, number>; left: number } {
  const adjust: Record<string, number> = {}
  let left = 0
  const walk = (a: unknown, b: unknown, path: string[]): void => {
    if (typeof a === 'object' && a !== null && !Array.isArray(a)) {
      for (const k of Object.keys(a as object))
        walk((a as Record<string, unknown>)[k], (b as Record<string, unknown> | undefined)?.[k], [
          ...path,
          k
        ])
      return
    }
    if (JSON.stringify(a) === JSON.stringify(b)) return
    const dotted = path.join('.')
    // A mask's white counts only once it is custom; its mode and preset name are not sliders.
    if (dotted === 'wb.mode' || dotted === 'wb.preset') return
    if (typeof a === 'number' && adjustRange(dotted)) adjust[dotted] = a
    else left++
  }
  walk(settings, neutralSettings(), [])
  if (settings.wb.mode !== 'custom') {
    delete adjust['wb.temperature']
    delete adjust['wb.tint']
  }
  return { adjust, left }
}

/**
 * A photo's masks and AI steps as instructions, for a preset saved from it
 * to make again on another photo: ranges and gradients as they are (the
 * gradients frame-relative), a model's mask as what to ask the model for,
 * a denoise or a deblur as a step scoped to its mask. What belongs to this
 * photo alone (painted strokes, drawn outlines, heals) is left out, and
 * said so.
 */
export function toInstructions(layers: LocalLayer[], pixels: PixelStep[]): Converted {
  const masks: MaskInstruction[] = []
  const kept: string[] = []
  const warnings: string[] = []
  for (const l of layers) {
    if (!l.enabled) continue
    const parts: MaskPart[] = []
    for (const c of l.components) {
      const p = partOf(c)
      if (typeof p === 'string') warnings.push(`${l.name}: ${p}, left out`)
      else parts.push(parts.length === 0 ? { ...p, mode: 'Add' } : p)
    }
    if (parts.length === 0) continue
    if (l.invert) {
      // A whole mask inverted is one part turned round; several cannot be.
      if (parts.length > 1) {
        warnings.push(`${l.name}: an inverted mask of several parts cannot be kept`)
        continue
      }
      parts[0] = { ...parts[0], invert: !parts[0].invert }
    }
    const { adjust, left } = adjustOf(l.settings)
    if (left > 0)
      warnings.push(
        `${l.name}: ${left} setting${left === 1 ? '' : 's'} a preset cannot carry in a mask (noise reduction, point colours, curves) left out`
      )
    const feather = l.components.find(
      (c) => c.kind === 'range' || c.kind === 'linear' || c.kind === 'radial'
    )?.feather
    const id = `m${masks.length + 1}`
    masks.push({
      id,
      name: l.name,
      parts,
      adjust,
      ...(feather !== undefined ? { feather } : {}),
      ...(l.amount !== 100 ? { amount: l.amount } : {})
    })
    kept.push(`${l.name}: ${partWords(parts)}`)
  }
  const steps: StepInstruction[] = []
  for (const p of pixels) {
    const name = p.kind === 'denoise' ? 'AI denoise' : p.kind === 'enhance' ? 'Enhance' : 'Heal'
    let scope: string | undefined
    if (p.scope !== null) {
      scope = masks.find((m) => m.name === p.scope)?.id
      if (!scope) {
        warnings.push(`${name} in ${p.scope}: its mask is not kept, so neither is it`)
        continue
      }
    }
    const scoped = scope ? { scope } : {}
    const where = p.scope ? ` in ${p.scope}` : ''
    if (p.kind === 'denoise') {
      const model = p.params.model === 'drunet-color' ? 'drunet' : 'auto'
      if (p.params.model !== 'drunet-color')
        warnings.push(`${name}${where}: saved as the quickest denoise model there is`)
      steps.push({ kind: 'denoise', model, strength: Math.max(1, p.opacity), ...scoped })
      kept.push(`${name}${where} at ${p.opacity}%`)
    } else if (p.kind === 'enhance' && p.params.chain === 'Deblur') {
      steps.push({ kind: 'deblur', strength: Math.max(1, p.opacity), ...scoped })
      kept.push(`AI deblur${where}`)
    } else if (p.kind === 'enhance') {
      warnings.push(
        `${p.label}: only a deblur can be kept (an upscale or a JPEG restore is the file's)`
      )
    } else {
      warnings.push(`${p.label}: heals belong to this photo, left out`)
    }
  }
  return {
    smart: masks.length || steps.length ? { masks, steps } : null,
    kept,
    warnings
  }
}
