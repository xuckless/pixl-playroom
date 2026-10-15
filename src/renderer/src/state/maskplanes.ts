/**
 * Which of the engine's mask planes the loupe may show. A plane is drawn for
 * one picture: the crop tool's whole frame or the framed picture, and one
 * framing and lens. One made for another (the crop-mode plane after the crop
 * tool closes, the plane from before a straighten, a turn, an Upright or a
 * lens edit) stretched over the picture on screen sits off its subject until
 * the next settled render replaces it. Pure, for tests.
 */
import type { RenderEvent } from '../../../shared/ipc'

/** What a mask plane is checked against: the view on screen and the last placement change. */
export interface PlaneView {
  /** The view on screen is the whole frame (the crop tool, Upright's guides). */
  whole: boolean
  /** The first recipe number drawn with the masks where they are now (see `maskPlacementKey`). */
  geometryRev: number
}

/** Whether a mask plane (or a mask's thumbnail) was drawn for the picture on screen now. */
export function planeFits(e: Pick<RenderEvent, 'cropMode' | 'rev'>, v: PlaneView): boolean {
  if (Boolean(e.cropMode) !== v.whole) return false
  return (e.rev ?? 0) >= v.geometryRev
}

/**
 * The recipe number a placement change waits for: the edit that made it is
 * sent as the next one (`lastSentRev() + 1`), and a plane drawn before it
 * is of another framing.
 */
export function nextGeometryRev(
  was: { key: string | null; rev: number },
  now: string | null,
  lastSent: number
): { key: string | null; rev: number } {
  return now === was.key ? was : { key: now, rev: lastSent + 1 }
}
