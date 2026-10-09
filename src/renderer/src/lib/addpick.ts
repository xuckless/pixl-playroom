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
import { t } from './i18n'

/** Colour grading adds light; the Effects wash adds to code values (a mask's alike). */
export function addKindOf(target: AddTarget): AddKind {
  return target === 'wash' || (typeof target === 'object' && target.part === 'wash')
    ? 'wash'
    : 'light'
}

/** The settings an added colour lives in: the photo's, or a mask's. */
function holder(r: Recipe, target: AddTarget): Pick<Recipe, 'colorGrade' | 'effects'> | null {
  if (typeof target !== 'object') return r
  return r.layers.find((x) => x.id === target.layer)?.settings ?? null
}

export function readAdd(r: Recipe, target: AddTarget): AddColourSetting | null {
  const h = holder(r, target)
  if (!h) return null
  return addKindOf(target) === 'wash' ? h.effects.wash : h.colorGrade.add
}

export function writeAdd(r: Recipe, target: AddTarget, s: AddColourSetting): void {
  const h = holder(r, target)
  if (!h) return
  if (addKindOf(target) === 'wash') h.effects.wash = { ...s }
  else h.colorGrade.add = { ...s }
}

/** The history label a target's edits go under. */
export function addLabel(r: Recipe | null, target: AddTarget): string {
  const wash = addKindOf(target) === 'wash'
  if (typeof target !== 'object') return wash ? t('Colour wash') : t('Add colour')
  const l = r?.layers.find((x) => x.id === target.layer)
  const mask = l?.name ?? t('Mask')
  return wash ? t('{{mask}}: colour wash', { mask }) : t('{{mask}}: add colour', { mask })
}

/** The picker's instruction for where it is. */
export function addPickHint(mode: 'white' | 'match', first: boolean, goal: string | null): string {
  if (mode === 'white') return t('Click a colour to make neutral')
  if (goal) return t('Click the colour to turn into {{goal}}', { goal })
  return first ? t('Now click the colour it should become') : t('Click the colour to change')
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
    return useLibrary.getState().say(t('Select a mask first'), 'error')
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
    pick.mode === 'white'
      ? t('{{what}}: neutralise', { what: addLabel(recipe, pick.target) })
      : t('{{what}}: match', { what: addLabel(recipe, pick.target) })
  )
  if (clamped) useLibrary.getState().say(t('The colour needed more than the slider reaches'))
  dev.setAddPick(null)
}
