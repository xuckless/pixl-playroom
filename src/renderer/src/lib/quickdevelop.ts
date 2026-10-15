/**
 * ARCHITECTURE — Quick develop's writes (the rules are shared/quickdevelop.ts,
 * main's half main/quickdevelop.ts, the tab views/library/QuickDevelop.tsx).
 *
 * Everything here is a Library batch (lib/batch.ts) on the targets (the
 * selection, else the focused photo; a collapsed stack's cover only), one
 * entry on the Library's undo stack each:
 *
 * - `nudge`: a row's `<` `>` `<<` `>>`, and ⌥↑ ⌥↓ ⌥← ⌥→ anywhere in the
 *   Library. Clicks on one row add up into a burst that ends 1.5 s after
 *   the last, or when the selection changes: clicks made while a write is
 *   on its way are sent together after it, and every write rewrites each
 *   photo's one step for the burst (its total so far). The row shows what
 *   it changed on this selection, until the selection changes or an undo
 *   takes it back.
 * - `applyLookTo`: a look on the targets. Another look picked while the
 *   last is still the newest entry, on the same photos, takes its place;
 *   Alt stacks it. `setLookAmount` rewrites the look's steps at the Amount
 *   let go. The Amount locks once anything else is done or the selection
 *   changes.
 * - `autoToneTargets`, and Auto white balance (lib/autowb.ts).
 */
import { create } from 'zustand'
import type { Preset } from '../../../shared/ipc'
import { onTop, type StepRef } from '../../../shared/libraryundo'
import {
  lookLabel,
  lookLive,
  needsModels,
  nudgeLabel,
  readout,
  readoutEntries,
  ROW_BY_ID,
  targetsSummary,
  type NudgeId,
  type QuickDelta,
  type TargetsSummary
} from '../../../shared/quickdevelop'
import { nextId, useLibrary } from '../state/library'
import { useLibraryUndo } from '../state/libraryUndo'
import { useUi } from '../state/ui'
import { api } from './api'
import { runRecipeBatch, type BatchOutcome, type RecipeBatch } from './batch'
import { t, tk, tp } from './i18n'

/** A burst ends this long after its last click. */
export const BURST_MS = 1500
/** Auto tone measures a few photos per call, as Auto white balance does. */
const AUTO_CHUNK = 4

/** The look a batch put on the targets, while it can be swapped or scaled. */
export interface QuickLook {
  batchId: string
  look: Preset
  amount: number
  /** The targets it went on. */
  sig: string
  /** Each photo's step. */
  steps: StepRef[]
  /**
   * Set when every step was rewritten to nothing (Amount 0) and its entry
   * went: the entry that was under it (null, none). It stays live while that
   * is still the newest.
   */
  below?: string | null
}

interface QuickState {
  /** The targets the readouts belong to. */
  sig: string
  /** What each row changed on them so far. */
  readouts: QuickDelta
  /** The undo entries behind the readouts: one undone, and they start again. */
  entries: string[]
  look: QuickLook | null
  /**
   * The look's batch being rewritten (its Amount, a swap): it stays live
   * meanwhile, though its entry may go and come back before `look` follows.
   */
  rewriting: string | null
}

export const useQuick = create<QuickState>(() => ({
  sig: '',
  readouts: {},
  entries: [],
  look: null,
  rewriting: null
}))

/** The targets as one string: the readouts and a look belong to exactly these photos. */
export const sigOf = (keys: readonly string[]): string => keys.join('\n')

/** What Quick develop acts on now. */
export function quickTargets(): string[] {
  return useLibrary.getState().targets()
}

/** The targets counted (RAW, HDR, offline, stacks) from the listing. */
export function summaryOf(keys: readonly string[]): TargetsSummary {
  const l = useLibrary.getState()
  const by = new Map(l.items.map((i) => [i.key, i]))
  return targetsSummary(
    keys.map((k) => by.get(k)),
    l.expandedStacks
  )
}

/** The bursts being written: one whose entry goes came back to where it started. */
const writing = new Set<string>()

/** An undo or redo took back what the readouts count: they start again. */
useLibraryUndo.subscribe((s) => {
  const q = useQuick.getState()
  if (q.entries.length === 0) return
  const entries = readoutEntries(q.entries, s.done, writing)
  if (!entries) useQuick.setState({ readouts: {}, entries: [] })
  else if (entries !== q.entries) useQuick.setState({ entries })
})

/**
 * Quick develop's writes one after another: a click on another row, or the
 * Amount let go while a nudge is written, waits its turn rather than being
 * refused as a batch still running.
 */
let queue: Promise<unknown> = Promise.resolve()
function inTurn<T>(fn: () => Promise<T>): Promise<T> {
  const p = queue.then(fn, fn)
  queue = p.catch(() => undefined)
  return p
}

