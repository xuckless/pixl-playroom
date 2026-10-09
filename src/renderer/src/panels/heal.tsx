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
import { Section, Slider, Tabs, Toggle, ToolPanel } from '../components/ui'
import { ModelGet } from '../components/ModelGet'
import { ensureModel } from '../lib/ensureModel'
import { useModels } from '../lib/models'
import { bakeLiveSpots, removeLiveSpots } from '../lib/heal'
import { useScope } from '../state/scope'
import { useDevelop } from '../state/develop'
import { useUi } from '../state/ui'
import { t, tk, tp } from '../lib/i18n'

const MODES: { value: SpotKind; label: string }[] = [
  { value: 'heal', label: tk('Heal') },
  { value: 'clone', label: tk('Clone') },
  { value: 'fill', label: tk('Fill') },
  { value: 'remove', label: tk('Remove') },
  { value: 'redeye', label: tk('Red eye') },
  { value: 'peteye', label: tk('Pet eye') }
]

/** How each mode is used, behind the (i) beside the modes. */
const HINT: Record<SpotKind, Tip> = {
  heal: {
    what: tk('Press on the flaw, hold and drag to where it should copy from, and let go.'),
    expect: tk('The texture comes from the source, the tone from around the spot.'),
    tip: tk('Let go without dragging and it picks a source itself.')
  },
  clone: {
    what: tk('Press on what should go, hold and drag to what should replace it, and let go.'),
    expect: tk('The pixels come exactly as they are, tone and all.')
  },
  fill: {
    what: tk('Click what should go: it is rebuilt from the rest of the photo.'),
    expect: tk('Best on small things against plain or repeating backgrounds.')
  },
  remove: {
    what: tk('Paint over what should go: an AI model fills it with what was likely behind it.'),
    expect: tk(
      'Works on people, signs, wires and larger things where Fill would repeat the background. With Find object, click something and it is found for you.'
    ),
    tip: tk('Paint a little past its edges, shadow included.')
  },
  redeye: {
    what: tk('Click a red pupil to darken it to neutral.'),
    expect: tk('Size sets how big the pupil is.')
  },
  peteye: {
    what: tk('Click a glowing pet pupil to bring it to dark.'),
    expect: tk('Size sets how big the pupil is.')
  }
}

/** What becomes of a spot, behind the (i) on the Brush section. */
const BAKED: Tip = {
  what: tk('Each spot is baked into the photo’s pixels and kept in its project.'),
  expect: tk('Undo takes it away; the next spot works on what the last one healed.')
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
  const models = useModels()
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
          <Tabs
            className="heal-modes"
            value={heal.mode}
            onChange={(m) => setHeal({ mode: m })}
            tabs={MODES.map((m) => ({ ...m, label: t(m.label) }))}
          />
          <InfoTip
            tip={HINT[heal.mode]}
            label={t(MODES.find((m) => m.value === heal.mode)!.label)}
          />
        </>
      }
    >
      {layer && !isHdr && (
        <p className="scope-note small">
          {t('Strokes keep inside {{layer}}.', { layer: layer.name })}
        </p>
      )}
      {heal.mode === 'remove' &&
        (isHdr ? (
          <p className="scope-note small">
            {t('Remove bakes into the photo’s pixels, which an HDR photo cannot take yet.')}
          </p>
        ) : (
          <div className="row heal-remove">
            <Toggle
              on={heal.findObject === true}
              onChange={(on) =>
                void (async () => {
                  // SAM 2.1 finds the object: offered first when it is not here.
                  if (on && !(await ensureModel('prompt', t('Find object')))) return
                  setHeal({ findObject: on })
                })()
              }
              title={t(
                'Click something on the photo and it is found and removed (SAM 2.1, then MI-GAN)'
              )}
            >
              <Icon name="objects" />
              {t('Find object')}
            </Toggle>
            <ModelGet id="migan-512" models={models} />
          </div>
        ))}
      {stale > 0 && (
        <p className="pixel-step-stale">
          {tp(
            'One heal stroke was made from the previous RAW develop: its patch can show a seam. Undo it in History and heal again to match this one.',
            '{{count}} heal strokes were made from the previous RAW develop: its patch can show a seam. Undo it in History and heal again to match this one.',
            stale
          )}
        </p>
      )}
      <Section
        id="heal.brush"
        title={t('Brush')}
        tip={BAKED}
        right={
          strokes > 0 ? (
            <span className="muted micro">
              {tp('{{count}} spot baked', '{{count}} spots baked', strokes)}
            </span>
          ) : undefined
        }
      >
        {
          <Slider
            label={t('Size')}
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
          label={t('Feather')}
          value={heal.feather}
          min={0}
          max={100}
          def={50}
          onChange={(v) => setHeal({ feather: v })}
          onCommit={() => undefined}
        />
        {!eye && (
          <Slider
            label={t('Opacity')}
            value={heal.opacity}
            min={0}
            max={100}
            def={100}
            onChange={(v) => setHeal({ opacity: v })}
            onCommit={() => undefined}
          />
        )}
      </Section>
      <Section id="heal.spots" title={t('Visualise spots')}>
        <label
          className="check"
          title={t('Show the picture as specks on black, where dust stands out')}
        >
          <input
            type="checkbox"
            checked={!!heal.visualise}
            onChange={(e) => setHeal({ visualise: e.target.checked })}
          />
          {t('Show dust and spots')}
        </label>
        {heal.visualise && (
          <Slider
            label={t('Level|spots')}
            value={heal.spotLevel ?? 50}
            min={0}
            max={100}
            def={50}
            title={t('Higher shows fainter specks')}
            onChange={(v) => setHeal({ spotLevel: v })}
            onCommit={() => undefined}
          />
        )}
      </Section>
      {live > 0 && (
        <Section id="heal.live" title={t('Earlier spots')}>
          <p className="muted small">
            {isHdr
              ? tp(
                  '{{count}} spot drawn live (HDR photos cannot be baked yet).',
                  '{{count}} spots drawn live (HDR photos cannot be baked yet).',
                  live
                )
              : tp(
                  '{{count}} spot drawn live, from before spots were baked.',
                  '{{count}} spots drawn live, from before spots were baked.',
                  live
                )}
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
                {baking ? t('Baking…') : t('Bake into pixels')}
              </button>
            )}
            <button className="sm ghost" onClick={removeLiveSpots}>
              <Icon name="trash" />
              {t('Remove')}
            </button>
          </div>
        </Section>
      )}
    </ToolPanel>
  )
}
