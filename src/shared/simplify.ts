/**
 * Ramer–Douglas–Peucker: the fewest of a path's points that stay within
 * `epsilon` of it (the first and last always kept). A freehand lasso lays a
 * point every few pixels; this keeps its corners and drops its straight runs.
 */
export interface Pt {
  x: number
  y: number
}

/** Distance from `p` to the segment a→b. */
function segmentDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = dx * dx + dy * dy
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

export function simplifyPath<T extends Pt>(points: readonly T[], epsilon: number): T[] {
  if (points.length < 3) return [...points]
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  // An explicit stack, not recursion: a long freehand stroke has thousands of points.
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length) {
    const [from, to] = stack.pop()!
    let far = -1
    let most = epsilon
    for (let i = from + 1; i < to; i++) {
      const d = segmentDistance(points[i], points[from], points[to])
      if (d > most) {
        most = d
        far = i
      }
    }
    if (far < 0) continue
    keep[far] = 1
    stack.push([from, far], [far, to])
  }
  return points.filter((_, i) => keep[i])
}
