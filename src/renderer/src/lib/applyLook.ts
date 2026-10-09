/**
 * Applying a look or a saved preset to the open photo: one history step.
 * The rail and the Looks browser both come here.
 *
 * The look applied last stays "applied" while its step is the newest shown
 * one: its Amount scales it (the same step, rewritten), and another look
 * clicked meanwhile takes its place rather than going on top (Alt-click
 * stacks). Hovering a look in the rail shows it on the loupe, unsaved.
 *
 * A smart look (`shared/looks/smart.ts`) applies its sliders and the masks
 * it can make at once (ranges, gradients) in that step, then starts its
 * model work (masks from a model, AI steps) in the main process; each part
 * that lands is added to the same step while it is the newest, so the look
 * stays one step that Undo takes off whole.
 */
import { useEffect } from 'react'
import type { Preset } from '../../../shared/ipc'
import { blendLook } from '../../../shared/looks/amount'
import { applyLook, lookFields, needsLens } from '../../../shared/looks/apply'
import type { LookRunEvent, PickAnswer } from '../../../shared/looks/run'
import {
  immediateLayers,
  planSmart,
  previewLayers,
  smartReadiness,
  type SmartPlan,
  type SmartRates,
  type SmartReadiness
} from '../../../shared/looks/smart'
import { assignFields, newId, type Recipe } from '../../../shared/recipe'
import { useDevelop } from '../state/develop'
import { useAiJobs } from '../state/jobs'
import { useLibrary } from '../state/library'
import { runOnEvent, useLooks, type AppliedLook } from '../state/looks'
import { api, errorText } from './api'
import { t } from './i18n'

/** A look's history label: `Look: X` for the catalog's, `Preset: X` for the user's own. */
export const labelOf = (p: Preset): string =>
  p.meta ? t('Look: {{name}}', { name: p.name }) : t('Preset: {{name}}', { name: p.name })

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

/** What this build can do for smart looks; before the main process says, nothing a model does. */
const NO_BUILD = smartReadiness({
  models: false,
  subjectModel: false,
  drunetModel: false,
  enhance: false,
  engine: { sky: false, people: false, sam2: false, detector: false, nafnet: false }
})
export function smartReady(): SmartReadiness {
  return useAiJobs.getState().capabilities?.smart ?? NO_BUILD
}

/** The denoise rate this machine measured (the denoise job remembers it), for time estimates. */
let measured: Partial<SmartRates> | null = null
async function measuredRates(): Promise<Partial<SmartRates>> {
  if (measured) return measured
  const all = await api.app
    .getSetting<Record<string, number>>('ai.denoise.msPerMp')
    .catch(() => null)
  const drunet = all?.['drunet-color']
  measured = typeof drunet === 'number' && drunet > 0 ? { drunetMsPerMp: drunet } : {}
  return measured
}

/** A smart look's plan on the open photo (its frame and this build). */
export async function planOn(p: Preset): Promise<SmartPlan | null> {
  const { session } = useDevelop.getState()
  if (!p.smart || !session) return null
  // What can run now, not what could at launch (a model since downloaded, the engine since up).
  await useAiJobs
    .getState()
    .refresh()
    .catch(() => undefined)
  return planSmart(p.smart, smartReady(), {
    frameWidth: session.frameWidth,
    frameHeight: session.frameHeight,
    rates: await measuredRates()
  })
}

/** Applies, Amounts and landings, one at a time: each reads the step the one before left. */
let applying: Promise<unknown> = Promise.resolve()
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = applying.then(fn)
  applying = run.catch(() => undefined)
  return run
}

