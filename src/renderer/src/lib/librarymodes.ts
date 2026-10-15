/**
 * ARCHITECTURE — the Library's culling views, run (the rules are pure, in
 * shared/cullnav.ts; the views are views/library/LibraryLoupe.tsx,
 * Compare.tsx and Survey.tsx).
 *
 * - **Modes**: Grid (G), Loupe (E; Space toggles Grid ↔ Loupe), Compare (C)
 *   and Survey (N). Esc goes back to the Grid (and in the Grid lets go of
 *   the selection); D or Enter develops the photo shown; E in Develop comes
 *   back to the Loupe on its photo.
 * - **Compare**: the Select is the focus, the Candidate beside it. ← and →
 *   move the Candidate, Tab swaps them, ↑ makes the Candidate the Select and
 *   brings the next. A click picks a pane; the rating keys act on the pane
 *   picked (UX-13, `metaTargets`).
 * - **Survey**: the selection, up to SURVEY_MAX tiles; N on one photo shows
 *   its stack, its burst or the shots nearly the same (shared/shots.ts).
 *   / drops a tile (⌘Z puts it back); X dims it where it is.
 * - **Auto-advance** (off unless chosen: ⇧A, Photo › Auto Advance, the
 *   status bar's chip; Caps Lock flips it while held on, as in Lightroom):
 *   a rating, flag or label on one photo moves on to the next shown, in the
 *   Grid and the Loupe; in Compare, the Candidate moves; never in Survey.
 * - The filmstrip under the views picks without opening Develop (`filmPick`).
 */
import { create } from 'zustand'
import {
  advancing,
  compareStart,
  dropFrom,
  nextOrBefore,
  promoted,
  stepFrom,
  surveyOf,
  SURVEY_MAX,
  type LibraryMode
} from '../../../shared/cullnav'
import type { DropEntry } from '../../../shared/libraryundo'
import { useDevelop } from '../state/develop'
import { nextId, useLibrary } from '../state/library'
import { pushUndo } from '../state/libraryUndo'
import { useUi } from '../state/ui'
import { api, errorText } from './api'
import { t, tp } from './i18n'

const lib = (): ReturnType<typeof useLibrary.getState> => useLibrary.getState()
/** The photos shown, in order. */
const order = (): string[] =>
  lib()
    .visible()
    .map((i) => i.key)

/** Caps Lock as the last key press found it (the status bar's chip shows what is in force). */
export const useCapsLock = create<{ on: boolean }>(() => ({ on: false }))

/** Every key press says whether Caps Lock is down. */
export function noteCapsLock(e: KeyboardEvent): void {
  const on = e.getModifierState?.('CapsLock') === true
  if (on !== useCapsLock.getState().on) useCapsLock.setState({ on })
}

/** Whether a decision moves on now: the toggle, flipped while Caps Lock is down. */
export function advanceInForce(): boolean {
  return advancing(useUi.getState().autoAdvance, useCapsLock.getState().on)
}

/** The photo the keys and Develop act on in this view: Compare's picked pane, else the focus. */
export function shownKey(): string | null {
  const l = lib()
  if (l.mode === 'compare' && l.active === 'candidate') return l.candidate
  return l.focus
}

// ── modes ──

export function goGrid(): void {
  lib().setMode('grid')
}

/** The Loupe on the photo shown (Compare's picked pane), or the first. */
export function goLoupe(): void {
  const l = lib()
  const key = shownKey() ?? order()[0] ?? null
  if (key && key !== l.focus) useLibrary.setState({ focus: key, anchor: key })
  l.setMode('loupe')
}

/** Space: the Grid and the Loupe in turn, as Quick Look does. */
export function toggleLoupe(): void {
  if (lib().mode === 'loupe') goGrid()
  else goLoupe()
}

/** Compare: the two photos selected, else the focus and the next shown. */
export function goCompare(): void {
  const l = lib()
  const start = compareStart(order(), l.selection, l.focus)
  if (!start) return l.say(t('Compare needs two photos'))
  l.setMode('compare')
  useLibrary.setState({ focus: start.select, candidate: start.candidate, active: 'select' })
}

/**
 * Survey: the selection; with one photo (or none) selected, the focus's
 * stack, burst or near shots, which become the selection.
 */
