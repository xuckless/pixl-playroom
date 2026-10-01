/**
 * The edit history as steps: a base recipe (the photo as it was opened) and,
 * for every settled edit, a patch holding only what that edit changed. The
 * picture is the base with every visible step's patch applied in order, so a
 * step anywhere in the history can be hidden, shown again or deleted, and the
 * steps after it keep their own changes. Where two steps set the same field,
 * the later one wins; hiding it reveals the earlier value.
 *
 * Masks, their components and advanced layers are addressed by id, not by
 * position, so a patch still lands on the right mask when an earlier step that
 * added another one is hidden. A step that addresses a mask some earlier step
 * created depends on that step: hiding or deleting the creator takes its
 * dependents with it (see `dependents`), and showing a dependent brings its
 * creators back (see `prerequisites`).
 *
 * Pure: shared by the index (which stores and folds steps) and the renderer
 * (which replays them).
 */
import { GROUP_LABELS, type Recipe, type RecipeGroup } from './recipe'

/** A key into an object, or an entity (mask, component, advanced layer) by id. */
export type Seg = string | { id: string }

export type Op =
  /** Set the value at `path` (an entity path adds or replaces the entity). */
  | { path: Seg[]; value: unknown }
  /** Remove the key or entity at `path`. */
  | { path: Seg[]; del: true }
  /** Reorder the entity list at `path`: these ids first, in this order. */
  | { path: Seg[]; order: string[] }

export type Patch = Op[]

export interface Step {
  seq: number
  label: string
  at: string
  patch: Patch
  hidden: boolean
}

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The entity lists: arrays whose items carry an `id` and are diffed by it. */
function isEntityList(path: Seg[]): boolean {
  if (path.length === 1)
    return (
      path[0] === 'layers' ||
      path[0] === 'custom' ||
      path[0] === 'pointColors' ||
      path[0] === 'retouch' ||
      path[0] === 'pixels'
    )
  // A mask's components, and the point colours among its settings.
  if (path[0] !== 'layers' || typeof path[1] === 'string') return false
  return (
    (path.length === 3 && path[2] === 'components') ||
    (path.length === 4 && path[2] === 'settings' && path[3] === 'pointColors')
  )
}

const idsOf = (list: unknown[]): string[] =>
  list.map((x) => (isObj(x) && typeof x.id === 'string' ? x.id : ''))

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

function diffInto(a: unknown, b: unknown, path: Seg[], out: Patch): void {
  if (isEntityList(path) && Array.isArray(a) && Array.isArray(b)) {
    const beforeIds = idsOf(a)
    const before = new Map(a.map((x, i) => [beforeIds[i], x]))
    const afterIds = idsOf(b)
    for (const id of before.keys()) {
      if (!afterIds.includes(id)) out.push({ path: [...path, { id }], del: true })
    }
    b.forEach((x, i) => {
      const id = afterIds[i]
      if (before.has(id)) diffInto(before.get(id), x, [...path, { id }], out)
      else out.push({ path: [...path, { id }], value: structuredClone(x) })
    })
    // Applying keeps survivors in place and appends new entities; say so
    // only when the result would come out in a different order.
    const kept = beforeIds.filter((id) => afterIds.includes(id))
    const expected = [...kept, ...afterIds.filter((id) => !before.has(id))]
    if (!same(expected, afterIds)) out.push({ path, order: afterIds })
    return
  }
  if (isObj(a) && isObj(b)) {
    for (const k of Object.keys(a)) if (!(k in b)) out.push({ path: [...path, k], del: true })
    for (const k of Object.keys(b)) {
      if (!(k in a)) out.push({ path: [...path, k], value: structuredClone(b[k]) })
      else diffInto(a[k], b[k], [...path, k], out)
    }
    return
  }
  if (!same(a, b)) out.push({ path, value: structuredClone(b) })
}

/** What turns `a` into `b`, field by field. Empty when they are the same. */
export function diffRecipe(a: Recipe, b: Recipe): Patch {
  const out: Patch = []
  diffInto(a, b, [], out)
  return out
}

/** The container a segment names inside `node`, or undefined when it is gone. */
function child(node: unknown, seg: Seg): unknown {
  if (typeof seg === 'string') return isObj(node) ? node[seg] : undefined
  return Array.isArray(node) ? node.find((x) => isObj(x) && x.id === seg.id) : undefined
}

function applyOp(root: Obj, op: Op): void {
  if ('order' in op) {
    const list = op.path.reduce<unknown>(child, root)
    if (!Array.isArray(list)) return
    const rank = new Map(op.order.map((id, i) => [id, i]))
    const ranked = list.filter((x) => rank.has(idsOf([x])[0]))
    ranked.sort((x, y) => rank.get(idsOf([x])[0])! - rank.get(idsOf([y])[0])!)
    const rest = list.filter((x) => !rank.has(idsOf([x])[0]))
    list.splice(0, list.length, ...ranked, ...rest)
    return
  }
  if (op.path.length === 0) return
  const parent = op.path.slice(0, -1).reduce<unknown>(child, root)
  const last = op.path[op.path.length - 1]
  if (typeof last === 'string') {
    // A field of an entity an earlier (now hidden) step added: nothing to change.
    if (!isObj(parent)) return
    if ('del' in op) delete parent[last]
    else parent[last] = structuredClone(op.value)
    return
  }
  if (!Array.isArray(parent)) return
  const at = parent.findIndex((x) => isObj(x) && x.id === last.id)
  if ('del' in op) {
    if (at >= 0) parent.splice(at, 1)
  } else if (at >= 0) parent[at] = structuredClone(op.value)
  else parent.push(structuredClone(op.value))
}

