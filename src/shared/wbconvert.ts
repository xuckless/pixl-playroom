/**
 * A white balance moved between photos of different kinds. A RAW with a
 * known as-shot white keeps absolute Kelvin and tint; anything else keeps
 * relative sliders. Crossing kinds goes through the engine's white itself.
 */
import { absoluteWb, baseWhite } from './compile'
import type { WhitePoint } from './engine-types'
import type { Recipe } from './recipe'
import { absoluteFromOp, relativeFromOp, type OpWhite } from './wb'

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
      tint: Math.round(abs.tint * 3000),
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