export async function goSurvey(): Promise<void> {
  const l = lib()
  const shown = order()
  if (l.selection.length >= 2) {
    const s = surveyOf(shown, l.selection)
    l.setMode('survey')
    useLibrary.setState({
      survey: s,
      focus: l.focus && s.keys.includes(l.focus) ? l.focus : (s.keys[0] ?? null)
    })
    return
  }
  const key = l.focus
  if (!key) return
  const it = l.items.find((i) => i.key === key)
  let group: { kind: 'burst' | 'near' | 'stack'; keys: string[] } | null = null
  if (it?.stack) {
    const id = it.stack.id
    group = {
      kind: 'stack',
      keys: l.items
        .filter((i) => i.stack?.id === id)
        .sort((a, b) => (a.stack?.position ?? 0) - (b.stack?.position ?? 0))
        .map((i) => i.key)
    }
  } else {
    try {
      group = await api.library.shotGroup(key)
    } catch (err) {
      return l.say(errorText(err), 'error')
    }
  }
  // Only the source's own photos (a collection may hold one shot of a burst).
  const listed = new Set(lib().items.map((i) => i.key))
  const keys = group?.keys.filter((k) => listed.has(k)) ?? []
  if (!group || keys.length < 2)
    return lib().say(t('No burst or similar shots around this photo: select the photos to survey'))
  const s = surveyOf(order(), keys)
  lib().setMode('survey')
  useLibrary.setState({
    survey: { ...s, group: group.kind },
    selection: keys,
    focus: s.keys.includes(key) ? key : (s.keys[0] ?? null),
    anchor: key
  })
}

/** A mode by name (the toolbar's segment, the View menu). */
export function goMode(mode: LibraryMode): void {
  if (mode === 'grid') goGrid()
  else if (mode === 'loupe') goLoupe()
  else if (mode === 'compare') goCompare()
  else void goSurvey()
}

/** Esc: back to the Grid; in the Grid, the selection let go (the focus stays). */
export function goBack(): void {
  const l = lib()
  if (l.mode !== 'grid') return goGrid()
  if (l.selection.length > 0) useLibrary.setState({ selection: [] })
}

/** D or Enter: Develop on the photo shown. */
export function goDevelop(): void {
  const key = shownKey()
  if (!key) return
  lib().setFocus(key)
  lib().setView('develop')
  void useDevelop.getState().open(key)
}

/** E in Develop: the Library's Loupe on the photo Develop shows. */
export function developToLoupe(): void {
  const key = useDevelop.getState().session?.key ?? lib().focus
  if (key) lib().setFocus(key)
  lib().setMode('loupe')
}

// ── Compare ──

export function pickPane(pane: 'select' | 'candidate'): void {
  if (lib().active !== pane) useLibrary.setState({ active: pane })
}

/** ← and → in Compare: the Candidate moves along the photos shown, past the Select. */
export function moveCandidate(dir: 1 | -1): boolean {
  const l = lib()
  const shown = order()
  // (A Candidate just rejected stays shown until it moves on: sticky hide.)
  const to =
    l.candidate && shown.includes(l.candidate)
      ? stepFrom(shown, l.candidate, dir, l.focus)
      : nextOrBefore(shown, l.focus, l.focus)
  if (!to || to === l.focus || to === l.candidate) return false
  useLibrary.setState({ candidate: to })
  return true
}

/** Tab: the Select and the Candidate change places. */
export function swapCompare(): void {
  const { focus, candidate } = lib()
  if (!focus || !candidate) return
  useLibrary.setState({ focus: candidate, candidate: focus, anchor: candidate })
}

/** ↑: the Candidate becomes the Select, the next photo the Candidate. */
export function promoteCandidate(): void {
  const { focus, candidate } = lib()
  if (!focus || !candidate) return
  const p = promoted(order(), focus, candidate)
  if (p) useLibrary.setState({ focus: p.select, candidate: p.candidate, anchor: p.select })
}

/** Compare's photos, made whole again when one went (another source, a filter, Develop's filmstrip). */
export function settleCompare(): void {
  const l = lib()
  if (l.mode !== 'compare') return
  const shown = order()
  const focus = l.focus && l.items.some((i) => i.key === l.focus) ? l.focus : (shown[0] ?? null)
  const listed = l.candidate && l.items.some((i) => i.key === l.candidate)
  const candidate =
    listed && l.candidate !== focus ? l.candidate : nextOrBefore(shown, focus, focus)
  if (!focus || !candidate) return goGrid()
  if (focus !== l.focus || candidate !== l.candidate) useLibrary.setState({ focus, candidate })
}

