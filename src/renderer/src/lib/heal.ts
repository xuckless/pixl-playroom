/**
 * The Heal tool's strokes, baked: a stroke shows at once (as a live spot the
 * engine draws over the photo), is baked into pixels on the photo as it is
 * (main: pixels/heal.ts), and becomes a pixel step in History. It then has no
 * outline and no handles; undo takes it away. Strokes bake one at a time, in
 * order, each on what the ones before it healed; Undo waits for them.
 *
 * Photos that cannot take pixel steps (HDR) keep the live spots of old, and so
 * do spots made before strokes were baked, until they are baked from the
 * panel.
 */
import { newId, type Recipe } from '../../../shared/recipe'
import {
  newSpot,
  SPOT_LABEL,
  type P,
  type RetouchSpot,
  type SpotKind
} from '../../../shared/retouch'
import type { PixelStep } from '../../../shared/pixels'
import { api, errorText } from './api'
import { landingWork, useDevelop } from '../state/develop'
import { useLibrary } from '../state/library'
import { scoped } from '../state/scope'
import { useUi } from '../state/ui'

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

/** Where a heal or clone copies from until the engine answers: beside it, 2.5 radii right (or left). */
function besideOf(points: P[], radius: number): P {
  const s = useDevelop.getState().session
  const short = s ? Math.min(s.frameWidth, s.frameHeight) : 1
  const dx = (2.5 * radius * short) / (s?.frameWidth ?? 1)
  const at = points[0]
  return { x: at.x + dx <= 1 ? at.x + dx : at.x - dx, y: at.y }
}

/** The engine's pick of a source for a spot; beside it when the engine has none. */
async function sourceFor(
  points: P[],
  radius: number,
  feather: number,
  kind: 'heal' | 'clone'
): Promise<P> {
  const session = useDevelop.getState().session
  if (!session) return besideOf(points, radius)
  try {
    const p = await api.develop.suggestHeal(session.key, points, radius, feather, kind)
    return { x: clamp01(p.x), y: clamp01(p.y) }
  } catch {
    return besideOf(points, radius)
  }
}

/** Whether strokes bake on the open photo (not on an HDR one). */
export function bakes(): boolean {
  return useDevelop.getState().session?.isHdr !== true
}

let queue: Promise<void> = Promise.resolve()

/**
 * Begin a spot where the user pressed: shown at once as a live spot (a heal
 * or clone with its source on itself, which changes nothing until the source
 * is dragged away). Returns its id; `endSpot` bakes it, `cancelSpot` drops it.
 */
export function beginSpot(
  kind: SpotKind,
  at: P,
  shape?: { radius: number; radiusY: number; rotate: number }
): string | null {
  const dev = useDevelop.getState()
  if (!dev.recipe || !dev.session) return null
  const h = useUi.getState().heal
  const spot = newSpot(newId(), kind, [at], shape?.radius ?? h.size, h.feather, h.opacity)
  if (shape) {
    spot.radiusY = shape.radiusY
    spot.rotate = shape.rotate
  }
  if (kind === 'heal' || kind === 'clone') spot.source = { ...at }
  dev.edit((r) => r.retouch.push(spot), true)
  return spot.id
}

/** Move a spot's source while it is dragged (the picture follows). */
export function dragSource(id: string, source: P): void {
  useDevelop.getState().edit((r) => {
    const s = r.retouch.find((x) => x.id === id)
    if (s) s.source = { x: clamp01(source.x), y: clamp01(source.y) }
  }, true)
}

/** Drop a spot that was begun (a press that went off the photo). */
export function cancelSpot(id: string): void {
  useDevelop.getState().edit((r) => (r.retouch = r.retouch.filter((x) => x.id !== id)), true)
}

/**
 * Let go of a spot: its source where it was dragged to, or (a press that did
 * not move) where the engine finds best. Then it is baked into the photo and
 * its outline goes; on an HDR photo it stays a live spot.
 */
export async function endSpot(id: string, source: P | null): Promise<void> {
  const dev = useDevelop.getState()
  const session = dev.session
  const spot = dev.recipe?.retouch.find((x) => x.id === id)
  if (!session || !spot) return
  if (spot.kind === 'heal' || spot.kind === 'clone') {
    const src = source ?? (await sourceFor(spot.points, spot.radius, spot.feather, spot.kind))
    dragSource(id, src)
    spot.source = src
  }
  if (!bakes()) {
    const d = useDevelop.getState()
    d.edit(() => undefined)
    d.commit(`${SPOT_LABEL[spot.kind]}: add`)
    return
  }
  const layerId = scoped.layer()?.id ?? null
  const job = (queue = queue.then(() => land(session.key, { ...spot }, layerId)))
  landingWork(job)
}

/** Bake one stroke and put its step in place of its live spot. */
async function land(key: string, spot: RetouchSpot, layerId: string | null): Promise<void> {
  const still = (): boolean => useDevelop.getState().session?.key === key
  if (!still()) return
  const steps = useDevelop.getState().recipe?.pixels ?? []
  let step: PixelStep | null = null
  try {
    step = await api.develop.bakeSpot(key, spot, layerId, steps)
  } catch (err) {
    useLibrary.getState().say(`${SPOT_LABEL[spot.kind]}: ${errorText(err)}`, 'error')
  }
  if (!still()) return
  const dev = useDevelop.getState()
  dev.edit((r: Recipe) => {
    r.retouch = r.retouch.filter((x) => x.id !== spot.id)
    if (step) r.pixels.push(step)
  })
  dev.commit(step?.label ?? `${SPOT_LABEL[spot.kind]}: nothing to change`)
}

/**
 * Bake the photo's live spots (made before strokes were baked) into pixel
 * steps, in their order, as one History step.
 */
export async function bakeLiveSpots(): Promise<void> {
  const dev = useDevelop.getState()
  const session = dev.session
  if (!dev.recipe || !session || !bakes()) return
  const key = session.key
  const spots = dev.recipe.retouch.filter((s) => s.enabled)
  const job = (queue = queue.then(async () => {
    const made: PixelStep[] = []
    try {
      for (const s of spots) {
        if (useDevelop.getState().session?.key !== key) return
        const steps = [...(useDevelop.getState().recipe?.pixels ?? []), ...made]
        const step = await api.develop.bakeSpot(key, s, null, steps)
        if (step) made.push(step)
      }
    } catch (err) {
      useLibrary.getState().say(errorText(err), 'error')
      return
    }
    if (useDevelop.getState().session?.key !== key) return
    const d = useDevelop.getState()
    d.edit((r) => {
      r.retouch = []
      r.pixels.push(...made)
    })
    d.commit(`Bake ${spots.length} spot${spots.length === 1 ? '' : 's'}`)
  }))
  landingWork(job)
  await job
}

/** Take away the photo's live spots (made before strokes were baked). */
export function removeLiveSpots(): void {
  const dev = useDevelop.getState()
  const n = dev.recipe?.retouch.length ?? 0
  if (!n) return
  dev.edit((r) => (r.retouch = []))
  dev.commit(`Remove ${n} spot${n === 1 ? '' : 's'}`)
}
