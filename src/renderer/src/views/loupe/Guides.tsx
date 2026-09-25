import { memo } from 'react'
import type { CropGuide } from '../../state/ui'

const PHI = 0.381966

function lines(
  w: number,
  h: number,
  xs: number[],
  ys: number[]
): { x1: number; y1: number; x2: number; y2: number }[] {
  return [
    ...xs.map((x) => ({ x1: x * w, y1: 0, x2: x * w, y2: h })),
    ...ys.map((y) => ({ x1: 0, y1: y * h, x2: w, y2: y * h }))
  ]
}

const steps = (n: number): number[] => Array.from({ length: n - 1 }, (_, i) => (i + 1) / n)

/**
 * Composition guides drawn over a `w × h` box: thirds, a grid, the golden
 * section, diagonals — or, while straightening, a fine grid to lay a horizon
 * or a wall along.
 */
export const Guides = memo(function Guides({
  kind,
  w,
  h,
  fine = false,
  strong = false
}: {
  kind: CropGuide
  w: number
  h: number
  /** Straightening: a dense, even grid whatever the chosen guide. */
  fine?: boolean
  /** Brighter while the box is being dragged. */
  strong?: boolean
}): React.JSX.Element | null {
  if (w <= 0 || h <= 0) return null
  let segs: { x1: number; y1: number; x2: number; y2: number }[] = []
  if (fine) {
    const n = Math.max(6, Math.round(Math.max(w, h) / 40))
    const cell = Math.max(w, h) / n
    segs = lines(
      w,
      h,
      steps(Math.max(2, Math.round(w / cell))),
      steps(Math.max(2, Math.round(h / cell)))
    )
  } else if (kind === 'thirds') segs = lines(w, h, steps(3), steps(3))
  else if (kind === 'grid') segs = lines(w, h, steps(8), steps(8))
  else if (kind === 'golden') segs = lines(w, h, [PHI, 1 - PHI], [PHI, 1 - PHI])
  else if (kind === 'diagonal') {
    // Lightroom's diagonals: 45° from each corner.
    const d = Math.min(w, h)
    segs = [
      { x1: 0, y1: 0, x2: d, y2: d },
      { x1: w, y1: 0, x2: w - d, y2: d },
      { x1: 0, y1: h, x2: d, y2: h - d },
      { x1: w, y1: h, x2: w - d, y2: h - d }
    ]
  } else return null
  return (
    <svg
      className={`guides${fine ? ' fine' : ''}${strong ? ' strong' : ''}`}
      width={w}
      height={h}
      aria-hidden
    >
      {segs.map((s, i) => (
        <line key={i} {...s} />
      ))}
    </svg>
  )
})
