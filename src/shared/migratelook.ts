/**
 * The engine's one-time migrations for engine-shaped JSON an older Playroom
 * saved: 0.19.2's (Phase A §1.6, the guide's `migrateLook`, as it gives it)
 * and 0.21.0's clean breaks. A look or
 * mask that still has the old shapes is refused when read, naming the field
 * that changed, so this runs on everything engine-shaped Playroom stores as
 * it loads: the Advanced view's custom layers (`Recipe.custom`), in a
 * sidecar, a preset or a project, and a layer pasted into that view.
 *
 * Playroom's own settings (masks, Tone) are compiled fresh each render, so
 * they need nothing here: `compile.ts` writes the new shapes.
 *
 * Upgrades in place. Safe to run twice.
 *
 * - A mask (`{ components, invert, … }`) gets `edge: null`.
 * - A component (`{ shape, mode, feather, … }`) gets `smooth`, `contrast` and
 *   `shift` 0; a 0.19 `refine` (`{ radius, epsilon, contract }`) becomes
 *   `{ Guided: { radius, epsilon, guide: 'Luma' } }`, its `contract: c` the
 *   component's `shift: -c`.
 * - Tone's `base` (`{ radius, epsilon }`) becomes `{ Guided: { … } }`.
 *
 * Engine 0.21.0's clean breaks, the same bytes as before:
 *
 * - A `ParametricCurve` gets `reach: 'HalfGap'` (E19).
 * - A `Grain` gets `response: 'Midtones'` and `chroma: { amount: 0, size: 1 }` (E43).
 */
export function migrateLook<T>(v: T): T {
  migrate(v)
  return v
}

function migrate(v: unknown): void {
  if (Array.isArray(v)) {
    v.forEach(migrate)
    return
  }
  if (!v || typeof v !== 'object') return
  const o = v as Record<string, unknown>

  // A mask: { components, invert, ... }
  if (Array.isArray(o.components) && 'invert' in o && !('edge' in o)) o.edge = null

  // A mask component: { shape, mode, opacity, invert, feather, refine, ... }
  if ('shape' in o && 'mode' in o && 'feather' in o) {
    for (const k of ['smooth', 'contrast', 'shift']) if (!(k in o)) o[k] = 0
    const r = o.refine as Record<string, unknown> | null | undefined
    if (r && typeof r === 'object' && 'radius' in r && 'epsilon' in r) {
      // The 0.19 shape.
      if (r.contract) o.shift = -(r.contract as number)
      o.refine = { Guided: { radius: r.radius, epsilon: r.epsilon, guide: 'Luma' } }
    }
  }

  // Tone's base: { radius, epsilon } → { Guided: { … } }
  const b = o.base as Record<string, unknown> | null | undefined
  if (b && typeof b === 'object' && 'radius' in b && 'epsilon' in b && !('Guided' in b))
    o.base = { Guided: { radius: b.radius, epsilon: b.epsilon } }

  // 0.21.0: a parametric curve's reach, a grain's response and colour grain.
  const pc = o.ParametricCurve as Record<string, unknown> | null | undefined
  if (pc && typeof pc === 'object' && !('reach' in pc)) pc.reach = 'HalfGap'
  const g = o.Grain as Record<string, unknown> | null | undefined
  if (g && typeof g === 'object') {
    if (!('response' in g)) g.response = 'Midtones'
    if (!('chroma' in g)) g.chroma = { amount: 0, size: 1 }
  }

  for (const k of Object.keys(o)) migrate(o[k])
}
