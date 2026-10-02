/**
 * Applying a look or a saved preset to the open photo: one history step.
 * The rail and the Looks browser both come here.
 *
 * The look applied last stays "applied" while its step is the newest shown
 * one: its Amount scales it (the same step, rewritten), and another look
 * clicked meanwhile takes its place rather than going on top (Alt-click
 * stacks). Hovering a look in the rail shows it on the loupe, unsaved.
 */
import { useEffect } from 'react'
import type { Preset } from '../../../shared/ipc'
import { blendLook } from '../../../shared/looks/amount'
import { applyLook, lookFields, needsLens } from '../../../shared/looks/apply'
import { assignFields, type Recipe } from '../../../shared/recipe'
import { useDevelop } from '../state/develop'
import { useLooks, type AppliedLook } from '../state/looks'
import { api } from './api'

/** A look's history label: `Look: X` for the catalog's, `Preset: X` for the user's own. */
export const labelOf = (p: Preset): string => `${p.meta ? 'Look' : 'Preset'}: ${p.name}`

/** The step label for an Amount: the look's, with the amount when it is not whole. */
const amountLabel = (a: AppliedLook, amount: number): string =>
  amount === 100 ? a.label : `${a.label} · ${amount}%`

/**
 * The applied look, while it can still be scaled or swapped: on the open
 * photo, its step the newest shown one.
 */
export function currentApplied(): AppliedLook | null {
  const a = useLooks.getState().applied
  const { session, history } = useDevelop.getState()
  if (!a || !session || a.key !== session.key) return null
  const last = history.steps.findLast((s) => !s.hidden)
  return last?.seq === a.seq ? a : null
}

/** `currentApplied`, kept current for a component. */
export function useApplied(): AppliedLook | null {
  useLooks((s) => s.applied)
  useDevelop((s) => s.history)
  useDevelop((s) => s.session)
  return currentApplied()
}

/** What a look goes on: the photo before the applied look (it is swapped), else as it is. */
export function lookBase(stack = false): Recipe | null {
  const a = stack ? null : currentApplied()
  return a ? a.before : useDevelop.getState().recipe
}

/** Applies one at a time: a second click waits for the first's step, so it swaps rather than stacks. */
let applying: Promise<unknown> = Promise.resolve()

export function applyToPhoto(p: Preset, opts: { stack?: boolean } = {}): Promise<boolean> {
  const run = applying.then(() => applyNow(p, opts.stack ?? false))
  applying = run.catch(() => undefined)
  return run
}

async function applyNow(p: Preset, stack: boolean): Promise<boolean> {
  const { session } = useDevelop.getState()
  if (!session) return false
  // A lens profile is this photo's lens's at its focal length and aperture,
  // not the numbers it had where the preset was saved.
  const resolved = needsLens(p)
    ? await api.lens.resolve(session.key, p.recipe.lens.profile.id).then(
        (m) => m.resolved,
        () => null
      )
    : null
  const now = useDevelop.getState()
  if (now.session?.key !== session.key || !now.recipe) return false
  const swap = stack ? null : currentApplied()
  const before = swap ? swap.before : now.recipe
  const after = applyLook(before, p, { wb: session, lensResolved: resolved })
  const label = labelOf(p)
  let seq: number | null
  if (swap) {
    useDevelop.setState({ recipe: after, previewing: null })
    seq = await now.amend(swap.seq, label)
  } else seq = await now.replace(after, label)
  useLooks.setState({
    applied:
      seq === null
        ? null
        : {
            key: session.key,
            lookId: p.id,
            name: p.name,
            label,
            before,
            after,
            fields: lookFields(before, after),
            amount: 100,
            seq
          }
  })
  return true
}

/** The applied look at `amount` (0…100), live while a slider moves. */
export function setLookAmount(amount: number, live: boolean): void {
  const a = currentApplied()
  if (!a) return
  const blended = blendLook(a.before, a.after, a.fields, amount / 100)
  useDevelop.getState().edit((r) => assignFields(r, blended, a.fields), live)
  useLooks.setState({ applied: { ...a, amount } })
}

/** The Amount let go: the look's step rewritten to hold it. */
export function commitLookAmount(): void {
  const a = currentApplied()
  if (!a) return
  const run = applying.then(async () => {
    const seq = await useDevelop.getState().amend(a.seq, amountLabel(a, a.amount))
    const cur = useLooks.getState().applied
    if (cur?.seq === a.seq) useLooks.setState({ applied: seq === null ? null : { ...cur, seq } })
  })
  applying = run.catch(() => undefined)
}

/** Take the applied look off: the photo as it was before it, its step gone. */
export function removeLook(): void {
  if (!currentApplied()) return
  setLookAmount(0, false)
  commitLookAmount()
}

let hoverTimer: ReturnType<typeof setTimeout> | undefined
/** How long the pointer rests on a look before the loupe shows it, and leaves before it goes. */
const HOVER_IN_MS = 150
const HOVER_OUT_MS = 100

/** Show `p` on the loupe (as clicking it would apply it), after a short rest. */
export function hoverLook(p: Preset, stack = false): void {
  clearTimeout(hoverTimer)
  hoverTimer = setTimeout(() => {
    const { session } = useDevelop.getState()
    const base = lookBase(stack)
    if (!session || !base) return
    // A preview is not looked up for the photo's lens: the profile as the preset has it.
    const shown = applyLook(base, p, { wb: session, lensResolved: 'keep' })
    useDevelop.getState().preview(p.name, shown)
  }, HOVER_IN_MS)
}

/** The pointer left a look: the photo again, unless it rests on another first. */
export function leaveLook(now = false): void {
  clearTimeout(hoverTimer)
  const clear = (): void => useDevelop.getState().preview(null, null)
  if (now) return clear()
  hoverTimer = setTimeout(clear, HOVER_OUT_MS)
}

/** A list of hoverable looks: whatever it showed goes when it unmounts. */
export function useLookHoverCleanup(): void {
  useEffect(() => () => leaveLook(true), [])
}
