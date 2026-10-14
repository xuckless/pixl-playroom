import {
  cardBase,
  cardChanged,
  CARDS,
  panelOf,
  panelsFor,
  type CardId,
  type CardSpec
} from '../../../shared/cards'
import { useDevelop, type Tool } from '../state/develop'
import { scoped, scopedView, scopeLayer } from '../state/scope'
import { useUi, type Drawer, type Panel } from '../state/ui'

type DevelopState = ReturnType<typeof useDevelop.getState>

/** The legacy cards (Lightroom's Colour grading) holding edits in the scope shown, as one string of ids. */
function legacyHeldIds(s: DevelopState, masksOpen: boolean): string {
  if (!s.recipe) return ''
  const layer = scopeLayer(s.recipe, s.layerId, masksOpen)
  const view = scopedView(s.recipe, layer)
  const base = cardBase(view, s.session?.isRaw ?? false, !!layer)
  return CARDS.filter(
    (c) => c.legacy && (!layer || c.inMask) && cardChanged(c, view, base, !!layer)
  )
    .map((c) => c.id)
    .join(' ')
}

const heldBy =
  (ids: string) =>
  (c: CardSpec): boolean =>
    ids.split(' ').includes(c.id)

/** Whether a legacy card holds edits now (it is offered only then). */
export const legacyHeldNow = (): ((c: CardSpec) => boolean) =>
  heldBy(legacyHeldIds(useDevelop.getState(), useUi.getState().masksWin.open))

/** The same, as a hook: re-renders only when a legacy card starts or stops holding edits. */
export function useLegacyHeld(): (c: CardSpec) => boolean {
  const masksOpen = useUi((s) => s.masksWin.open)
  return heldBy(useDevelop((s) => legacyHeldIds(s, masksOpen)))
}

/** A 24-unit SVG path for each canvas tool in the strip above the cards. */
export const STRIP_ICONS = {
  crop: 'M6 2v16h16M2 6h16v16',
  heal: 'M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z'
} as const

/** Canvas tools that belong to the masks window. */
export const MASK_TOOLS: Tool[] = [
  'brush',
  'polygon',
  'linear',
  'radial',
  'bidirectional',
  'objects',
  'range-picker',
  'depth-picker'
]

/** Pickers that belong to a card: put down when the column changes. */
const CARD_PICKERS: Tool[] = [
  'fringe-pick',
  'add-pick',
  'point-picker',
  'qualifier-pick',
  'wb-picker'
]

/**
 * Show the cards, or Crop's or Heal's panel in their place, and keep the
 * canvas in step: Crop and Heal take their tool up with their panel (as
 * Lightroom's do) and put it down with it. A mask tool stays in hand
 * (masks live in their own window), unless Crop or Heal takes the canvas.
 */
export function openDrawer(d: Drawer): void {
  const ui = useUi.getState()
  const dev = useDevelop.getState()
  if (ui.drawer !== d) {
    ui.setDrawer(d)
    if (CARD_PICKERS.includes(dev.tool)) dev.setTool('none')
  }
  const tool = useDevelop.getState().tool
  if (d === 'crop') {
    if (tool !== 'crop' && tool !== 'upright-guide') dev.setTool('crop')
  } else if (tool === 'crop' || tool === 'upright-guide') dev.setTool('none')
  if (d === 'heal') {
    if (tool !== 'heal') dev.setTool('heal')
  } else if (tool === 'heal') dev.setTool('none')
}

/** Crop or Heal again puts it down and brings the cards back. */
export function toggleDrawer(d: Exclude<Drawer, 'adjust'>): void {
  openDrawer(useUi.getState().drawer === d ? 'adjust' : d)
}

/** The sections the dropdown offers now (in a mask, those a mask carries), then Enhance. */
export function visiblePanels(): Panel[] {
  return [...panelsFor(scoped.layer() !== null, legacyHeldNow()), 'enhance']
}

/**
 * Show a section: the cards back if a tool's panel was up, that section the
 * one shown. A card shown inside Basic corrections shows Basic, scrolled to it.
 */
export function jumpToCard(id: Panel | CardId): void {
  openDrawer('adjust')
  const ui = useUi.getState()
  const card = id !== 'enhance' && id !== 'basic' ? id : null
  const panel = card ? panelOf(card) : (id as Panel)
  ui.setFocusCard(panel)
  // From the top of the section, wherever the last one was scrolled to; or at the part asked for.
  requestAnimationFrame(() => {
    const column = document.querySelector('.panels.adjust')
    const part = card && panel !== card ? column?.querySelector(`[data-part="${card}"]`) : null
    if (part) part.scrollIntoView({ block: 'start', behavior: 'smooth' })
    else column?.scrollTo({ top: 0, behavior: 'smooth' })
  })
}

/** The section before or after the shown one (wrapping). */
export function stepCard(dir: 1 | -1): void {
  const list = visiblePanels()
  const i = list.indexOf(useUi.getState().focusCard)
  jumpToCard(list[(Math.max(0, i) + dir + list.length) % list.length])
}

/** Show the masks pane, starting the mask thumbnails. */
export function openMasks(): void {
  const ui = useUi.getState()
  if (ui.masksWin.open) return
  ui.setMasksWin({ open: true })
  useDevelop.getState().pushView()
}

/** Leave the masks: any mask tool is put down and the thumbnails stop. */
export function closeMasks(): void {
  useUi.getState().setMasksWin({ open: false })
  const dev = useDevelop.getState()
  if (MASK_TOOLS.includes(dev.tool)) dev.setTool('none')
  dev.setHoverLayer(null)
  dev.pushView()
}

export function toggleMasks(): void {
  if (useUi.getState().masksWin.open) closeMasks()
  else openMasks()
}

/** Whether the masks pane is up. */
export function masksOpen(): boolean {
  return useUi.getState().masksWin.open
}

/**
 * Keep the column with the canvas: a crop or heal tool taken up some other
 * way (a shortcut, the loupe) shows its panel, and one put down (Done, Esc,
 * a mask tool) brings the cards back. Call once, from the app shell.
 */
export function startDrawerSync(): () => void {
  const of = (tool: Tool): 'crop' | 'heal' | null =>
    tool === 'crop' || tool === 'upright-guide' ? 'crop' : tool === 'heal' ? 'heal' : null
  return useDevelop.subscribe((s, prev) => {
    if (s.tool === prev.tool) return
    const ui = useUi.getState()
    const now = of(s.tool)
    if (now && ui.drawer !== now) ui.setDrawer(now)
    else if (!now && of(prev.tool) === ui.drawer) ui.setDrawer('adjust')
  })
}