// ── Survey ──

/** ← and → in Survey: the next tile. */
export function surveyStep(dir: 1 | -1): boolean {
  const l = lib()
  const keys = l.survey?.keys ?? []
  const to = stepFrom(keys, l.focus, dir)
  if (!to) return false
  useLibrary.setState({ focus: to, anchor: to })
  return true
}

/** /: the focused tile out of Survey and out of the selection (⌘Z puts it back). */
export function dropFromSurvey(): void {
  const l = lib()
  const s = l.survey
  const key = l.focus
  if (!s || !key || !s.keys.includes(key)) return
  const at = s.keys.indexOf(key)
  const d = dropFrom(s.keys, key)
  useLibrary.setState({
    survey: { ...s, keys: d.keys, total: Math.max(d.keys.length, s.total - 1) },
    selection: l.selection.filter((k) => k !== key),
    focus: d.focus ?? key
  })
  const entry: DropEntry = {
    kind: 'drop',
    id: nextId(),
    title: t('Drop from Survey'),
    keys: [key],
    at: [at]
  }
  pushUndo(entry)
  if (d.keys.length === 0) goGrid()
}

// ── auto-advance ──

/**
 * After a rating, flag or label on `targets`: the next photo, when
 * auto-advance is in force and one photo was decided (never in Survey).
 */
export function afterDecision(targets: string[]): void {
  const l = lib()
  if (l.view !== 'library' || l.mode === 'survey' || targets.length !== 1) return
  if (!advanceInForce()) return
  if (l.mode === 'compare') {
    moveCandidate(1)
    return
  }
  const next = stepFrom(order(), l.focus, 1)
  if (next) l.setFocus(next)
}

/** ⇧A, Photo › Auto Advance and the status bar's chip. */
export function toggleAutoAdvance(): void {
  const u = useUi.getState()
  u.setAutoAdvance(!u.autoAdvance)
  lib().say(
    !u.autoAdvance
      ? t('Auto advance on: a rating, flag or label moves on to the next photo')
      : t('Auto advance off')
  )
}

// ── ← and → ──

/** The next or previous photo, as the view shown walks them. False when there is none. */
export function stepPhoto(dir: 1 | -1): boolean {
  const l = lib()
  if (l.view === 'library' && l.mode === 'compare') return moveCandidate(dir)
  if (l.view === 'library' && l.mode === 'survey') return surveyStep(dir)
  const next = stepFrom(order(), l.focus, dir)
  if (!next) return false
  l.setFocus(next)
  if (l.view === 'develop') void useDevelop.getState().open(next)
  return true
}

// ── the filmstrip under the views ──

/** A click on the filmstrip in the Loupe, Compare or Survey: it picks, never opens Develop. */
export function filmPick(key: string, e: React.MouseEvent): void {
  const l = lib()
  if (e.shiftKey || e.metaKey || e.ctrlKey) {
    l.select(key, e.shiftKey ? 'range' : 'toggle')
    // Survey shows the selection: it follows.
    if (l.mode === 'survey' && !l.survey?.group) {
      const s = surveyOf(order(), lib().selection)
      useLibrary.setState({ survey: s })
    }
    return
  }
  if (l.mode === 'compare') {
    if (key === l.focus) return pickPane('select')
    if (key === l.candidate) return pickPane('candidate')
    if (l.active === 'candidate') useLibrary.setState({ candidate: key })
    else useLibrary.setState({ focus: key, anchor: key })
    return
  }
  if (l.mode === 'survey' && l.survey) {
    const s = l.survey
    if (s.keys.includes(key)) {
      useLibrary.setState({ focus: key, anchor: key })
      return
    }
    if (s.keys.length >= SURVEY_MAX)
      return l.say(
        tp(
          'Survey shows {{count}} photo at most: drop one first (/)',
          'Survey shows {{count}} photos at most: drop one first (/)',
          SURVEY_MAX
        )
      )
    useLibrary.setState({
      survey: { ...s, keys: [...s.keys, key], total: s.total + 1 },
      selection: l.selection.includes(key) ? l.selection : [...l.selection, key],
      focus: key,
      anchor: key
    })
    return
  }
  l.select(key, 'only')
}
