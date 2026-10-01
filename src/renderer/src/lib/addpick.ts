/**
 * Additive colour in the develop view: where each added colour lives in the
 * recipe, and the picker that works one out from the picture on screen
 * (see `shared/addcolor.ts` for what the numbers mean).
 */
import {
  afterPick,
  complementTo,
  complementToWhite,
  sampleIn,
  type AddColourSetting,
  type AddKind,
  type Vec3
} from '../../../shared/addcolor'
import type { Recipe } from '../../../shared/recipe'
import { useDevelop, type AddTarget } from '../state/develop'
import { useLibrary } from '../state/library'

/** Colour grading adds light; the Effects wash adds to code values (a mask's alike). */
export function addKindOf(t: AddTarget): AddKind {
  return t === 'wash' || (typeof t === 'object' && t.part === 'wash') ? 'wash' : 'light'
}

/** The settings an added colour lives in: the photo's, or a mask's. */
function holder(r: Recipe, t: AddTarget): Pick<Recipe, 'colorGrade' | 'effects'> | null {
  if (typeof t !== 'object') return r
  return r.layers.find((x) => x.id === t.layer)?.settings ?? null
}

export function readAdd(r: Recipe, t: AddTarget): AddColourSetting | null {
  const h = holder(r, t)
  if (!h) return null
  return addKindOf(t) === 'wash' ? h.effects.wash : h.colorGrade.add
}

export function writeAdd(r: Recipe, t: AddTarget, s: AddColourSetting): void {
  const h = holder(r, t)
  if (!h) return
  if (addKindOf(t) === 'wash') h.effects.wash = { ...s }
  else h.colorGrade.add = { ...s }
}

/** The history label a target's edits go under. */
export function addLabel(r: Recipe | null, t: AddTarget): string {
  const what = addKindOf(t) === 'wash' ? 'Colour wash' : 'Add colour'
  if (typeof t !== 'object') return what
  const l = r?.layers.find((x) => x.id === t.layer)
  return `${l?.name ?? 'Mask'}: ${what.toLowerCase()}`
}

/** The picker's instruction for where it is. */
export function addPickHint(mode: 'white' | 'match', first: boolean, goal: string | null): string {
  if (mode === 'white') return 'Click a colour to make neutral'
  if (goal) return `Click the colour to turn into ${goal}`
  return first ? 'Now click the colour it should become' : 'Click the colour to change'
}

/**
 * One click of the picker, with the shown picture's colour there (Display
 * P3 code values). "Neutralise" adds the complement that turns it white;
 * "Match" takes two clicks and adds what turns the first into the second.
 * Either adds to what the target already adds, so a second pick refines.
 */
export function pickAdd(p3: Vec3): void {
  const dev = useDevelop.getState()
  const pick = dev.addPick
  const recipe = dev.recipe
  if (!pick || !recipe) return
  const kind = addKindOf(pick.target)
  const sample = sampleIn(p3, kind)
  const goal = pick.goal ? sampleIn(pick.goal, kind) : null
  if (pick.mode === 'match' && !pick.first && !goal) {
    dev.setAddPick({ ...pick, first: sample })
    return
  }
  const old = readAdd(recipe, pick.target)
  if (!old) {
    dev.setAddPick(null)
    return useLibrary.getState().say('Select a mask first', 'error')
  }
  const add =
    pick.mode === 'white'
      ? complementToWhite(sample)
      : goal
        ? complementTo(sample, goal)
        : complementTo(pick.first!, sample)
  const { clamped, ...next } = afterPick(old, add, kind)
  const r = structuredClone(recipe)
  writeAdd(r, pick.target, next)
  dev.replace(
    r,
    `${addLabel(recipe, pick.target)}: ${pick.mode === 'white' ? 'neutralise' : 'match'}`
  )
  if (clamped) useLibrary.getState().say('The colour needed more than the slider reaches')
  dev.setAddPick(null)
}