/** `recipe` with `patch` applied; ops whose target is gone are skipped. */
export function applyPatch(recipe: Recipe, patch: Patch): Recipe {
  const out = structuredClone(recipe) as unknown as Obj
  for (const op of patch) applyOp(out, op)
  return out as unknown as Recipe
}

/**
 * The recipe the history describes: the base and every visible step, in
 * order. Cloned once and patched in place (each op clones what it writes),
 * not cloned again per step.
 */
export function replay(base: Recipe, steps: readonly Step[]): Recipe {
  const out = structuredClone(base) as unknown as Obj
  for (const s of steps) if (!s.hidden) for (const op of s.patch) applyOp(out, op)
  return out as unknown as Recipe
}

/** The entity ids a patch adds. */
export function creates(patch: Patch): Set<string> {
  const ids = new Set<string>()
  for (const op of patch) {
    const last = op.path[op.path.length - 1]
    if ('value' in op && last !== undefined && typeof last !== 'string') ids.add(last.id)
  }
  return ids
}

/** The entity ids a patch reaches into (its paths go through or end at them). */
function touches(patch: Patch): Set<string> {
  const ids = new Set<string>()
  for (const op of patch) for (const s of op.path) if (typeof s !== 'string') ids.add(s.id)
  return ids
}

/**
 * The later steps that reach into an entity `seq` created, and theirs in
 * turn: what hiding or deleting `seq` takes with it. `among` limits the
 * search (the visible steps, for a hide).
 */
export function dependents(
  steps: readonly Step[],
  seq: number,
  among: (s: Step) => boolean = () => true
): number[] {
  const i = steps.findIndex((s) => s.seq === seq)
  if (i < 0) return []
  const made = creates(steps[i].patch)
  const out: number[] = []
  for (const s of steps.slice(i + 1)) {
    if (!among(s)) continue
    const own = creates(s.patch)
    const reached = [...touches(s.patch)].some((id) => made.has(id) && !own.has(id))
    if (!reached) continue
    out.push(s.seq)
    for (const id of own) made.add(id)
  }
  return out
}

/**
 * The hidden earlier steps that created what `seq` reaches into, and theirs
 * in turn: what showing `seq` must show too.
 */
export function prerequisites(steps: readonly Step[], seq: number): number[] {
  const i = steps.findIndex((s) => s.seq === seq)
  if (i < 0) return []
  const need = touches(steps[i].patch)
  for (const id of creates(steps[i].patch)) need.delete(id)
  const out: number[] = []
  for (let j = i - 1; j >= 0 && need.size > 0; j--) {
    const made = creates(steps[j].patch)
    if (![...made].some((id) => need.has(id))) continue
    for (const id of made) need.delete(id)
    if (steps[j].hidden) {
      out.push(steps[j].seq)
      for (const id of touches(steps[j].patch)) if (!made.has(id)) need.add(id)
    }
  }
  return out.reverse()
}

const DETAIL_SHARPEN = new Set([
  'sharpenAmount',
  'sharpenRadius',
  'sharpenDetail',
  'sharpenMasking'
])
const GEOMETRY_ORIENTATION = new Set(['quarterTurns', 'flipHorizontal'])

function groupOf(path: Seg[]): RecipeGroup | null {
  const [top, sub] = path
  switch (top) {
    case 'profile':
    case 'profileAmount':
      return 'profile'
    case 'wb':
      return 'whiteBalance'
    case 'basic':
      return 'basicTone'
    case 'hsl':
    case 'bwMix':
    case 'pointColors':
      return 'hsl'
    case 'detail':
      return typeof sub === 'string' && DETAIL_SHARPEN.has(sub) ? 'detailSharpen' : 'detailNoise'
    case 'geometry':
      if (sub === 'upright') return 'upright'
      return typeof sub === 'string' && GEOMETRY_ORIENTATION.has(sub) ? 'orientation' : 'crop'
    case 'layers':
      return 'localAdjustments'
    case 'retouch':
      return 'retouch'
    case 'gainMap':
      return 'hdr'
    case 'presence':
    case 'lens':
    case 'toneCurve':
    case 'colorGrade':
    case 'effects':
    case 'calibration':
    case 'treatment':
    case 'custom':
      return top
    default:
      return null
  }
}

/** The recipe groups a patch changes, as the labels copy and paste use. */
export function patchSummary(patch: Patch): string[] {
  const groups = new Set<RecipeGroup>()
  for (const op of patch) {
    const g = groupOf(op.path)
    if (g) groups.add(g)
  }
  return [...groups].map((g) => GROUP_LABELS[g])
}
