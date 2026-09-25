/**
 * Linear and radial gradient masks, drawn into grey planes. The engine has
 * no gradient shape yet (see TODO.md), so a gradient reaches it as a raster
 * mask, like a brush — but the recipe keeps the gradient's geometry, so its
 * pins stay editable and the plane is redrawn, identically, wherever it is
 * needed (preview, thumbnails, export).
 *
 * Everything here is in the plane's own pixels, which share the base
 * frame's aspect, so a circle drawn on screen stays a circle.
 */
import { hash32, type LinearComponent, type RadialComponent } from './recipe'

export interface Pt {
  x: number
  y: number
}

/** The long edge gradients are drawn at: smooth fields need few pixels. */
export const GRADIENT_EDGE = 512

/** A plane with the base frame's aspect and a long edge of `edge` pixels. */
export function gradientPlaneSize(
  frameWidth: number,
  frameHeight: number,
  edge = GRADIENT_EDGE
): { width: number; height: number } {
  if (!(frameWidth > 0 && frameHeight > 0)) return { width: edge, height: edge }
  return frameWidth >= frameHeight
    ? { width: edge, height: Math.max(1, Math.round((edge * frameHeight) / frameWidth)) }
    : { width: Math.max(1, Math.round((edge * frameWidth) / frameHeight)), height: edge }
}

const smooth = (e0: number, e1: number, x: number): number => {
  if (e1 <= e0) return x < e0 ? 0 : 1
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/** ±½ code value of fixed, pattern-free noise: keeps 8-bit ramps from banding. */
function dither(x: number, y: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h ^= h >>> 13
  return ((h >>> 0) % 1024) / 1024 - 0.5
}

/** A linear gradient's coverage at plane pixel `p` (1 before start, 0 past end). */
export function linearAt(c: LinearComponent, p: Pt): number {
  const sx = c.start.x * c.width
  const sy = c.start.y * c.height
  const dx = c.end.x * c.width - sx
  const dy = c.end.y * c.height - sy
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-9) return (p.x - sx) * dx + (p.y - sy) * dy <= 0 ? 1 : 0
  const t = ((p.x - sx) * dx + (p.y - sy) * dy) / len2
  return 1 - smooth(0, 1, t)
}

/** The radial gradient's ellipse in plane pixels. */
export function radialGeometry(c: RadialComponent): {
  cx: number
  cy: number
  rx: number
  ry: number
  angle: number
} {
  const short = Math.min(c.width, c.height)
  return {
    cx: c.centre.x * c.width,
    cy: c.centre.y * c.height,
    rx: Math.max(0.5, c.radiusX * short),
    ry: Math.max(0.5, c.radiusY * short),
    angle: (c.angle * Math.PI) / 180
  }
}

/** A radial gradient's coverage at plane pixel `p` (1 inside, 0 outside). */
export function radialAt(c: RadialComponent, p: Pt): number {
  const g = radialGeometry(c)
  const cos = Math.cos(-g.angle)
  const sin = Math.sin(-g.angle)
  const x = p.x - g.cx
  const y = p.y - g.cy
  const u = (x * cos - y * sin) / g.rx
  const v = (x * sin + y * cos) / g.ry
  const d = Math.sqrt(u * u + v * v)
  const inner = 1 - Math.min(100, Math.max(0, c.softness)) / 100
  return 1 - smooth(inner, 1, d)
}

/** The component's plane: one byte per pixel, row by row. */
export function rasteriseGradient(c: LinearComponent | RadialComponent): Uint8Array {
  const w = Math.max(1, Math.round(c.width))
  const h = Math.max(1, Math.round(c.height))
  const out = new Uint8Array(w * h)
  const at = c.kind === 'linear' ? linearAt : radialAt
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = at(c as never, { x: x + 0.5, y: y + 0.5 })
      out[y * w + x] = Math.max(0, Math.min(255, Math.round(v * 255 + dither(x, y))))
    }
  }
  return out
}

/** What the plane depends on — its geometry, not its mode, opacity or feather. */
export function gradientKey(c: LinearComponent | RadialComponent): string {
  const g =
    c.kind === 'linear'
      ? [c.kind, c.start.x, c.start.y, c.end.x, c.end.y, c.width, c.height]
      : [
          c.kind,
          c.centre.x,
          c.centre.y,
          c.radiusX,
          c.radiusY,
          c.angle,
          c.softness,
          c.width,
          c.height
        ]
  return hash32(
    JSON.stringify(g.map((v) => (typeof v === 'number' ? Math.round(v * 1e5) / 1e5 : v)))
  )
    .toString(16)
    .padStart(8, '0')
}

// ── Handles: what the loupe draws and drags ─────────────────────────────────

/** The three lines of a linear gradient, each as two points in plane pixels. */
export function linearLines(c: LinearComponent, reach: number): [Pt, Pt][] {
  const sx = c.start.x * c.width
  const sy = c.start.y * c.height
  const ex = c.end.x * c.width
  const ey = c.end.y * c.height
  const dx = ex - sx
  const dy = ey - sy
  const len = Math.hypot(dx, dy) || 1
  // Perpendicular, reaching well past the frame.
  const px = (-dy / len) * reach
  const py = (dx / len) * reach
  const line = (x: number, y: number): [Pt, Pt] => [
    { x: x - px, y: y - py },
    { x: x + px, y: y + py }
  ]
  return [line(sx, sy), line((sx + ex) / 2, (sy + ey) / 2), line(ex, ey)]
}

/** Points around a radial gradient's ellipse (at `scale` of its radii), in plane pixels. */
export function radialOutline(c: RadialComponent, scale = 1, n = 72): Pt[] {
  const g = radialGeometry(c)
  const pts: Pt[] = []
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2
    const x = Math.cos(t) * g.rx * scale
    const y = Math.sin(t) * g.ry * scale
    pts.push({
      x: g.cx + x * Math.cos(g.angle) - y * Math.sin(g.angle),
      y: g.cy + x * Math.sin(g.angle) + y * Math.cos(g.angle)
    })
  }
  return pts
}

/** The four axis handles of a radial gradient (right, bottom, left, top), in plane pixels. */
export function radialHandles(c: RadialComponent): Pt[] {
  const g = radialGeometry(c)
  const ax = { x: Math.cos(g.angle), y: Math.sin(g.angle) }
  const ay = { x: -Math.sin(g.angle), y: Math.cos(g.angle) }
  return [
    { x: g.cx + ax.x * g.rx, y: g.cy + ax.y * g.rx },
    { x: g.cx + ay.x * g.ry, y: g.cy + ay.y * g.ry },
    { x: g.cx - ax.x * g.rx, y: g.cy - ax.y * g.rx },
    { x: g.cx - ay.x * g.ry, y: g.cy - ay.y * g.ry }
  ]
}
