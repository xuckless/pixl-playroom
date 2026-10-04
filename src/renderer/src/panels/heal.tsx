/**
 * The Heal tool: heal, clone and content-aware fill, red eye and pet eye,
 * painted on the photo (`views/loupe/HealTool.tsx`) and baked into its pixels
 * stroke by stroke (`lib/heal.ts`). The sliders set the next stroke.
 */
import type { SpotKind } from '../../../shared/retouch'
import { staleRawStep } from '../../../shared/pixels'
import { developMark } from '../../../shared/rawcolour'
import { Icon } from '../components/icons'
import { useState } from 'react'
import { InfoTip, type Tip } from '../components/InfoTip'
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

/** How each mode is used, behind the (i) beside the modes. */
const HINT: Record<SpotKind, Tip> = {
  heal: {
    what: 'Press on the flaw, hold and drag to where it should copy from, and let go.',
    expect: 'The texture comes from the source, the tone from around the spot.',
    tip: 'Let go without dragging and it picks a source itself.'
  },
  clone: {
    what: 'Press on what should go, hold and drag to what should replace it, and let go.',
    expect: 'The pixels come exactly as they are, tone and all.'
  },
  fill: {
    what: 'Click what should go: it is rebuilt from the rest of the photo.',
    expect: 'Best on small things against plain or repeating backgrounds.'
  },
  redeye: {
    what: 'Click a red pupil to darken it to neutral.',
    expect: 'Size sets how big the pupil is.'
  },
  peteye: {
    what: 'Click a glowing pet pupil to bring it to dark.',
    expect: 'Size sets how big the pupil is.'
  }
}

/** What becomes of a spot, behind the (i) on the Brush section. */
const BAKED: Tip = {
  what: 'Each spot is baked into the photo’s pixels and kept in its project.',
  expect: 'Undo takes it away; the next spot works on what the last one healed.'
}

export function HealPanel(): React.JSX.Element | null {
  const recipe = useDevelop((s) => s.recipe)
  const isHdr = useDevelop((s) => s.session?.isHdr === true)
  const isRaw = useDevelop((s) => s.session?.isRaw === true)
  const mark = useDevelop((s) => developMark(s.session?.rawColour ?? 'container'))
  const heal = useUi((s) => s.heal)
  const setHeal = useUi((s) => s.setHeal)
  const { layer } = useScope()
  const [baking, setBaking] = useState(false)
  if (!recipe) return null
  const live = recipe.retouch.length
  const strokes = recipe.pixels.filter((p) => p.kind === 'retouch').length
  const stale = recipe.pixels.filter(
    (p) => p.kind === 'retouch' && staleRawStep(p, isRaw, mark)
  ).length
  const eye = heal.mode === 'redeye' || heal.mode === 'peteye'

  return (
    <ToolPanel
      actions={
        <>
          <Tabs value={heal.mode} onChange={(m) => setHeal({ mode: m })} tabs={MODES} />
          <InfoTip tip={HINT[heal.mode]} label={MODES.find((m) => m.value === heal.mode)!.label} />
        </>
      }
    >
      {layer && !isHdr && <p className="scope-note small">Strokes keep inside {layer.name}.</p>}
      {stale > 0 && (
        <p className="pixel-step-stale">
          {stale === 1 ? 'One heal stroke was' : `${stale} heal strokes were`} made from the
          previous RAW develop: its patch can show a seam. Undo it in History and heal again to
          match this one.
        </p>
      )}
      <Section
        id="heal.brush"
        title="Brush"
        tip={BAKED}
        right={
          strokes > 0 ? (
            <span className="muted micro">
              {strokes} spot{strokes === 1 ? '' : 's'} baked
            </span>
          ) : undefined
        }
      >
        {
          <Slider
            label="Size"
            value={Math.round(heal.size * 10000) / 100}
            min={0.2}
            max={25}
            step={0.01}
            def={2}
            scale="log"
            format={(v) => `${v < 1 ? v.toFixed(2) : v.toFixed(1)}%`}
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
            {live} spot{live === 1 ? '' : 's'} drawn live
            {isHdr ? ' (HDR photos cannot be baked yet).' : ', from before spots were baked.'}
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
    </ToolPanel>
  )
}