/** "3 stacks: covers only", "2 held at the slider's end": what a toast adds. */
function notes(sum: TargetsSummary, o: BatchOutcome): string {
  const out: string[] = []
  if (o.limited.length > 0)
    out.push(
      tp(
        '{{count}} held at the slider’s end',
        '{{count}} held at the slider’s end',
        o.limited.length
      )
    )
  if (sum.stacks > 0)
    out.push(tp('{{count}} stack: cover only', '{{count}} stacks: covers only', sum.stacks))
  return out.length ? ` · ${out.join(' · ')}` : ''
}

// ── nudges ──────────────────────────────────────────────────────────────────

interface Burst {
  id: string
  row: NudgeId
  keys: string[]
  sig: string
  mixed: boolean
  /** Its change so far, and as far as it has been written. */
  total: number
  sent: number
  steps: StepRef[]
  started: boolean
  inflight: boolean
  timer: ReturnType<typeof setTimeout> | undefined
}

let burst: Burst | null = null

/** The burst a click on `row` adds to: the one going on, or a new one. */
function burstFor(row: NudgeId, keys: string[]): Burst {
  const sig = sigOf(keys)
  const b = burst
  const goingOn =
    b &&
    b.row === row &&
    b.sig === sig &&
    // Anything else done since (an undo, a paste) ends it.
    (!b.started || onTop(useLibraryUndo.getState(), b.id))
  if (goingOn) return b
  if (b) clearTimeout(b.timer)
  const fresh: Burst = {
    id: nextId(),
    row,
    keys,
    sig,
    mixed: summaryOf(keys).mixed,
    total: 0,
    sent: 0,
    steps: [],
    started: false,
    inflight: false,
    timer: undefined
  }
  burst = fresh
  return fresh
}

/**
 * Nudge `row` on the targets: `dir` a step up or down, `big` the big step
 * (`<<` `>>`, ⇧ with the keys).
 */
export function nudge(row: NudgeId, dir: 1 | -1, big = false): void {
  const keys = quickTargets()
  const lib = useLibrary.getState()
  if (keys.length === 0) return lib.say(t('Select photos first'))
  const r = ROW_BY_ID.get(row)
  if (!r) return
  const b = burstFor(row, keys)
  const step = dir * (big ? r.large : r.small)
  b.total += step
  const q = useQuick.getState()
  const fresh = q.sig !== b.sig
  useQuick.setState({
    sig: b.sig,
    readouts: { ...(fresh ? {} : q.readouts), [row]: ((fresh ? 0 : q.readouts[row]) ?? 0) + step },
    entries: fresh ? [] : q.entries,
    // A look's Amount is locked by anything done after it.
    look: fresh ? null : q.look
  })
  clearTimeout(b.timer)
  b.timer = setTimeout(() => {
    if (burst === b) burst = null
  }, BURST_MS)
  if (!b.inflight) {
    b.inflight = true
    void inTurn(() => send(b))
  }
}

/** Write the burst's total so far; clicks made meanwhile go in the next write. */
async function send(b: Burst): Promise<void> {
  try {
    while (b.total !== b.sent) {
      if (b.started && !onTop(useLibraryUndo.getState(), b.id)) {
        // Something else was done between two writes: the clicks still to
        // send are a burst of their own, on top of it.
        b.id = nextId()
        b.total -= b.sent
        b.sent = 0
        b.steps = []
        b.started = false
      }
      const total = b.total
      const r = ROW_BY_ID.get(b.row)
      if (!r) return
      const delta: QuickDelta = { [b.row]: total }
      const prior = b.steps
      const value = readout(b.row, total, b.mixed)
      const sum = summaryOf(b.keys)
      const id = b.id
      writing.add(id)
      const o = await runRecipeBatch({
        keys: b.keys,
        id: b.id,
        continues: b.started,
        quiet: true,
        label: nudgeLabel(b.row, total, b.mixed),
        title: `${t(r.label)} ${value}`,
        busy: t('Quick develop'),
        write: (part, tag) => {
          const want = new Set(part)
          return api.library.nudge(
            part,
            delta,
            tag,
            prior.filter((s) => want.has(s.key))
          )
        },
        said: (n, o) =>
          tp('{{what}} on {{count}} photo', '{{what}} on {{count}} photos', n, {
            what: `${t(r.label)} ${value}`
          }) + notes(sum, o)
      }).finally(() => writing.delete(id))
      if (!o) {
        // Not written (another batch was running): the clicks not sent are dropped.
        const q = useQuick.getState()
        if (q.sig === b.sig)
          useQuick.setState({
            readouts: { ...q.readouts, [b.row]: (q.readouts[b.row] ?? 0) - (b.total - b.sent) }
          })
        b.total = b.sent
        return
      }
      b.started = true
      b.sent = total
      b.steps = o.entry.steps
      const q = useQuick.getState()
      if (q.sig === b.sig && o.entry.steps.length > 0 && !q.entries.includes(b.id))
        useQuick.setState({ entries: [...q.entries, b.id] })
    }
  } finally {
    b.inflight = false
  }
}

/** The targets changed: the burst ends, and the readouts start again. */
export function endBurst(): void {
  if (burst) clearTimeout(burst.timer)
  burst = null
}

