/**
 * The Heal tool's edits: spots placed, moved and removed, and the engine's
 * pick of where a heal or clone copies from. Spots live in `recipe.retouch`
 * in base-frame fractions (see `shared/retouch.ts`).
 */
import { newId } from '../../../shared/recipe'
import {
  newSpot,
  SPOT_LABEL,
  type P,
  type RetouchSpot,
  type SpotKind
} from '../../../shared/retouch'
import { api, errorText } from './api'
import { useDevelop } from '../state/develop'
import { useLibrary } from '../state/library'
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

/**
 * Place a spot of the tool's mode. A heal or clone copies from `source`: the
 * spot itself (it changes nothing until its source is dragged away), or a
 * point set beforehand with Alt-click, as Photoshop's clone stamp does.
 * Returns the new spot's id.
 */
export function addSpot(
  kind: SpotKind,
  points: P[],
  opts: { shape?: { radius: number; radiusY: number; rotate: number }; source?: P } = {}
): string | null {
  const dev = useDevelop.getState()
  if (!dev.recipe || points.length === 0) return null
  const h = useUi.getState().heal
  const spot = newSpot(newId(), kind, points, opts.shape?.radius ?? h.size, h.feather, h.opacity)
  if (opts.shape) {
    spot.radiusY = opts.shape.radiusY
    spot.rotate = opts.shape.rotate
  }
  if (kind === 'heal' || kind === 'clone') spot.source = opts.source ?? { ...points[0] }
  dev.edit((r) => r.retouch.push(spot))
  dev.commit(`${SPOT_LABEL[kind]}: add`)
  return spot.id
}

/** Change a spot; `live` while a handle or slider moves (no history). */
export function changeSpot(id: string, change: (s: RetouchSpot) => void, live = false): void {
  useDevelop.getState().edit((r) => {
    const s = r.retouch.find((x) => x.id === id)
    if (s) change(s)
  }, live)
}

export function commitSpot(id: string, what: string): void {
  const dev = useDevelop.getState()
  const s = dev.recipe?.retouch.find((x) => x.id === id)
  dev.commit(`${s ? SPOT_LABEL[s.kind] : 'Spot'}: ${what}`)
}

export function deleteSpot(id: string): void {
  const dev = useDevelop.getState()
  const s = dev.recipe?.retouch.find((x) => x.id === id)
  if (!s) return
  dev.edit((r) => (r.retouch = r.retouch.filter((x) => x.id !== id)))
  dev.commit(`${SPOT_LABEL[s.kind]}: delete`)
  if (dev.spotId === id) dev.setSpotId(null)
}

/** Ask the engine where a heal or clone should copy from (the panel's button). */
export async function findSource(id: string): Promise<void> {
  const s = useDevelop.getState().recipe?.retouch.find((x) => x.id === id)
  if (!s || (s.kind !== 'heal' && s.kind !== 'clone')) return
  try {
    const src = await sourceFor(s.points, s.radius, s.feather, s.kind)
    changeSpot(id, (x) => (x.source = src))
    commitSpot(id, 'new source')
  } catch (err) {
    useLibrary.getState().say(errorText(err), 'error')
  }
}

/** A short name for a spot in the list: its kind and its place among its kind. */
export function spotName(spots: RetouchSpot[], s: RetouchSpot): string {
  const n = spots.filter((x) => x.kind === s.kind).indexOf(s) + 1
  return `${SPOT_LABEL[s.kind]} ${n}`
}
