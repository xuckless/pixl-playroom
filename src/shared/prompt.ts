/**
 * A prompt for SAM 2.1 (engine 0.16's prompted segmentation): a box and
 * clicks on the photo, in fractions of its base frame (upright and
 * lens-corrected: what masks are placed on). A mask made from one keeps it
 * (`BrushSource` `prompt`), so it can be made again: `parts` says how many
 * of the points each decode fed, since every decode after the first takes
 * the one before as its input (`maskInput`), and replaying them in the same
 * steps gives the same mask.
 *
 * Pure: the Objects tool builds prompts with it, main checks them and hands
 * them to the engine, and saved presets carry them.
 */
import type { Prompt } from './engine-types'
import type { BrushSource } from './recipe'

export interface PromptPoint {
  x: number
  y: number
  /** A part of what is wanted (Foreground), or of what is not (Background). */
  fg: boolean
}

export interface PromptRect {
  x: number
  y: number
  width: number
  height: number
}

export interface PromptGeometry {
  rect: PromptRect | null
  points: PromptPoint[]
  /** Points fed by each decode in turn, as running totals (strictly rising, the last ≤ points). */
  parts?: number[]
}

/** How the user asked: a click, a box, strokes, a lasso, the sky, a look's question. */
export type PromptVia = 'click' | 'box' | 'brush' | 'lasso' | 'sky' | 'look'

export const PROMPT_VIAS: readonly PromptVia[] = ['click', 'box', 'brush', 'lasso', 'sky', 'look']

/** The decoder takes at most this many clicks. */
export const MAX_PROMPT_POINTS = 64
/** A brush stroke becomes at most this many clicks. */
export const STROKE_POINTS = 16
/** A box smaller than this (a share of the frame) is a click. */
const MIN_BOX = 0.002

const unit = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 1e5) / 1e5
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** A prompt read from anywhere (a recipe, a preset, the renderer), checked, or null. */
export function normalisePrompt(v: unknown): PromptGeometry | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  let rect: PromptRect | null = null
  const r = o.rect as Record<string, unknown> | null | undefined
  if (r && isNum(r.x) && isNum(r.y) && isNum(r.width) && isNum(r.height)) {
    const x = unit(r.x)
    const y = unit(r.y)
    const width = unit(Math.min(r.width, 1 - x))
    const height = unit(Math.min(r.height, 1 - y))
    if (width > 0 && height > 0) rect = { x, y, width, height }
  }
  const points: PromptPoint[] = Array.isArray(o.points)
    ? (o.points as unknown[])
        .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
        .filter((p) => isNum(p.x) && isNum(p.y))
        .slice(0, MAX_PROMPT_POINTS)
        .map((p) => ({ x: unit(p.x as number), y: unit(p.y as number), fg: p.fg !== false }))
    : []
  if (!rect && points.length === 0) return null
  const out: PromptGeometry = { rect, points }
  if (Array.isArray(o.parts)) {
    const parts = o.parts as unknown[]
    const ok =
      parts.length > 0 &&
      parts.every(
        (n, i) =>
          Number.isInteger(n) &&
          (n as number) <= points.length &&
          (i === 0 ? (n as number) >= 0 : (n as number) > (parts[i - 1] as number))
      )
    if (ok) out.parts = parts as number[]
  }
  return out
}

/** The engine's prompt for the first `count` points (all of them by default). */
export function enginePrompt(g: PromptGeometry, count = g.points.length): Prompt {
  return {
    rect: g.rect ? { ...g.rect } : null,
    points: g.points.slice(0, count).map((p) => ({
      at: { x: p.x, y: p.y },
      label: p.fg ? 'Foreground' : 'Background'
    }))
  }
}

/**
 * The decodes that make a prompt's mask, in order: how many points each
 * feeds (the box with every one). One decode when it has no `parts`.
 */
export function promptSteps(g: PromptGeometry): number[] {
  const parts = g.parts && g.parts.length > 0 ? g.parts : [g.points.length]
  return parts[parts.length - 1] === g.points.length ? parts : [...parts, g.points.length]
}

/** A selection with a part added: its clicks after the ones before; a new box replaces the old. */
export function addPart(prev: PromptGeometry, part: PromptGeometry): PromptGeometry {
  const points: PromptPoint[] = [...prev.points, ...part.points]
  return {
    rect: part.rect ?? prev.rect,
    points,
    parts: [...promptSteps(prev), points.length].filter((n, i, all) => i === 0 || n > all[i - 1])
  }
}

/** The box around some points (a drag's corners on a turned or straightened view), or null when too small. */
export function boxAround(points: { x: number; y: number }[]): PromptRect | null {
  if (points.length === 0) return null
  const xs = points.map((p) => Math.min(1, Math.max(0, p.x)))
  const ys = points.map((p) => Math.min(1, Math.max(0, p.y)))
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  const width = Math.max(...xs) - x
  const height = Math.max(...ys) - y
  if (width < MIN_BOX || height < MIN_BOX) return null
  return { x: unit(x), y: unit(y), width: unit(width), height: unit(height) }
}

