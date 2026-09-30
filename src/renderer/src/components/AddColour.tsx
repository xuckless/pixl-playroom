/**
 * An added colour's controls, the same in Colour grading, the Effects wash
 * and a mask: its swatch, the two pickers (Neutralise — the complement that
 * turns a picked colour white; Match — what turns one picked colour into
 * another) and its hue, saturation and amount.
 */
import { swatchCss, type AddColourSetting } from '../../../shared/addcolor'
import { addLabel } from '../lib/addpick'
import { useDevelop, type AddTarget } from '../state/develop'
import { Slider, Toggle } from './ui'

const HUE_TRACK = 'linear-gradient(90deg,red,yellow,lime,cyan,blue,magenta,red)'

const sameTarget = (a: AddTarget, b: AddTarget): boolean =>
  typeof a === 'string' || typeof b === 'string' ? a === b : a.layer === b.layer

export function AddColourControl({
  target,
  value,
  onChange,
  hint
}: {
  target: AddTarget
  value: AddColourSetting
  /** Change the setting; `live` while a slider moves. */
  onChange: (next: AddColourSetting, live: boolean) => void
  /** A line under the controls saying what adding means here. */
  hint?: string
}): React.JSX.Element {
  const recipe = useDevelop((s) => s.recipe)
  const commit = useDevelop((s) => s.commit)
  const pick = useDevelop((s) => s.addPick)
  const setAddPick = useDevelop((s) => s.setAddPick)
  const label = addLabel(recipe, target)
  const picking = (mode: 'white' | 'match'): boolean =>
    pick !== null && pick.mode === mode && sameTarget(pick.target, target)
  const toggle = (mode: 'white' | 'match') => (on: boolean) =>
    setAddPick(on ? { target, mode, first: null } : null)
  const slider = (
    key: keyof AddColourSetting,
    name: string,
    max: number,
    track?: string,
    step = 1
  ): React.JSX.Element => (
    <Slider
      label={name}
      value={value[key]}
      min={0}
      max={max}
      step={step}
      def={0}
      track={track}
      format={step < 1 ? (v) => v.toFixed(1) : undefined}
      onChange={(v, live) => onChange({ ...value, [key]: v }, live)}
      onCommit={() => commit(`${label}: ${name}`)}
    />
  )
  return (
    <div className="add-colour">
      <div className="row">
        <span
          className="add-swatch"
          style={{ background: swatchCss(value), opacity: value.amount > 0 ? 1 : 0.35 }}
          title="The colour added"
        />
        <Toggle
          on={picking('white')}
          onChange={toggle('white')}
          title="Click a colour in the photo: add its complement, so it turns neutral"
        >
          ⌖ Neutralise
        </Toggle>
        <Toggle
          on={picking('match')}
          onChange={toggle('match')}
          title="Click a colour, then the colour it should become: add the difference"
        >
          ⌖ Match
        </Toggle>
      </div>
      {slider('hue', 'Hue', 360, HUE_TRACK)}
      {slider(
        'saturation',
        'Saturation',
        100,
        `linear-gradient(90deg,#fff,${swatchCss({ hue: value.hue, saturation: 100 })})`
      )}
      {slider('amount', 'Amount', 100, undefined, 0.1)}
      {hint && <p className="muted small">{hint}</p>}
    </div>
  )
}
