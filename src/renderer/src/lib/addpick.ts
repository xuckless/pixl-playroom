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

/** Colour grading and masks add light; the Effects wash adds to code values. */
export function addKindOf(t: AddTarget): AddKind {
  return t === 'wash' ? 'wash' : 'light'
}

export function readAdd(r: Recipe, t: AddTarget): AddColourSetting | null {
  if (t === 'grade') return r.colorGrade.add
  if (t === 'wash') return r.effects.wash
  const l = r.layers.find((x) => x.id === t.layer)
  return l
    ? { hue: l.adjust.addHue, saturation: l.adjust.addSaturation, amount: l.adjust.addAmount }
    : null
}

export function writeAdd(r: Recipe, t: AddTarget, s: AddColourSetting): void {
  if (t === 'grade') r.colorGrade.add = { ...s }
  else if (t === 'wash') r.effects.wash = { ...s }
  else {
    const l = r.layers.find((x) => x.id === t.layer)
    if (!l) return
    l.adjust.addHue = s.hue
    l.adjust.addSaturation = s.saturation
    l.adjust.addAmount = s.amount
  }
}

/** The history label a target's edits go under. */
export function addLabel(r: Recipe | null, t: AddTarget): string {
  if (t === 'grade') return 'Add colour'
  if (t === 'wash') return 'Colour wash'
  const l = r?.layers.find((x) => x.id === t.layer)
  return `${l?.name ?? 'Mask'}: add colour`
}

/** The picker's instruction for where it is. */
export function addPickHint(mode: 'white' | 'match', first: boolean): string {
  if (mode === 'white') return 'Click a colour to make neutral'
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
  if (pick.mode === 'match' && !pick.first) {
    dev.setAddPick({ ...pick, first: sample })
    return
  }
  const old = readAdd(recipe, pick.target)
  if (!old) {
    dev.setAddPick(null)
    return useLibrary.getState().say('Select a mask first', 'error')
  }
  const add = pick.mode === 'white' ? complementToWhite(sample) : complementTo(pick.first!, sample)
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