// ── looks ───────────────────────────────────────────────────────────────────

/** A look's name in the language shown (a preset the user saved keeps theirs). */
export const lookName = (p: Preset): string => (p.builtin ? t(p.name) : p.name)

/** The look batch on these targets that can still be swapped or scaled, if any. */
export function liveLook(keys: readonly string[]): QuickLook | null {
  const l = useQuick.getState().look
  if (!l || l.sig !== sigOf(keys) || !lookLive(l, useLibraryUndo.getState().done)) return null
  return l
}

async function writeLook(
  p: Preset,
  amount: number,
  keys: string[],
  swap: QuickLook | null
): Promise<void> {
  const sum = summaryOf(keys)
  const name = lookName(p)
  const prior = swap?.steps ?? []
  if (swap) useQuick.setState({ rewriting: swap.batchId })
  const o = await writeLookBatch({
    keys,
    id: swap?.batchId,
    continues: !!swap,
    quiet: !!swap,
    label: lookLabel(p, amount),
    title: amount === 100 ? name : `${name} · ${amount}%`,
    busy: t('Applying {{look}}', { look: name }),
    // The photos before the look, a Version to step back to (a swap keeps the first's).
    version: swap ? undefined : { name: `${tk('Before look')}: ${p.name}`, reason: 'look' },
    write: (part, tag) => {
      const want = new Set(part)
      return api.library.applyLook(
        part,
        p.id,
        amount,
        tag,
        prior.filter((s) => want.has(s.key))
      )
    },
    // At 0 a look's every step is gone: the photos are as they were before it.
    unchanged: amount === 0 ? t('{{look}} at 0%', { look: name }) : undefined,
    said: (n, o) =>
      tp('{{look}} on {{count}} photo', '{{look}} on {{count}} photos', n, {
        look: amount === 100 ? name : `${name} · ${amount}%`
      }) +
      (p.smart && needsModels(p.smart)
        ? ` · ${t('its AI parts left out: apply it in Develop for those')}`
        : '') +
      notes(sum, o)
  })
  // The look follows in the same change as `rewriting` ends: never a moment locked.
  if (!o) return useQuick.setState({ rewriting: null })
  const sig = sigOf(keys)
  if (o.entry.steps.length === 0) {
    // At 0 every step is gone, and so its entry: the Amount can still bring it back.
    const below = useLibraryUndo.getState().done.at(-1)?.id ?? null
    return useQuick.setState({
      rewriting: null,
      ...(swap ? { look: { ...swap, look: p, amount, steps: [], below } } : {})
    })
  }
  const q = useQuick.getState()
  useQuick.setState({
    rewriting: null,
    look: { batchId: o.entry.id, look: p, amount, sig, steps: o.entry.steps },
    ...(q.sig === sig ? {} : { sig, readouts: {}, entries: [] })
  })
}

/** A look's batch; a failure to start it ends `rewriting` too. */
async function writeLookBatch(b: RecipeBatch): Promise<BatchOutcome | null> {
  try {
    return await runRecipeBatch(b)
  } catch (err) {
    useQuick.setState({ rewriting: null })
    throw err
  }
}

/**
 * `p` on the targets: in place of the look put on them last while it can
 * still be swapped, or (`stack`, Alt) on top of whatever they have.
 */
export async function applyLookTo(p: Preset, opts: { stack?: boolean } = {}): Promise<void> {
  const keys = quickTargets()
  if (keys.length === 0) return useLibrary.getState().say(t('Select photos first'))
  endBurst()
  useUi.getState().noteRecentLook(p.id)
  // Whether it swaps is asked in its turn: a nudge written meanwhile locks the last look.
  await inTurn(() => writeLook(p, 100, keys, opts.stack ? null : liveLook(keys)))
}

/** Counts the Amounts let go: one waiting its turn while a newer one came is not written. */
let amountAsks = 0

/** The look's Amount let go: every photo's step rewritten at `amount` (0…100). */
export function setLookAmount(amount: number): Promise<void> {
  const ask = ++amountAsks
  return inTurn(async () => {
    if (ask !== amountAsks) return
    const keys = quickTargets()
    const live = liveLook(keys)
    if (!live || live.amount === Math.round(amount)) return
    await writeLook(live.look, Math.round(amount), keys, live)
  })
}

// ── Auto ────────────────────────────────────────────────────────────────────

/** Auto tone on the targets, each photo measured on its own. */
export async function autoToneTargets(keys = quickTargets()): Promise<void> {
  if (keys.length === 0) return useLibrary.getState().say(t('Select photos first'))
  endBurst()
  const sum = summaryOf(keys)
  await runRecipeBatch({
    keys,
    label: tk('Auto tone'),
    title: t('Auto tone'),
    busy: t('Auto tone'),
    chunk: AUTO_CHUNK,
    write: (part, tag) => api.library.autoTone(part, tag),
    said: (n, o) =>
      tp('Auto tone on {{count}} photo', 'Auto tone on {{count}} photos', n) + notes(sum, o)
  })
}
