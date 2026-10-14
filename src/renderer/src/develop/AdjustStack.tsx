import { setSectionOff } from '../../../shared/edits'
import type { ComponentType } from 'react'
import {
  cardBase,
  cardChanged,
  cardFields,
  CARDS,
  cardsFor,
  cardSpec,
  cardTitle,
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
import { LogWheelsBody, PrimariesBody, QualifierBody, ResolveCurvesBody } from '../panels/resolve'
import { rich, t, tk } from '../lib/i18n'
import { LensPanel } from '../panels/lens'
import { TIPS } from '../panels/tips'
import { useDevelop } from '../state/develop'
import { scoped, scopedView, scopeLayer, useScope } from '../state/scope'
import { useUi, type Drawer, type Panel } from '../state/ui'
import { GlassSelect } from '../components/GlassSelect'
import { useKeyHint } from '../lib/commands'
import { jumpToCard, openDrawer } from './tools'

const BODIES: Record<CardId, ComponentType> = {
  wb: WhiteBalanceBody,
  light: LightBody,
  presence: PresenceBody,
  colour: ColourBody,
  mixer: MixerBody,
  grading: GradingBody,
  curve: CurveBody,
  primaries: PrimariesBody,
  logwheels: LogWheelsBody,
  rcurves: ResolveCurvesBody,
  qualifier: QualifierBody,
  detail: DetailBody,
  effects: EffectsBody,
  optics: LensPanel,
  geometry: GeometryBody,
  calibration: CalibrationBody
}

/** The mixer with the Resolve tools: Lightroom's H, S, L and All, no point colour (the Qualifier is there). */
const CompactHsl = (): React.JSX.Element | null => <MixerBody compact />

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

/**
 * When the colour tools not shown hold edits (a photo graded with the other
 * set): they still act, and the chip says so and switches over.
 */
function OtherToolsChip(): React.JSX.Element | null {
  const tools = useUi((s) => s.colourTools)
  const setTools = useUi((s) => s.setColourTools)
  const masksOpen = useUi((s) => s.masksWin.open)
  const other = tools === 'lightroom' ? 'resolve' : 'lightroom'
  const held = useDevelop((s) => {
    if (!s.recipe) return false
    const layer = scopeLayer(s.recipe, s.layerId, masksOpen)
    const view = scopedView(s.recipe, layer)
    const base = cardBase(view, s.session?.isRaw ?? false, !!layer)
    return CARDS.some(
      (c) => c.set === other && (!layer || c.inMask) && cardChanged(c, view, base, !!layer)
    )
  })
  if (!held) return null
  return (
    <div className="tools-chip">
      <span>
        {other === 'resolve'
          ? t('Resolve colour edits are on this photo')
          : t('Lightroom colour edits are on this photo')}
      </span>
      <button className="sm" onClick={() => setTools(other)}>
        {t('Show')}
      </button>
    </div>
  )
}

/** One adjustment card: open or folded as the store says, its dot and reset from its fields. */
function AdjustCard({ spec }: { spec: CardSpec }): React.JSX.Element {
  const masksOpen = useUi((s) => s.masksWin.open)
  // A boolean, so a slider's tick elsewhere re-renders only the cards whose dot it turns.
  const changed = useDevelop((s) => {
    if (!s.recipe) return false
    const layer = scopeLayer(s.recipe, s.layerId, masksOpen)
    const view = scopedView(s.recipe, layer)
    return cardChanged(spec, view, cardBase(view, s.session?.isRaw ?? false, !!layer), !!layer)
  })
  // The whole photo's card can be switched off (a mask's has its own eye in the masks pane).
  const inMask = useDevelop((s) => !!s.recipe && !!scopeLayer(s.recipe, s.layerId, masksOpen))
  const off = useDevelop((s) => !inMask && s.recipe?.off?.[spec.id] === true)
  const switchOff = (): void => {
    const d = useDevelop.getState()
    d.edit((r) => setSectionOff(r, spec.id, !off))
    d.commit(`${spec.title}: ${off ? 'On' : 'Off'}`)
  }
  const reset = (): void => {
    const layer = scoped.layer()
    const isRaw = useDevelop.getState().session?.isRaw ?? false
    scoped.edit((r) => assignFields(r, cardBase(r, isRaw, !!layer), cardFields(spec, !!layer)))
    scoped.commit(`Reset ${spec.title}`)
  }
  const tools = useUi((s) => s.colourTools)
  const Body = spec.id === 'mixer' && tools === 'resolve' ? CompactHsl : BODIES[spec.id]
  const Right = HEADER[spec.id]
  return (
    <Card
      id={spec.id}
      title={t(cardTitle(spec, tools))}
      tip={TIPS[spec.id]}
      changed={changed}
      off={off}
      onToggle={inMask ? undefined : switchOff}
      fixed
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
 * The one dropdown that picks the section the column shows (each colour
 * tools set's own, in its order, then Enhance), with a dot on each that
 * holds changes, as the cards' own dots showed them.
 */
function SectionPicker({ cards, shown }: { cards: CardSpec[]; shown: Panel }): React.JSX.Element {
  const tools = useUi((s) => s.colourTools)
  const masksOpen = useUi((s) => s.masksWin.open)
  const key = useKeyHint()
  // One string, so a slider's tick re-renders this only when a dot turns.
  const dots = useDevelop((s) => {
    if (!s.recipe) return ''
    const layer = scopeLayer(s.recipe, s.layerId, masksOpen)
    const view = scopedView(s.recipe, layer)
    const base = cardBase(view, s.session?.isRaw ?? false, !!layer)
    return cards.map((c) => (cardChanged(c, view, base, !!layer) ? '1' : '0')).join('')
  })
  const options = [
    ...cards.map((c, i) => ({
      value: c.id as Panel,
      label: t(cardTitle(c, tools)),
      hint: key(`card.${c.id}`),
      dot: dots[i] === '1'
    })),
    { value: 'enhance' as Panel, label: t('Enhance'), hint: key('develop.enhance') }
  ]
  return (
    <div className="section-picker">
      <GlassSelect
        label={t('Choose the panel to show')}
        prefix={t('Panel')}
        value={shown}
        options={options}
        onChange={jumpToCard}
      />
    </div>
  )
}

/**
 * The right column under the strip: Treatment and Profile, then one
 * dropdown, then the one section it picks (an adjustment, in Lightroom's or
 * Resolve's set, or Enhance); or Crop's or Heal's panel in their place.
 * With a mask selected, only the sections a mask carries are offered, and
 * they edit the mask.
 */
export function AdjustStack(): React.JSX.Element {
  const drawer = useUi((s) => s.drawer)
  const layer = useScope().layer
  const overlayHue = useUi((s) => s.maskOverlay.hue)
  const tools = useUi((s) => s.colourTools)
  const focus = useUi((s) => s.focusCard)
  const cards = cardsFor(tools).filter((c) => !layer || c.inMask)
  // A section this scope or set does not offer gives way to the first that is.
  const shown: Panel =
    focus === 'enhance' || cards.some((c) => c.id === focus) ? focus : cards[0].id
  return (
    <div
      className={`panels adjust${layer ? ' scoped' : ''}`}
      style={layer ? { ['--scope-hue' as string]: layer.overlayHue ?? overlayHue } : undefined}
    >
      <ScopeChip />
      {drawer === 'adjust' ? (
        <>
          <AdjustHead />
          <SectionPicker cards={cards} shown={shown} />
          <OtherToolsChip />
          {shown === 'enhance' ? (
            <Card
              id="enhance"
              title={t('Enhance')}
              tip={TIPS.enhance}
              fixed
              right={<span className="ai-badge">{t('AI')}</span>}
            >
              <EnhancePanel />
            </Card>
          ) : (
            <AdjustCard key={shown} spec={cardSpec(shown)} />
          )}
        </>
      ) : (
        <DrawerPanel drawer={drawer} />
      )}
    </div>
  )
}
