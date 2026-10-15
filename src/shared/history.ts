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
import type { HistoryAmend, HistoryAppend, HistoryLog } from './ipc'
import { GROUP_LABELS, type Recipe, type RecipeGroup } from './recipe'
import { activeSteps, stackSignature } from './pixels'

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
  /** Not in effect: undone, or (before linear Undo) hidden by hand. */
  hidden: boolean
  /** Taken back by Undo (stored `hidden = 2`): Redo can bring it back while nothing came after it. */
  undone?: true
}

/**
 * Whether Redo has something to bring back: an undone step with no step in
 * effect after it (a new edit after an Undo ends what can be redone; the
 * undone steps stay stored, as the record of what was done).
 */
export function canRedo(steps: readonly Step[]): boolean {
  for (let i = steps.length - 1; i >= 0; i--) {
    if (!steps[i].hidden) return false
    if (steps[i].undone) return true
  }
  return false
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
  // A mask's components, the point colours among its settings, and a
  // brush's strokes (a step adds its stroke, not the brush's every stroke).
  if (path[0] !== 'layers' || typeof path[1] === 'string') return false
  return (
    (path.length === 3 && path[2] === 'components') ||
    (path.length === 4 && path[2] === 'settings' && path[3] === 'pointColors') ||
    (path.length === 5 &&
      path[2] === 'components' &&
      typeof path[3] !== 'string' &&
      path[4] === 'strokes')
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

/** `log` with an append laid on it: the folded steps gone, the new base, the step. */
export function appendToLog(log: HistoryLog, a: HistoryAppend): HistoryLog {
  if (!a.step && !a.base) return log
  const folded = new Set(a.folded)
  const steps = folded.size > 0 ? log.steps.filter((s) => !folded.has(s.seq)) : log.steps
  return {
    base: a.base ?? log.base,
    steps: a.step ? [...steps, a.step] : steps
  }
}

/** `log` with its newest step rewritten (or dropped) as `HistoryTable.amendLast` did. */
export function amendLog(log: HistoryLog, a: HistoryAmend): HistoryLog {
  const steps = log.steps.filter((s) => s.seq !== a.seq)
  return { ...log, steps: a.step ? [...steps, a.step] : steps }
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

// ── the timeline (History's view: panels/HistoryPane.tsx) ───────────────────

/** What a step touched, as a key: its op paths (entities by id), sorted. Steps of one control share it. */
export function controlKey(patch: Patch): string {
  return patch
    .map((op) => op.path.map((s) => (typeof s === 'string' ? s : `#${s.id}`)).join('.'))
    .sort()
    .join('|')
}

/** One row of the timeline: a step, or a run of steps on the same control merged. */
export interface TimelineRow {
  /** The steps it stands for, oldest first (the last is where clicking it goes back to). */
  seqs: number[]
  label: string
  /** When its first and its last step were made. */
  firstAt: string
  at: string
  /** A single slider's value before the first step and after the last, when that is what it moved. */
  from?: number
  to?: number
  /** The pixel steps laid on after it (`stackSignature`): a moment whose differ from today's. */
  pixels: string
}

/** One editing session: steps with no long pause between them. */
export interface TimelineSession {
  start: string
  end: string
  /** Oldest first. */
  rows: TimelineRow[]
  /** The history's start ("Opened") is in this session. */
  opened: boolean
}

export interface TimelineOptions {
  /** A pause longer than this starts a new session. */
  gapMs: number
  /** Steps on the same control closer than this merge into one row. */
  mergeMs: number
}

export const TIMELINE: TimelineOptions = { gapMs: 30 * 60_000, mergeMs: 10 * 60_000 }

/** The value at a path of plain keys, if it is a number. */
function numberAt(o: unknown, path: Seg[]): number | undefined {
  let v = o
  for (const s of path) {
    if (typeof s !== 'string' || !isObj(v)) return undefined
    v = v[s]
  }
  return typeof v === 'number' ? v : undefined
}

/**
 * The history as a short timeline: the steps in effect (undone and hidden
 * ones left out), a run of changes to one control merged into one row
 * ("Exposure 0 → +0.6", 12 drags), split into sessions at long pauses.
 * One pass, the recipe patched in place as it goes.
 */
export function groupTimeline(
  log: Pick<HistoryLog, 'base' | 'steps'>,
  opts: TimelineOptions = TIMELINE
): TimelineSession[] {
  if (!log.base) return []
  const running = structuredClone(log.base.recipe) as unknown as Obj
  const sessions: TimelineSession[] = [
    { start: log.base.at, end: log.base.at, rows: [], opened: true }
  ]
  let lastKey = ''
  // Rows a delete in effect took out: applied (later values follow them), not shown.
  const gone = new Set<number>()
  for (const s of log.steps) if (!s.hidden) for (const d of deletedSeqs(s.label) ?? []) gone.add(d)
  for (const s of log.steps) {
    if (s.hidden) continue
    if (gone.has(s.seq)) {
      for (const op of s.patch) applyOp(running, op)
      continue
    }
    const session = sessions[sessions.length - 1]
    const t = Date.parse(s.at)
    if (t - Date.parse(session.end) > opts.gapMs)
      sessions.push({ start: s.at, end: s.at, rows: [], opened: false })
    const here = sessions[sessions.length - 1]
    // One plain slider moved: its value before and after.
    const single = s.patch.length === 1 && 'value' in s.patch[0] ? s.patch[0] : null
    const from = single ? numberAt(running, single.path) : undefined
    for (const op of s.patch) applyOp(running, op)
    const to = single ? numberAt(running, single.path) : undefined
    const pixels = stackSignature(activeSteps((running as unknown as Recipe).pixels ?? []))
    const key = `${s.label}\n${controlKey(s.patch)}`
    const prev = here.rows[here.rows.length - 1]
    if (prev && key === lastKey && t - Date.parse(prev.at) <= opts.mergeMs) {
      prev.seqs.push(s.seq)
      prev.at = s.at
      prev.pixels = pixels
      if (prev.to !== undefined && to !== undefined) prev.to = to
    } else
      here.rows.push({
        seqs: [s.seq],
        label: s.label,
        firstAt: s.at,
        at: s.at,
        pixels,
        ...(from !== undefined && to !== undefined ? { from, to } : {})
      })
    lastKey = key
    here.end = s.at
  }
  return sessions
}

// ── Deleting a change ────────────────────────────────────────────────────────
//
// Deleting a row of History takes its change out of the photo and keeps
// everything after it: a new step ("Delete: Exposure") whose recipe is the
// history replayed without the row's steps (and the later steps that reach
// into what they made, a deleted mask's own edits). Undo takes the delete
// back; while it is in effect the timeline leaves the deleted rows out. The
// steps it names ride in its label, after the words shown.

const DELETED = /\s\[#([\d,]+)\]$/

/** The label of the step that deletes `seqs` (shown as "Delete: <label>"). */
export function deleteLabel(label: string, seqs: readonly number[]): string {
  return `Delete: ${label.replace(DELETED, '')} [#${seqs.join(',')}]`
}

/** The steps a delete step's label names, or null for any other label. */
export function deletedSeqs(label: string): number[] | null {
  if (!label.startsWith('Delete: ')) return null
  const m = DELETED.exec(label)
  return m ? m[1].split(',').map(Number) : null
}

/** A label without the steps a delete names: what is shown. */
export const shownLabel = (label: string): string => label.replace(DELETED, '')

/**
 * The photo with `seqs` (the steps of a timeline row) taken out, and every
 * step that goes with them: the later ones reaching into what they made.
 */
export function withoutSteps(
  log: Pick<HistoryLog, 'base' | 'steps'>,
  seqs: readonly number[]
): { recipe: Recipe; removed: number[] } | null {
  if (!log.base) return null
  const removed = new Set(seqs)
  for (const s of seqs) for (const d of dependents(log.steps, s, (x) => !x.hidden)) removed.add(d)
  return {
    recipe: replay(
      log.base.recipe,
      log.steps.filter((s) => !removed.has(s.seq))
    ),
    removed: [...removed].sort((a, b) => a - b)
  }
}

/** The recipe as it was right after step `seq` (the steps in effect up to it; the base for 0). */
export function recipeAt(log: Pick<HistoryLog, 'base' | 'steps'>, seq: number): Recipe | null {
  if (!log.base) return null
  return replay(
    log.base.recipe,
    log.steps.filter((s) => s.seq <= seq)
  )
}
