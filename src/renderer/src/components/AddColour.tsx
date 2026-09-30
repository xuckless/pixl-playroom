/**
 * An added colour's controls, the same in Colour grading, the Effects wash
 * and a mask: its swatch, the two pickers (Neutralise — the complement that
 * turns a picked colour white; Match — what turns one colour into another,
 * the target chosen on a wheel or as a hex, or picked in the photo too) and
 * its hue, saturation and amount.
 */
import { useRef, useState } from 'react'
import {
  hsvToRgb,
  parseHex,
  rgbToHsv,
  srgbToP3,
  swatchCss,
  toHex,
  type AddColourSetting,
  type Vec3
} from '../../../shared/addcolor'
import { addLabel } from '../lib/addpick'
import { useDevelop, type AddTarget } from '../state/develop'
import { ColorWheel } from './editors'
import { Popover } from './Popover'
import { Slider, Toggle } from './ui'

/** The last target colour chosen, offered again next time (sRGB code values). */
let lastGoal: Vec3 = [0.36, 0.62, 0.66]

/**
 * Match's target: a colour on a wheel with its brightness, or typed as a hex
 * (sRGB, as hexes are). Then one click in the photo picks the colour that
 * should become it — or both are picked in the photo.
 */
function MatchTarget({
  onPickOne,
  onPickBoth,
  onClose,
  anchor
}: {
  onPickOne: (goal: Vec3, hex: string) => void
  onPickBoth: () => void
  onClose: () => void
  anchor: React.RefObject<HTMLButtonElement | null>
}): React.JSX.Element {
  const [hsv, setHsv] = useState(() => rgbToHsv(lastGoal))
  const rgb = hsvToRgb(hsv.hue, hsv.saturation).map((c) => c * hsv.value) as Vec3
  const hex = toHex(rgb)
  const [text, setText] = useState(hex)
  const [typing, setTyping] = useState(false)
  const set = (next: typeof hsv): void => {
    setHsv(next)
    setTyping(false)
  }
  return (
    <Popover onClose={onClose} anchor={anchor} className="match-pop">
      <div className="micro muted">Match to a colour</div>
      <ColorWheel
        label="Target"
        size={132}
        luminance={false}
        value={{
          hue: Math.round(hsv.hue),
          saturation: Math.round(hsv.saturation * 100),
          luminance: 0
        }}
        onChange={(w) => set({ ...hsv, hue: w.hue, saturation: w.saturation / 100 })}
        onCommit={() => undefined}
      />
      <Slider
        label="Brightness"
        value={Math.round(hsv.value * 100)}
        min={0}
        max={100}
        def={100}
        track={`linear-gradient(90deg,#000,${swatchCss({ hue: hsv.hue, saturation: hsv.saturation * 100 })})`}
        onChange={(v) => set({ ...hsv, value: v / 100 })}
        onCommit={() => undefined}
      />
      <div className="row match-hex">
        <span className="add-swatch" style={{ background: hex }} />
        <input
          className="hex"
          spellCheck={false}
          aria-label="Target colour as a hex"
          value={typing ? text : hex}
          onChange={(e) => {
            setTyping(true)
            setText(e.target.value)
            const c = parseHex(e.target.value)
            if (c) setHsv(rgbToHsv(c))
          }}
          onBlur={() => setTyping(false)}
          onKeyDown={(e) => e.key === 'Enter' && setTyping(false)}
        />
      </div>
      <button
        className="primary sm"
        onClick={() => {
          lastGoal = rgb
          onPickOne(srgbToP3(rgb), hex)
        }}
      >
        ⌖ Pick the colour to change
      </button>
      <button className="sm ghost" onClick={onPickBoth}>
        Pick both in the photo
      </button>
    </Popover>
  )
}

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
  const [matching, setMatching] = useState(false)
  const matchButton = useRef<HTMLButtonElement>(null)
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
        <button
          ref={matchButton}
          className={`toggle ${picking('match') || matching ? 'on' : ''}`}
          title="Turn one colour into another: choose the target on a wheel or as a hex, or pick it in the photo"
          onClick={() => {
            if (picking('match')) return setAddPick(null)
            setMatching(!matching)
          }}
        >
          ⌖ Match
        </button>
        {matching && (
          <MatchTarget
            anchor={matchButton}
            onClose={() => setMatching(false)}
            onPickOne={(goal, hex) => {
              setMatching(false)
              setAddPick({ target, mode: 'match', first: null, goal, goalHex: hex })
            }}
            onPickBoth={() => {
              setMatching(false)
              toggle('match')(true)
            }}
          />
        )}
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
