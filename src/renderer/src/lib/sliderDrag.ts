/**
 * The arithmetic of the bar sliders: a drag moves the value by how far the
 * pointer went (the bar's width spans the whole range; Alt a tenth of it),
 * never to where it was pressed; keys step it. Values land on the slider's
 * step and stay inside its range.
 */

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

/** Decimal places in a step (0.05 → 2), so snapped values print cleanly. */
function places(step: number): number {
  const s = String(step)
  const e = s.indexOf('e-')
  if (e >= 0) return Number(s.slice(e + 2))
  const dot = s.indexOf('.')
  return dot < 0 ? 0 : s.length - dot - 1
}

/** `v` on the step grid that starts at `min`, inside `min…max`. */
export function snap(v: number, min: number, max: number, step: number): number {
  if (!(step > 0)) return clamp(v, min, max)
  const n = Math.round((clamp(v, min, max) - min) / step)
  return clamp(Number((min + n * step).toFixed(places(step))), min, max)
}

/** The value after a drag of `dx` pixels across a bar `width` wide, from `start`. */
export function dragValue(
  start: number,
  dx: number,
  width: number,
  min: number,
  max: number,
  step: number,
  fine = false
): number {
  const perPx = (max - min) / Math.max(1, width)
  return snap(start + dx * perPx * (fine ? 0.1 : 1), min, max, step)
}

/**
 * The value after a key: an arrow steps once (Shift ten steps, Alt a tenth
 * of one, never less than a hundredth of the range's step grid allows).
 */
export function keyValue(
  v: number,
  dir: 1 | -1,
  min: number,
  max: number,
  step: number,
  mod: 'none' | 'coarse' | 'fine'
): number {
  const by = mod === 'coarse' ? step * 10 : mod === 'fine' ? step / 10 : step
  const next = clamp(v + dir * by, min, max)
  // A fine step finer than the grid keeps its own precision.
  return mod === 'fine' ? Number(next.toFixed(places(step) + 1)) : snap(next, min, max, step)
}
