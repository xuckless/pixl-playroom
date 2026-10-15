/**
 * The arithmetic of the bar sliders: a drag moves the value by how far the
 * pointer went (the bar's width spans the whole range; Shift a tenth of it),
 * never to where it was pressed; keys step it. Values land on the slider's
 * step and stay inside its range.
 *
 * And the one rule every dragged or stepped control keeps (the sliders, the
 * wheels' discs, rings and YRGB numbers, curve points, number fields):
 * Shift moves it finely, a tenth as fast; Alt (Option) puts it back to its
 * default, as a double-click does; Escape cancels the edit under way. From
 * the keys: arrows step (Shift a tenth of a step), Page Up and Page Down ten
 * steps, Home goes back to the default.
 */

/** How much slower Shift moves a control. */
export const FINE = 0.1

export interface Mods {
  shiftKey: boolean
  altKey: boolean
}

/** Shift held: the control moves finely. */
export const isFine = (e: Mods): boolean => e.shiftKey

/** Alt (Option) held on a press: the control goes back to its default. */
export const isReset = (e: Mods): boolean => e.altKey

export type KeyMod = 'none' | 'coarse' | 'fine'

/** A key that steps a control: which way, and how far; null for any other key. */
export function keyStep(e: {
  key: string
  shiftKey: boolean
}): { dir: 1 | -1; mod: KeyMod } | null {
  const fine = e.shiftKey ? 'fine' : 'none'
  switch (e.key) {
    case 'ArrowRight':
    case 'ArrowUp':
      return { dir: 1, mod: fine }
    case 'ArrowLeft':
    case 'ArrowDown':
      return { dir: -1, mod: fine }
    case 'PageUp':
      return { dir: 1, mod: 'coarse' }
    case 'PageDown':
      return { dir: -1, mod: 'coarse' }
    default:
      return null
  }
}

/** How far a step goes, as a share of one: ten for Page keys, a tenth with Shift. */
export const stepScale = (mod: KeyMod): number =>
  mod === 'coarse' ? 10 : mod === 'fine' ? FINE : 1

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

/** The value after a drag of `dx` pixels across a bar `width` wide, from `start` (`fine`: Shift). */
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
  return snap(start + dx * perPx * (fine ? FINE : 1), min, max, step)
}

/**
 * The value after a key: an arrow steps once (Page Up and Page Down ten
 * steps, Shift a tenth of one).
 */
export function keyValue(
  v: number,
  dir: 1 | -1,
  min: number,
  max: number,
  step: number,
  mod: KeyMod
): number {
  const by = step * stepScale(mod)
  const next = clamp(v + dir * by, min, max)
  // A fine step finer than the grid keeps its own precision.
  return mod === 'fine' ? Number(next.toFixed(places(step) + 1)) : snap(next, min, max, step)
}

/**
 * A slider on a log scale (a brush size: as much travel from 0.2 to 2 as
 * from 2 to 20): where `v` sits along the bar, 0…1, and the value at a place.
 */
export function logFraction(v: number, min: number, max: number): number {
  if (!(min > 0) || !(max > min)) return 0
  return (Math.log(clamp(v, min, max)) - Math.log(min)) / (Math.log(max) - Math.log(min))
}

export function logValue(t: number, min: number, max: number): number {
  return Math.exp(Math.log(min) + clamp(t, 0, 1) * (Math.log(max) - Math.log(min)))
}

/** A drag on a log slider: the place along the bar moves by the distance, the value follows. */
export function dragValueLog(
  start: number,
  dx: number,
  width: number,
  min: number,
  max: number,
  step: number,
  fine = false
): number {
  const t = logFraction(start, min, max) + (dx / Math.max(1, width)) * (fine ? FINE : 1)
  return snap(logValue(t, min, max), min, max, step)
}

/** A key on a log slider: one hundredth of the bar (Page keys a tenth, Shift a thousandth). */
export function keyValueLog(
  v: number,
  dir: 1 | -1,
  min: number,
  max: number,
  step: number,
  mod: KeyMod
): number {
  const by = 0.01 * stepScale(mod)
  const next = logValue(logFraction(v, min, max) + dir * by, min, max)
  const snapped = snap(next, min, max, step)
  // Never stuck: a step too small to move past the grid takes one grid step.
  return snapped === v ? snap(v + dir * step, min, max, step) : snapped
}
