import type { ComponentType } from 'react'
import {
  cardBase,
  cardChanged,
  cardFields,
  CARDS,
  type CardId,
  type CardSpec
} from '../../../shared/cards'
import { assignFields } from '../../../shared/recipe'
import { Icon } from '../components/icons'
import { Card } from '../components/ui'
import { EnhancePanel } from '../panels/enhance'
import {
  AdjustHead,
  AutoTone,
  CalibrationBody,
  ColourBody,
  CropDrawer,
  CurveBody,
  DetailBody,
  EffectsBody,
  GeometryBody,
  GradingBody,
  LightBody,
  MixerBody,
  PresenceBody,
  WhiteBalanceBody
} from '../panels/global'
import { HealPanel } from '../panels/heal'
import { rich, t, tk } from '../lib/i18n'
import { LensPanel } from '../panels/lens'
import { TIPS } from '../panels/tips'
import { useDevelop } from '../state/develop'
import { scoped, scopedView, scopeLayer, useScope } from '../state/scope'
import { useUi, type Drawer } from '../state/ui'
import { openDrawer } from './tools'

const BODIES: Record<CardId, ComponentType> = {
  wb: WhiteBalanceBody,
  light: LightBody,
  presence: PresenceBody,
  colour: ColourBody,
  mixer: MixerBody,
  grading: GradingBody,
  curve: CurveBody,
  detail: DetailBody,
  effects: EffectsBody,
  optics: LensPanel,
  geometry: GeometryBody,
  calibration: CalibrationBody
}

/** What a card carries in its header beside the (i), eye and reset. */
const HEADER: Partial<Record<CardId, ComponentType>> = { light: AutoTone }

/**
 * With a mask selected, a chip in the mask's own overlay colour (× edits the
 * whole photo again): every card the column shows then edits the mask.
 */
function ScopeChip(): React.JSX.Element | null {
  const { layer } = useScope()
  const overlayHue = useUi((s) => s.maskOverlay.hue)
  if (!layer) return null
  return (
    <div
      className="scope-chip"
      style={{ ['--scope-hue' as string]: layer.overlayHue ?? overlayHue }}
    >
      <span className="scope-dot" />
      <span className="scope-text">{rich('Editing {{name}}', { name: <b>{layer.name}</b> })}</span>
      <button
        className="icon sm ghost"
        title={t('Edit the whole photo (Esc)')}
        aria-label={t('Edit the whole photo')}
        onClick={() => useDevelop.getState().setLayer(null)}
      >
        <Icon name="close" />
      </button>
    </div>
  )
}

/** One adjustment card: open or folded as the store says, its dot and reset from its fields. */
function AdjustCard({ spec }: { spec: CardSpec }): React.JSX.Element {
  const open = useUi((s) => !!s.cardsOpen[spec.id])
  const setOpen = useUi((s) => s.setCardOpen)
  const masksOpen = useUi((s) => s.masksWin.open)
  // A boolean, so a slider's tick elsewhere re-renders only the cards whose dot it turns.
  const changed = useDevelop((s) => {
    if (!s.recipe) return false
    const layer = scopeLayer(s.recipe, s.layerId, masksOpen)
    const view = scopedView(s.recipe, layer)
    return cardChanged(spec, view, cardBase(view, s.session?.isRaw ?? false, !!layer), !!layer)
  })
  const reset = (): void => {
    const layer = scoped.layer()
    const isRaw = useDevelop.getState().session?.isRaw ?? false
    scoped.edit((r) => assignFields(r, cardBase(r, isRaw, !!layer), cardFields(spec, !!layer)))
    scoped.commit(`Reset ${spec.title}`)
  }
  const Body = BODIES[spec.id]
  const Right = HEADER[spec.id]
  return (
    <Card
      id={spec.id}
      title={t(spec.title)}
      tip={TIPS[spec.id]}
      changed={changed}
      open={open}
      onOpenChange={(o) => setOpen(spec.id, o)}
      onReset={reset}
      right={Right && <Right />}
    >
      <Body />
    </Card>
  )
}

const DRAWERS: Record<Exclude<Drawer, 'adjust'>, { title: string; Body: ComponentType }> = {
  crop: { title: tk('Crop & straighten'), Body: CropDrawer },
  heal: { title: tk('Heal'), Body: HealPanel }
}

/** Crop's or Heal's panel, in place of the cards while its tool is in hand. */
function DrawerPanel({ drawer }: { drawer: Exclude<Drawer, 'adjust'> }): React.JSX.Element {
  const { title, Body } = DRAWERS[drawer]
  return (
    <div className="drawer">
      <div className="drawer-head">
        <span className="drawer-title">{t(title)}</span>
        <button
          className="sm"
          title={t('Back to the adjustments (Esc)')}
          onClick={() => openDrawer('adjust')}
        >
          {t('Done')}
        </button>
      </div>
      <Body />
    </div>
  )
}

/**
 * The right column under the strip: every adjustment as a folding card, in
 * Lightroom Classic's order, then Enhance; or Crop's or Heal's panel in
 * their place. With a mask selected, only the cards a mask carries show,
 * and they edit the mask.
 */
export function AdjustStack(): React.JSX.Element {
  const drawer = useUi((s) => s.drawer)
  const layer = useScope().layer
  const overlayHue = useUi((s) => s.maskOverlay.hue)
  const cards = CARDS.filter((c) => !layer || c.inMask)
  return (
    <div
      className={`panels adjust${layer ? ' scoped' : ''}`}
      style={layer ? { ['--scope-hue' as string]: layer.overlayHue ?? overlayHue } : undefined}
    >
      <ScopeChip />
      {drawer === 'adjust' ? (
        <>
          <AdjustHead />
          {cards.map((c) => (
            <AdjustCard key={c.id} spec={c} />
          ))}
          <Card
            id="enhance"
            title={t('Enhance')}
            tip={TIPS.enhance}
            defaultOpen={false}
            right={<span className="ai-badge">{t('AI')}</span>}
          >
            <EnhancePanel />
          </Card>
        </>
      ) : (
        <DrawerPanel drawer={drawer} />
      )}
    </div>
  )
}