export function applyToPhoto(p: Preset, opts: { stack?: boolean } = {}): Promise<boolean> {
  return serial(() => applyNow(p, opts.stack ?? false))
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
  const plan = await planOn(p)
  const now = useDevelop.getState()
  if (now.session?.key !== session.key || !now.recipe) return false
  const swap = stack ? null : currentApplied()
  // The look it takes the place of stops making its masks.
  if (swap?.runId) void api.looks.cancelRun({ runId: swap.runId }).catch(() => undefined)
  const before = swap ? swap.before : now.recipe
  const after = applyLook(before, p, { wb: session, lensResolved: resolved })
  if (plan) after.layers.push(...plan.layers)
  const label = labelOf(p)
  let seq: number | null
  if (swap) {
    useDevelop.setState({ recipe: after, previewing: null })
    seq = await now.amend(swap.seq, label)
  } else seq = await now.replace(after, label)
  // A smart look's masks are its own (scaled by its Amount), not fields to blend.
  const fields = lookFields(before, after).filter(
    (f) => !plan || (f[0] !== 'layers' && f[0] !== 'pixels')
  )
  const runId = seq !== null && plan && plan.ops.length > 0 ? `run-${newId()}` : undefined
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
            fields,
            amount: 100,
            seq,
            layers: Object.fromEntries((plan?.layers ?? []).map((l) => [l.id, l.amount])),
            pixels: {},
            ...(runId ? { runId } : {})
          }
  })
  if (plan && runId) {
    listenToRuns()
    await api.looks.run({ key: session.key, runId, look: p.name, ops: plan.ops })
  }
  if (plan && plan.skipped.length > 0)
    useLibrary
      .getState()
      .say(`${p.name}: ${plan.skipped.map((x) => `${x.name} ${x.why}`).join('; ')}`, 'info')
  return true
}

/** `r` with the applied look at `k` (0…1): its fields blended, its masks and steps scaled. */
function atAmount(r: Recipe, a: AppliedLook, k: number): void {
  assignFields(r, blendLook(a.before, a.after, a.fields, k), a.fields)
  for (const l of r.layers) if (l.id in a.layers) l.amount = Math.round(a.layers[l.id] * k)
  for (const s of r.pixels) if (s.id in a.pixels) s.opacity = Math.round(a.pixels[s.id] * k)
}

/** The applied look at `amount` (0…100), live while a slider moves. */
export function setLookAmount(amount: number, live: boolean): void {
  const a = currentApplied()
  if (!a) return
  useDevelop.getState().edit((r) => atAmount(r, a, amount / 100), live)
  useLooks.setState({ applied: { ...a, amount } })
}

/** The Amount let go: the look's step rewritten to hold it. */
export function commitLookAmount(): void {
  const a = currentApplied()
  if (!a) return
  void serial(async () => {
    const seq = await useDevelop.getState().amend(a.seq, amountLabel(a, a.amount))
    const cur = useLooks.getState().applied
    if (cur?.seq === a.seq) useLooks.setState({ applied: seq === null ? null : { ...cur, seq } })
  })
}

/** Take the applied look off: the photo as it was before it, its masks and steps gone, its step too. */
export function removeLook(): void {
  const a = currentApplied()
  if (!a) return
  if (a.runId) void api.looks.cancelRun({ runId: a.runId }).catch(() => undefined)
  useDevelop.getState().edit((r) => {
    assignFields(r, a.before, a.fields)
    r.layers = r.layers.filter((l) => !(l.id in a.layers))
    r.pixels = r.pixels.filter((s) => !(s.id in a.pixels))
  })
  useLooks.setState({ applied: { ...a, amount: 0 } })
  commitLookAmount()
}

/** Stop the applied look's model work (what has landed stays). */
export function cancelLookRun(): void {
  const a = useLooks.getState().applied
  if (a?.runId) void api.looks.cancelRun({ runId: a.runId }).catch(() => undefined)
}

// ── A smart look's run, as it lands ─────────────────────────────────────────

/** A finished run stays shown this long. */
const RUN_LINGER_MS = 2500
let listening = false

/** Hear runs' events (once, from the first smart look applied). */
export function listenToRuns(): void {
  if (listening) return
  listening = true
  api.looks.onRun(onRunEvent)
}

function onRunEvent(e: LookRunEvent): void {
  useLooks.setState((s) => ({ runs: runOnEvent(s.runs, e) }))
  if (e.kind === 'landed') void serial(() => landed(e))
  else if (e.kind === 'pick') ask(e)
  else if (e.kind === 'end') void serial(async () => ended(e))
}

