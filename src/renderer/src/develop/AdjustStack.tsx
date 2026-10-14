import { setSectionOff } from '../../../shared/edits'
import type { ComponentType } from 'react'
import {
  BASIC_HEAD_FIELDS,
  BASIC_TITLE,
  cardBase,
  cardChanged,
  cardFields,
  CARDS,
  cardSpec,
  cardTitle,
  keyedAs,
  panelCards,
  panelsFor,
  panelTitle,
  type CardId,
  type CardSpec,
  type PanelId
} from '../../../shared/cards'
import { sameValue, type Recipe } from '../../../shared/recipe'
import { assignFields } from '../../../shared/recipe'
import { Icon } from '../components/icons'
import { Card } from '../components/ui'
import { InfoTip } from '../components/InfoTip'
import { EnhancePanel } from '../panels/enhance'
import {
  AdjustHead,
  AutoTone,
  CalibrationBody,
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

/** What a card's header reads and does: its dot, its eye, its reset (in the scope shown). */
function useCardState(spec: CardSpec): {
  changed: boolean
  off: boolean
  inMask: boolean
  switchOff: () => void
  reset: () => void
} {
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
  return { changed, off, inMask, switchOff, reset }
}

/** One adjustment card, the section shown: its dot and reset from its fields. */
function AdjustCard({ spec }: { spec: CardSpec }): React.JSX.Element {
  const { changed, off, inMask, switchOff, reset } = useCardState(spec)
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

/** One part of Basic corrections: a card's own header (dot, (i), eye, reset) over its sliders. */
function CardPart({ spec }: { spec: CardSpec }): React.JSX.Element {
  const { changed, off, inMask, switchOff, reset } = useCardState(spec)
  const Body = BODIES[spec.id]
  const Right = HEADER[spec.id]
  const title = t(spec.title)
  return (
    <section className={`card-part${off ? ' off' : ''}`} data-part={spec.id}>
      <header>
        <span className="title">{title}</span>
        {changed && <span className="card-dot" aria-label={t('Changed')} />}
        <span className="line" />
        <span className="card-acts">
          {Right && <Right />}
          <InfoTip tip={TIPS[spec.id]} label={title} />
          {!inMask && (
            <button
              type="button"
              className={`icon card-eye${off ? ' on' : ''}`}
              aria-pressed={off}
              aria-label={
                off
                  ? t('Turn {{name}} on', { name: title })
                  : t('Turn {{name}} off', { name: title })
              }
              title={off ? t('Turn on') : t('Turn off')}
              onClick={switchOff}
            >
              <Icon name={off ? 'eyeOff' : 'eye'} />
            </button>
          )}
          <button
            type="button"
            className="icon card-reset"
            aria-label={t('Reset {{name}}', { name: title })}
            title={t('Reset')}
            disabled={!changed}
            onClick={reset}
          >
            <Icon name="reset" />
          </button>
        </span>
      </header>
      <div className="card-part-body">
        <Body />
      </div>
    </section>
  )
}

const valueAt = (o: unknown, path: string[]): unknown =>
  path.reduce<unknown>(
    (v, k) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined),
    o
  )

/** Whether Treatment or Profile differ from the photo's defaults (the whole photo only). */
const headChanged = (view: Recipe, base: Recipe): boolean =>
  BASIC_HEAD_FIELDS.some((p) => !sameValue(valueAt(view, p), valueAt(base, p)))

/**
 * Basic corrections: Treatment and Profile, then White balance, Light and
 * Presence, each with its own header. Its own eye and reset act on all of
 * it; in a mask, on the three a mask carries.
 */
function BasicPanel({ parts }: { parts: CardSpec[] }): React.JSX.Element {
  const masksOpen = useUi((s) => s.masksWin.open)
  const changed = useDevelop((s) => {
    if (!s.recipe) return false
    const layer = scopeLayer(s.recipe, s.layerId, masksOpen)
    const view = scopedView(s.recipe, layer)
    const base = cardBase(view, s.session?.isRaw ?? false, !!layer)
    return (
      parts.some((c) => cardChanged(c, view, base, !!layer)) || (!layer && headChanged(view, base))
    )
  })
  const inMask = useDevelop((s) => !!s.recipe && !!scopeLayer(s.recipe, s.layerId, masksOpen))
  const sections = [...parts.map((c) => c.id), 'profile'] as const
  const off = useDevelop(
    (s) => !inMask && !!s.recipe && sections.every((id) => s.recipe?.off?.[id] === true)
  )
  const switchOff = (): void => {
    const d = useDevelop.getState()
    d.edit((r) => {
      for (const id of sections) setSectionOff(r, id, !off)
    })
    d.commit(`${BASIC_TITLE}: ${off ? 'On' : 'Off'}`)
  }
  const reset = (): void => {
    const layer = scoped.layer()
    const isRaw = useDevelop.getState().session?.isRaw ?? false
    const fields = [
      ...parts.flatMap((c) => cardFields(c, !!layer)),
      ...(layer ? [] : BASIC_HEAD_FIELDS)
    ]
    scoped.edit((r) => assignFields(r, cardBase(r, isRaw, !!layer), fields))
    scoped.commit(`Reset ${BASIC_TITLE}`)
  }
  return (
    <Card
      id="basic"
      title={t(BASIC_TITLE)}
      tip={TIPS.basic}
      changed={changed}
      off={off}
      onToggle={inMask ? undefined : switchOff}
      fixed
      onReset={reset}
    >
      <AdjustHead />
      {parts.map((c) => (
        <CardPart key={c.id} spec={c} />
      ))}
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
 * The one dropdown that picks the section the column shows (Basic
 * corrections, then each colour tools set's own, in order, then Enhance),
 * with a dot on each that holds changes, as the cards' own dots showed them.
 */
function SectionPicker({ panels, shown }: { panels: PanelId[]; shown: Panel }): React.JSX.Element {
  const tools = useUi((s) => s.colourTools)
  const masksOpen = useUi((s) => s.masksWin.open)
  const key = useKeyHint()
  // One string, so a slider's tick re-renders this only when a dot turns.
  const dots = useDevelop((s) => {
    if (!s.recipe) return ''
    const layer = scopeLayer(s.recipe, s.layerId, masksOpen)
    const view = scopedView(s.recipe, layer)
    const base = cardBase(view, s.session?.isRaw ?? false, !!layer)
    return panels
      .map((p) =>
        panelCards(p).some((c) => (!layer || c.inMask) && cardChanged(c, view, base, !!layer)) ||
        (p === 'basic' && !layer && headChanged(view, base))
          ? '1'
          : '0'
      )
      .join('')
  })
  const options = [
    ...panels.map((p, i) => ({
      value: p as Panel,
      label: t(panelTitle(p, tools)),
      hint: key(`card.${keyedAs(p)}`),
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
 * The right column under the strip: one dropdown, then the one section it
 * picks (Basic corrections with Treatment and Profile, another adjustment in
 * Lightroom's or Resolve's set, or Enhance); or Crop's or Heal's panel in
 * their place. With a mask selected, only the sections a mask carries are
 * offered, and they edit the mask.
 */
export function AdjustStack(): React.JSX.Element {
  const drawer = useUi((s) => s.drawer)
  const layer = useScope().layer
  const overlayHue = useUi((s) => s.maskOverlay.hue)
  const tools = useUi((s) => s.colourTools)
  const focus = useUi((s) => s.focusCard)
  const panels = panelsFor(tools, !!layer)
  // A section this scope or set does not offer gives way to the first that is.
  const shown: Panel = focus === 'enhance' || panels.includes(focus) ? focus : panels[0]
  return (
    <div
      className={`panels adjust${layer ? ' scoped' : ''}`}
      style={layer ? { ['--scope-hue' as string]: layer.overlayHue ?? overlayHue } : undefined}
    >
      <ScopeChip />
      {drawer === 'adjust' ? (
        <>
          <SectionPicker panels={panels} shown={shown} />
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
          ) : shown === 'basic' ? (
            <BasicPanel parts={panelCards('basic').filter((c) => !layer || c.inMask)} />
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