/**
 * A brush stroke as clicks: evenly spaced along its length (by arc length),
 * at most `max`, its ends included. Strokes are where the object is.
 */
export function strokePoints(
  stroke: { x: number; y: number }[],
  /** The frame's width over its height: lengths are measured in its pixels. */
  aspect: number,
  max = STROKE_POINTS
): { x: number; y: number }[] {
  if (stroke.length <= 1) return stroke.slice(0, 1).map((p) => ({ x: unit(p.x), y: unit(p.y) }))
  const d = [0]
  for (let i = 1; i < stroke.length; i++) {
    const dx = (stroke[i].x - stroke[i - 1].x) * aspect
    const dy = stroke[i].y - stroke[i - 1].y
    d.push(d[i - 1] + Math.hypot(dx, dy))
  }
  const total = d[d.length - 1]
  if (total === 0) return [{ x: unit(stroke[0].x), y: unit(stroke[0].y) }]
  const n = Math.max(2, Math.min(max, Math.ceil(total / 0.04) + 1))
  const out: { x: number; y: number }[] = []
  let j = 1
  for (let k = 0; k < n; k++) {
    const at = (total * k) / (n - 1)
    while (j < d.length - 1 && d[j] < at) j++
    const t = d[j] === d[j - 1] ? 0 : (at - d[j - 1]) / (d[j] - d[j - 1])
    out.push({
      x: unit(stroke[j - 1].x + (stroke[j].x - stroke[j - 1].x) * t),
      y: unit(stroke[j - 1].y + (stroke[j].y - stroke[j - 1].y) * t)
    })
  }
  return out
}

/** Whether `p` is inside a closed outline (non-zero, as masks fill). */
export function insidePolygon(
  p: { x: number; y: number },
  poly: { x: number; y: number }[]
): boolean {
  let wind = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const cross = (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y)
    if (a.y <= p.y) {
      if (b.y > p.y && cross > 0) wind++
    } else if (b.y <= p.y && cross < 0) wind--
  }
  return wind !== 0
}

function distanceToEdge(
  p: { x: number; y: number },
  poly: { x: number; y: number }[],
  aspect: number
): number {
  let best = Infinity
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const ax = a.x * aspect
    const bx = b.x * aspect
    const px = p.x * aspect
    const dx = bx - ax
    const dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (p.y - a.y) * dy) / len2))
    best = Math.min(best, Math.hypot(px - (ax + dx * t), p.y - (a.y + dy * t)))
  }
  return best
}

/**
 * A rough lasso as SAM's prompt ("Find object"): its bounds as the box, and
 * a few clicks well inside it (the points farthest from its outline, spread
 * out), so a thin or hollow outline still says where the object is. Null
 * for an outline too small to be one.
 */
export function lassoPrompt(
  outline: { x: number; y: number }[],
  /** The frame's width over its height. */
  aspect: number,
  clicks = 3
): PromptGeometry | null {
  if (outline.length < 3) return null
  const rect = boxAround(outline)
  if (!rect) return null
  // Candidates on a grid over the box; the deepest inside, kept apart.
  const n = 24
  const found: { p: { x: number; y: number }; depth: number }[] = []
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const p = {
        x: rect.x + ((i + 0.5) / n) * rect.width,
        y: rect.y + ((j + 0.5) / n) * rect.height
      }
      if (!insidePolygon(p, outline)) continue
      found.push({ p, depth: distanceToEdge(p, outline, aspect) })
    }
  }
  found.sort((a, b) => b.depth - a.depth)
  const points: PromptPoint[] = []
  const apart = Math.max(rect.width * aspect, rect.height) / 4
  for (const f of found) {
    if (points.length >= clicks) break
    if (points.some((q) => Math.hypot((q.x - f.p.x) * aspect, q.y - f.p.y) < apart)) continue
    points.push({ x: unit(f.p.x), y: unit(f.p.y), fg: true })
  }
  return { rect, points }
}

// ── The select tool's calls (main's select/service.ts) ────────────────────────

/** A mask as the tool shows it while it is being made. */
export interface SelectPlane {
  seq: number
  /** A 16-bit grey PNG, `width × height`, the base frame's aspect. */
  png: Uint8Array
  width: number
  height: number
  /** The decoder's own guess at how well it caught what was meant. */
  iou: number
  /** The share of the frame it covers. */
  coverage: number
  ms: number
}

/** What a decode asks: a live probe (hover, a box being dragged), a fresh prompt, or a part added. */
export interface SelectDecode {
  seq: number
  mode: 'probe' | 'replace' | 'part'
  /** For `part`: the points (and a box, if one) to add; otherwise the whole prompt. */
  prompt: PromptGeometry
  /** The plane's long side for a probe (the view's size), at most PREVIEW_MAX. */
  longest?: number
}

/** A mask made, held by the plane store, ready to become a component. */
export interface SelectCommit {
  ref: string
  width: number
  height: number
  source: BrushSource
}