/** Part of a run changed its photo's recipe in main: shown, and kept in the look's step. */
async function landed(e: Extract<LookRunEvent, { kind: 'landed' }>): Promise<void> {
  const dev = useDevelop.getState()
  if (dev.session?.key !== e.key) return
  const was = dev.recipe
  const s = await api.develop.open(e.key)
  const now = useDevelop.getState()
  if (now.session?.key !== e.key) return
  const recipe = s.recipe
  const a = currentApplied()
  if (!a || a.runId !== e.runId) {
    // The look's step is not the newest any more (an edit, an undo since): a step of its own.
    const look = useLooks.getState().runs[e.runId]?.look ?? t('Look')
    await now.replace(recipe, `${look} · ${e.label}`)
    return
  }
  // New pixel steps are the look's: its Amount scales them from here.
  const pixels = { ...a.pixels }
  for (const step of recipe.pixels)
    if (!(step.id in pixels) && !was?.pixels.some((x) => x.id === step.id))
      pixels[step.id] = step.opacity
  // A mask the run could not make was taken off.
  const layers = Object.fromEntries(
    Object.entries(a.layers).filter(([id]) => recipe.layers.some((l) => l.id === id))
  )
  const next: AppliedLook = { ...a, layers, pixels }
  const k = a.amount / 100
  if (k !== 1) atAmount(recipe, next, k)
  useDevelop.setState({ recipe })
  const seq = await now.amend(a.seq, amountLabel(a, a.amount))
  // The look at full strength now has what landed.
  const after = structuredClone(recipe)
  atAmount(after, next, 1)
  useLooks.setState({ applied: seq === null ? null : { ...next, seq, after } })
}

function ended(e: Extract<LookRunEvent, { kind: 'end' }>): void {
  const run = useLooks.getState().runs[e.runId]
  const a = useLooks.getState().applied
  if (a?.runId === e.runId) {
    const { runId: _done, ...rest } = a
    void _done
    useLooks.setState({ applied: rest })
  }
  const pick = useLooks.getState().pick
  if (pick?.runId === e.runId) {
    useLooks.setState({ pick: null })
    if (useDevelop.getState().tool === 'look-pick') useDevelop.getState().setTool('none')
  }
  if (e.failed.length > 0 && e.phase !== 'cancelled')
    useLibrary
      .getState()
      .say(
        `${run?.look ?? t('The look')}: ${e.failed.map((f) => `${f.label}: ${f.why}`).join('; ')}`,
        'info'
      )
  setTimeout(() => {
    const { [e.runId]: _gone, ...rest } = useLooks.getState().runs
    void _gone
    useLooks.setState({ runs: rest })
  }, RUN_LINGER_MS)
}

/** A run asks the user to point at an object: the loupe's pick tool, on its photo. */
function ask(e: Extract<LookRunEvent, { kind: 'pick' }>): void {
  useLooks.setState({ pick: { runId: e.runId, key: e.key, label: e.label, look: e.look } })
  const dev = useDevelop.getState()
  if (dev.session?.key === e.key) return dev.setTool('look-pick')
  const lib = useLibrary.getState()
  lib.say(
    t('{{look}} needs you to point at the {{label}}', { look: e.look, label: e.label }),
    'info',
    {
      label: t('Show'),
      run: () => {
        lib.setFocus(e.key)
        void useDevelop.getState().open(e.key)
      }
    }
  )
}

/** The user's answer to the pick tool: a click, a box, or skip. */
export function answerPick(a: PickAnswer): void {
  const pick = useLooks.getState().pick
  if (!pick) return
  useLooks.setState({ pick: null })
  if (useDevelop.getState().tool === 'look-pick') useDevelop.getState().setTool('none')
  void api.looks
    .answer(pick.runId, a)
    .catch((err) => useLibrary.getState().say(errorText(err), 'error'))
}

// ── Hover ───────────────────────────────────────────────────────────────────

let hoverTimer: ReturnType<typeof setTimeout> | undefined
/** How long the pointer rests on a look before the loupe shows it, and leaves before it goes. */
const HOVER_IN_MS = 150
const HOVER_OUT_MS = 100

/** Show `p` on the loupe (as clicking it would apply it, its model work aside), after a short rest. */
export function hoverLook(p: Preset, stack = false): void {
  clearTimeout(hoverTimer)
  hoverTimer = setTimeout(() => {
    const { session } = useDevelop.getState()
    const base = lookBase(stack)
    if (!session || !base) return
    // A preview is not looked up for the photo's lens: the profile as the preset has it.
    const shown = applyLook(base, p, { wb: session, lensResolved: 'keep' })
    if (p.smart)
      shown.layers.push(
        ...previewLayers(
          p.id,
          immediateLayers(p.smart, {
            frameWidth: session.frameWidth,
            frameHeight: session.frameHeight
          })
        )
      )
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
