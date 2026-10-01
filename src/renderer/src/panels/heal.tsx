/**
 * The Heal tool: heal, clone and content-aware fill, red eye and pet eye,
 * painted on the photo (`views/loupe/HealTool.tsx`) and baked into its pixels
 * stroke by stroke (`lib/heal.ts`). The sliders set the next stroke.
 */
import type { SpotKind } from '../../../shared/retouch'
import { Icon } from '../components/icons'
import { useState } from 'react'
import { Section, Slider, Tabs, ToolPanel } from '../components/ui'
import { bakeLiveSpots, removeLiveSpots } from '../lib/heal'
import { useScope } from '../state/scope'
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
  heal: 'Press on the flaw, hold and drag to where it should copy from, and let go. Let go without dragging and it picks a source itself. The texture comes from the source, the tone from around the spot.',
  clone:
    'Press on what should go, hold and drag to what should replace it, and let go: the pixels come exactly as they are.',
  fill: 'Click what should go: it is rebuilt from the rest of the photo (content-aware).',
  redeye: 'Click a red pupil to darken it to neutral (Size sets how big).',
  peteye: 'Click a glowing pet pupil to bring it to dark (Size sets how big).'
}

export function HealPanel(): React.JSX.Element | null {
  const recipe = useDevelop((s) => s.recipe)
  const isHdr = useDevelop((s) => s.session?.isHdr === true)
  const heal = useUi((s) => s.heal)
  const setHeal = useUi((s) => s.setHeal)
  const { layer } = useScope()
  const [baking, setBaking] = useState(false)
  if (!recipe) return null
  const live = recipe.retouch.length
  const strokes = recipe.pixels.filter((p) => p.kind === 'retouch').length
  const eye = heal.mode === 'redeye' || heal.mode === 'peteye'

  return (
    <ToolPanel
      actions={<Tabs value={heal.mode} onChange={(m) => setHeal({ mode: m })} tabs={MODES} />}
    >
      <p className="muted small">{HINT[heal.mode]}</p>
      {layer && !isHdr && <p className="scope-note small">Strokes keep inside {layer.name}.</p>}
      <Section id="heal.brush" title="Brush">
        {
          <Slider
            label="Size"
            value={Math.round(heal.size * 1000) / 10}
            min={0.2}
            max={25}
            step={0.1}
            def={2}
            format={(v) => `${v.toFixed(1)}%`}
            onChange={(v) => setHeal({ size: v / 100 })}
            onCommit={() => undefined}
          />
        }
        <Slider
          label="Feather"
          value={heal.feather}
          min={0}
          max={100}
          def={50}
          onChange={(v) => setHeal({ feather: v })}
          onCommit={() => undefined}
        />
        {!eye && (
          <Slider
            label="Opacity"
            value={heal.opacity}
            min={0}
            max={100}
            def={100}
            onChange={(v) => setHeal({ opacity: v })}
            onCommit={() => undefined}
          />
        )}
      </Section>
      <Section id="heal.spots" title="Visualise spots">
        <label className="check" title="Show the picture as specks on black, where dust stands out">
          <input
            type="checkbox"
            checked={!!heal.visualise}
            onChange={(e) => setHeal({ visualise: e.target.checked })}
          />
          Show dust and spots
        </label>
        {heal.visualise && (
          <Slider
            label="Level"
            value={heal.spotLevel ?? 50}
            min={0}
            max={100}
            def={50}
            title="Higher shows fainter specks"
            onChange={(v) => setHeal({ spotLevel: v })}
            onCommit={() => undefined}
          />
        )}
      </Section>
      {live > 0 && (
        <Section id="heal.live" title="Earlier spots">
          <p className="muted small">
            {isHdr
              ? `${live} spot${live === 1 ? '' : 's'} on this HDR photo, drawn live (HDR photos cannot take baked strokes yet).`
              : `${live} spot${live === 1 ? '' : 's'} from before strokes were baked, still drawn live.`}
          </p>
          <div className="row">
            {!isHdr && (
              <button
                className="sm"
                disabled={baking}
                onClick={() => {
                  setBaking(true)
                  void bakeLiveSpots().finally(() => setBaking(false))
                }}
              >
                {baking ? 'Baking…' : 'Bake into pixels'}
              </button>
            )}
            <button className="sm ghost" onClick={removeLiveSpots}>
              <Icon name="trash" />
              Remove
            </button>
          </div>
        </Section>
      )}
      <p className="muted small">
        {strokes > 0 ? `${strokes} spot${strokes === 1 ? '' : 's'} baked into the photo. ` : ''}
        Each spot is baked into the photo&apos;s pixels and kept in its project: undo takes it away,
        and the next one works on what it healed.
      </p>
    </ToolPanel>
  )
}
