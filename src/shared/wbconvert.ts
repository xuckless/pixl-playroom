/**
 * A white balance moved between photos of different kinds. A RAW with a
 * known as-shot white keeps absolute Kelvin and tint; anything else keeps
 * relative sliders. Crossing kinds goes through the engine's white itself.
 */
import { absoluteWb, baseWhite } from './compile'
import type { WhitePoint } from './engine-types'
import type { Recipe } from './recipe'
import { absoluteFromOp, relativeFromOp, TINT_UNITS_PER_DUV, type OpWhite } from './wb'

export interface WbContext {
  isRaw: boolean
  asShot: WhitePoint | null
}

/** The engine white `op` in the slider units of a photo of kind `to`. */
export function wbFromOp(op: Pick<OpWhite, 'kelvin' | 'tint'>, to: WbContext): Recipe['wb'] {
  if (absoluteWb(to) && to.asShot) {
    const abs = absoluteFromOp(op, to.asShot)
    return {
      mode: 'custom',
      temperature: Math.round(abs.kelvin),
      tint: Math.round(abs.tint * TINT_UNITS_PER_DUV),
      preset: null
    }
  }
  const rel = relativeFromOp(op)
  return {
    mode: 'custom',
    temperature: Math.round(rel.temperature),
    tint: Math.round(rel.tint),
    preset: null
  }
}

/** The engine white a custom white balance makes on a photo of kind `ctx` (6504 K neutral for as-shot). */
export function opOf(wb: Recipe['wb'], ctx: WbContext): { kelvin: number; tint: number } {
  const op = baseWhite({ wb } as Recipe, ctx)
  return op ? { kelvin: op.kelvin, tint: op.tint } : { kelvin: 6504, tint: 0 }
}

/** The same white, in the target's slider units. */
export function convertWb(wb: Recipe['wb'], from: WbContext, to: WbContext): Recipe['wb'] {
  if (absoluteWb(from) === absoluteWb(to)) return wb
  return wbFromOp(opOf(wb, from), to)
}

/** A white balance saved with its engine white (a WB preset, a develop preset). */
export interface SavedWhite {
  kelvin: number
  tint: number
  /** Whether the saved numbers are absolute Kelvin (made on a RAW with an as-shot white). */
  absolute: boolean
}

/** What to save beside `wb`, made on a photo of kind `ctx`. */
export function savedWhite(wb: Recipe['wb'], ctx: WbContext): SavedWhite {
  return { ...opOf(wb, ctx), absolute: absoluteWb(ctx) }
}

/**
 * A saved custom white balance on a photo of kind `to`: the numbers as they
 * were saved when the kinds match (a RAW keeps absolute Kelvin, whatever
 * its as-shot white), otherwise the saved engine white in `to`'s units.
 */
export function wbFromSaved(wb: Recipe['wb'], saved: SavedWhite, to: WbContext): Recipe['wb'] {
  if (saved.absolute === absoluteWb(to)) return wb
  return { ...wbFromOp(saved, to), preset: wb.preset }
}
