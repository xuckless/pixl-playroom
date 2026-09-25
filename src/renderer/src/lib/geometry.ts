import { orientedFrame } from '../../../shared/compile'
import type { Recipe } from '../../../shared/recipe'
import { useDevelop } from '../state/develop'
import { ASPECTS } from './aspects'

/** Framing actions shared by the Crop & rotate panel and the crop tool's bar; each records a history step. */
function change(label: string, f: (g: Recipe['geometry']) => Recipe['geometry']): void {
  const { recipe, replace } = useDevelop.getState()
  if (!recipe) return
  replace({ ...recipe, geometry: f(recipe.geometry) }, label)
}

export const rotateLeft = (): void =>
  change('Rotate left', (g) => ({ ...g, quarterTurns: (g.quarterTurns + 3) % 4, crop: null }))
export const rotateRight = (): void =>
  change('Rotate right', (g) => ({ ...g, quarterTurns: (g.quarterTurns + 1) % 4, crop: null }))
export const flip = (): void => change('Flip', (g) => ({ ...g, flipHorizontal: !g.flipHorizontal }))
export const resetCrop = (): void =>
  change('Reset crop', (g) => ({ ...g, crop: null, straighten: 0 }))

export function setAspect(value: string): void {
  const { recipe, session } = useDevelop.getState()
  if (!recipe || !session) return
  const a = ASPECTS.find((x) => x.value === value)
  // "Original" is the frame as the user has turned it, not the file's.
  const o = orientedFrame(recipe, session.frameWidth, session.frameHeight)
  const ratio = a?.ratio === -1 ? o.width / o.height : (a?.ratio ?? null)
  change(`Aspect ${a?.label}`, (g) => ({ ...g, aspect: ratio, crop: null }))
}
