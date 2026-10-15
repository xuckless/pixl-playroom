/**
 * Soft proofing's actions outside the setup: Screen | Proof, a profile
 * located again, and proof copies — a virtual copy for a paper, named for
 * it and carrying its proof, so a print's own edits live apart from the
 * photo's. One from Develop, which opens proofed; or one for each photo of
 * a Library selection, made one at a time (the identity bar shows how far,
 * and can stop it), then one toast whose Undo deletes them.
 */
import type { ProofIssue } from '../../../shared/ipc'
import {
  intentShort,
  locateSettings,
  NOT_A_PROFILE,
  profileName,
  proofCopyName,
  unusableText,
  type FoundProfile,
  type IccProof
} from '../../../shared/proof'
import { useBusy } from '../state/busy'
import { askConfirm } from '../state/confirm'
import { useDevelop } from '../state/develop'
import { useLibrary } from '../state/library'
import { useUi } from '../state/ui'
import { api, errorText } from './api'
import { t, tp } from './i18n'

const JOB = 'proof-copies'
let running = false

/** Why a proof is not shown, in one line. */
export function issueText(issue: ProofIssue): string {
  return issue.kind === 'missing'
    ? t('{{name}} not found', { name: issue.name })
    : unusableText(issue.why ?? NOT_A_PROFILE)
}

/** A profile found on disk, as a proof names it. */
export const asIcc = (f: FoundProfile): IccProof => ({
  sha: f.sha,
  name: f.name,
  path: f.path,
  cls: f.cls,
  space: f.space
})

/**
 * A profile file chosen (Browse…, Locate…) and tried as the proof's, the
 * other settings kept. Null when it is in force; why not, in one line, when
 * it is not (nothing chosen is null too: nothing to say).
 */
export async function chooseProfileFile(): Promise<{ profile: FoundProfile } | string | null> {
  const r = await api.develop.proofBrowse().catch((err: unknown) => ({ error: errorText(err) }))
  if (!r) return null
  if ('error' in r) return unusableText(r.error)
  if (r.profile.use === 'none') return unusableText(r.profile.why ?? NOT_A_PROFILE)
  return { profile: r.profile }
}

/** The proof chip's Locate…: the profile's file chosen again (or another), and proofing back on. */
export async function locateProfile(): Promise<void> {
  const chosen = await chooseProfileFile()
  if (!chosen) return
  if (typeof chosen === 'string') return useLibrary.getState().say(chosen, 'error')
  const d = useDevelop.getState()
  // A proof copy's own intent and paper, when it was its profile that went.
  const base = locateSettings(d.proofIssue, d.session?.proof, useUi.getState().proof)
  const issue = await d.applyProof({ ...base, profile: asIcc(chosen.profile) })
  if (issue) {
    useDevelop.setState({ proofIssue: issue })
    useLibrary.getState().say(issueText(issue), 'error')
  }
}

/** Screen | Proof (⇧Y): proofing turned on first when it is off. */
export async function toggleProofSplit(): Promise<void> {
  const d = useDevelop.getState()
  if (d.compare === 'proof') return d.setCompare('off')
  if (!d.proof) await d.setProof(true)
  if (useDevelop.getState().proof) useDevelop.getState().setCompare('proof')
}

/** The proof copy of the open photo, with the proof in force: selected and opened, proofed. */
export async function makeProofCopy(): Promise<void> {
  const key = useDevelop.getState().session?.key
  const lib = useLibrary.getState()
  if (!key) return
  const proof = useUi.getState().proof
  try {
    const item = await api.library.createCopy(key, { name: proofCopyName(proof.profile), proof })
    await lib.refresh()
    useLibrary.getState().select(item.key, 'only')
    await useDevelop.getState().open(item.key)
    useLibrary.getState().say(t('Proof copy made: {{name}}', { name: item.copyName ?? item.name }))
  } catch (err) {
    lib.say(errorText(err), 'error')
  }
}

/** Delete the copies a batch made (its Undo). */
async function unmake(keys: string[]): Promise<void> {
  const lib = useLibrary.getState()
  try {
    for (const key of keys) await api.library.deleteCopy(key)
    await lib.refresh()
    lib.say(tp('{{count}} proof copy deleted', '{{count}} proof copies deleted', keys.length))
  } catch (err) {
    lib.say(errorText(err), 'error')
  }
}

/**
 * Photo › Make Proof Copies…: a proof copy of each photo selected, with the
 * proof in force (asked first: what it will make, for which paper).
 */
export async function makeProofCopies(keys: string[]): Promise<void> {
  const lib = useLibrary.getState()
  if (keys.length === 0 || running) return
  const proof = useUi.getState().proof
  const yes = await askConfirm({
    title: tp('Make {{count}} proof copy', 'Make {{count}} proof copies', keys.length),
    body: t(
      'Each photo gets a virtual copy named “{{name}}”, proofed with {{profile}} ({{intent}}{{simulate}}). The photos themselves are not changed.',
      {
        name: proofCopyName(proof.profile),
        profile: profileName(proof.profile),
        intent: intentShort(proof.intent),
        simulate: proof.simulate ? `, ${t('paper and ink')}` : ''
      }
    ),
    confirm: t('Make copies')
  })
  if (!yes) return
  running = true
  let stopped = false
  const busy = useBusy.getState()
  const detail = (done: number): string =>
    tp('{{done}} of {{count}} photo', '{{done}} of {{count}} photos', keys.length, { done })
  busy.begin({
    id: JOB,
    title: t('Making proof copies'),
    detail: detail(0),
    progress: 0,
    scope: 'global',
    cancel: () => {
      stopped = true
      busy.update(JOB, { title: t('Stopping proof copies'), cancel: undefined })
    }
  })
  const made: string[] = []
  let error: string | null = null
  try {
    for (const key of keys) {
      if (stopped) break
      const item = await api.library.createCopy(key, {
        name: proofCopyName(proof.profile),
        proof
      })
      made.push(item.key)
      busy.update(JOB, { progress: made.length / keys.length, detail: detail(made.length) })
    }
  } catch (err) {
    error = errorText(err)
  } finally {
    busy.end(JOB)
    running = false
  }
  await lib.refresh().catch(() => undefined)
  if (made.length === 0) {
    if (error) lib.say(error, 'error')
    return
  }
  const parts = [tp('{{count}} proof copy made', '{{count}} proof copies made', made.length)]
  if (error) parts.push(error)
  if (stopped && made.length < keys.length)
    parts.push(
      tp(
        'stopped before {{count}} more',
        'stopped before {{count}} more',
        keys.length - made.length
      )
    )
  useLibrary.getState().say(parts.join(', '), error ? 'error' : 'info', {
    label: t('Undo'),
    run: () => void unmake(made)
  })
}
