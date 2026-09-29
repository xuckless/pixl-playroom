/**
 * The masks panel's pure rules: how new masks and copies are named, how a
 * list reorders under a drag, and how the overlay's view mode cycles.
 */
import type { MaskMode } from './engine-types'

/** "Mask n" for the first n no mask is called yet, counting past the highest. */
export function nextMaskName(names: readonly string[]): string {
  let top = 0
  for (const n of names) {
    const m = /^Mask (\d+)$/.exec(n)
    if (m) top = Math.max(top, Number(m[1]))
  }
  return `Mask ${Math.max(top, names.length) + 1}`
}

/** "X copy", then "X copy 2", "X copy 3"… whichever is free. */
export function copyName(name: string, names: readonly string[]): string {
  const base = name.replace(/ copy(?: \d+)?$/, '')
  const taken = new Set(names)
  if (!taken.has(`${base} copy`)) return `${base} copy`
  for (let i = 2; ; i++) if (!taken.has(`${base} copy ${i}`)) return `${base} copy ${i}`
}

/** The list with the item at `from` moved to index `to` (of the list without it). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list]
  if (from < 0 || from >= next.length) return next
  const [it] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(to, next.length)), 0, it)
  return next
}

/**
 * Where a dragged row lands: the index (of the list without it) that the
 * pointer's y falls before, from the other rows' vertical middles in order.
 */
export function dropIndex(middles: readonly number[], y: number): number {
  let i = 0
  while (i < middles.length && y > middles[i]) i++
  return i
}

/** How a component joins its mask: the first one always adds. */
export function effectiveMode(index: number, mode: MaskMode): MaskMode {
  return index === 0 ? 'Add' : mode
}

/** The next mode in Add → Subtract → Intersect → Add. */
export function nextMaskMode(mode: MaskMode): MaskMode {
  return mode === 'Add' ? 'Subtract' : mode === 'Subtract' ? 'Intersect' : 'Add'
}

/** The next of `modes` after `mode`, wrapping (the overlay's ⇧O). */
export function nextOf<T>(modes: readonly T[], mode: T): T {
  const i = modes.indexOf(mode)
  return modes[(i + 1) % modes.length]
}
