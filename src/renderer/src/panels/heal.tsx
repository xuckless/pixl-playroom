/**
 * The Heal tool (the wheel's, after Masks): heal, clone and content-aware
 * fill spots, red eye and pet eye, placed on the photo (`views/loupe/
 * HealTool.tsx`). The sliders set the next spot, or the selected one.
 */
import type { SpotKind } from '../../../shared/retouch'
import { Icon } from '../components/icons'
import { Section, Slider, Tabs, Toggle, ToolPanel } from '../components/ui'
import { changeSpot, commitSpot, deleteSpot, findSource, spotName } from '../lib/heal'
import { useDevelop } from '../state/develop'
import { useUi } from '../state/ui'

const MODES: { value: SpotKind; label: string }[] = [
  { value: 'heal', label: 'Heal' },
  { value: 'clone', label: 'Clone' },
  { value: 'fill', label: 'Fill' },
  { value: 'redeye', label: 'Red eye' },
  { value: 'peteye', label: 'Pet eye' }
]

const HINT: Record<SpotKind, string> = {
  heal: 'Copies texture from nearby and blends it into the tone around the spot.',
  clone: 'Copies pixels from nearby as they are.',
  fill: 'Rebuilds the spot from the rest of the photo (content-aware).',
  redeye: 'Drag over a red pupil (or click it) to darken it to neutral.',
  peteye: 'Drag over a glowing pet pupil (or click it) to bring it to dark.'
}

export function HealPanel(): React.JSX.Element | null {
  const recipe = useDevelop((s) => s.recipe)
  const spotId = useDevelop((s) => s.spotId)
  const setSpotId = useDevelop((s) => s.setSpotId)
  const heal = useUi((s) => s.heal)
  const setHeal = useUi((s) => s.setHeal)
  if (!recipe) return null
  const spots = recipe.retouch
  const sel = spots.find((s) => s.id === spotId) ?? null
  const kind = sel?.kind ?? heal.mode
  const eye = kind === 'redeye' || kind === 'peteye'

  /** A slider on the selected spot, or on the tool's setting for the next one. */
  const knob = (
    label: string,
    read: number,
    write: (v: number, live: boolean) => void,
    opts: {
      min?: number
      max?: number
      step?: number
      def?: number
      format?: (v: number) => string
    } = {}
  ): React.JSX.Element => (
    <Slider
      label={label}
      value={read}
      min={opts.min ?? 0}
      max={opts.max ?? 100}
      step={opts.step ?? 1}
      def={opts.def ?? 0}
      format={opts.format}
      onChange={write}
      onCommit={() => sel && commitSpot(sel.id, label.toLowerCase())}
    />
  )
  const size = sel ? sel.radius : heal.size

  return (
    <ToolPanel
      actions={
        <Tabs
          value={heal.mode}
          onChange={(m) => {
            setHeal({ mode: m })
            setSpotId(null)
          }}
          tabs={MODES}
        />
      }
    >
      <p className="muted small">{HINT[kind]}</p>
      <div className="row">
        <Toggle
          on={heal.showSpots}
          onChange={(on) => setHeal({ showSpots: on })}
          title="Show the spots on the photo (H)"
        >
          Show spots
        </Toggle>
        <button className="sm ghost" disabled title="Needs an inpainting model; none ships yet">
          Remove (AI)
        </button>
      </div>
      <Section id="heal.brush" title={sel ? spotName(spots, sel) : 'New spots'}>
        {!eye &&
          knob(
            'Size',
            Math.round(size * 1000) / 10,
            (v, live) =>
              sel
                ? changeSpot(sel.id, (s) => (s.radius = s.radiusY = v / 100), live)
                : setHeal({ size: v / 100 }),
            { min: 0.2, max: 25, step: 0.1, def: 2, format: (v) => `${v.toFixed(1)}%` }
          )}
        {knob(
          'Feather',
          sel ? sel.feather : heal.feather,
          (v, live) =>
            sel ? changeSpot(sel.id, (s) => (s.feather = v), live) : setHeal({ feather: v }),
          { def: 50 }
        )}
        {!eye &&
          knob(
            'Opacity',
            sel ? sel.opacity : heal.opacity,
            (v, live) =>
              sel ? changeSpot(sel.id, (s) => (s.opacity = v), live) : setHeal({ opacity: v }),
            { def: 100 }
          )}
        {sel?.kind === 'redeye' && (
          <>
            {knob(
              'Desaturate',
              sel.desaturate,
              (v, live) => changeSpot(sel.id, (s) => (s.desaturate = v), live),
              { def: 100 }
            )}
            {knob(
              'Darken',
              sel.darken,
              (v, live) => changeSpot(sel.id, (s) => (s.darken = v), live),
              {
                def: 30
              }
            )}
          </>
        )}
        {sel?.kind === 'peteye' && (
          <>
            {knob(
              'Amount',
              sel.amount,
              (v, live) => changeSpot(sel.id, (s) => (s.amount = v), live),
              {
                def: 100
              }
            )}
            {knob(
              'Pupil level',
              sel.pupilLevel,
              (v, live) => changeSpot(sel.id, (s) => (s.pupilLevel = v), live),
              { def: 10 }
            )}
          </>
        )}
        {sel && (
          <div className="row">
            {(sel.kind === 'heal' || sel.kind === 'clone') && (
              <button className="sm" onClick={() => void findSource(sel.id)}>
                Find another source
              </button>
            )}
            <span className="spacer" />
            <button className="sm ghost" onClick={() => deleteSpot(sel.id)} title="Delete (⌫)">
              <Icon name="trash" />
              Delete
            </button>
          </div>
        )}
      </Section>
      <Section id="heal.list" title={`Spots (${spots.length})`}>
        {spots.length === 0 && (
          <p className="muted small">
            Click a blemish to heal it; drag to paint along a wire or a scratch.
          </p>
        )}
        <ul className="spot-list">
          {spots.map((s) => (
            <li key={s.id} className={s.id === spotId ? 'on' : ''}>
              <label className="check">
                <input
                  type="checkbox"
                  checked={s.enabled}
                  onChange={(e) => {
                    changeSpot(s.id, (x) => (x.enabled = e.target.checked))
                    commitSpot(s.id, e.target.checked ? 'show' : 'hide')
                  }}
                />
              </label>
              <button className="ghost sm spot-name" onClick={() => setSpotId(s.id)}>
                {spotName(spots, s)}
                {s.points.length > 1 ? ' (stroke)' : ''}
              </button>
              <button
                className="icon sm"
                title="Delete"
                aria-label="Delete"
                onClick={() => deleteSpot(s.id)}
              >
                <Icon name="trash" />
              </button>
            </li>
          ))}
        </ul>
      </Section>
      <p className="muted small">
        Spots run before every adjustment, and are built into the preview once placed.
      </p>
    </ToolPanel>
  )
}
