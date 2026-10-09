import { CARDS, type CardId } from '../../../shared/cards'
import { useDevelop, type Tool } from '../state/develop'
import { scoped } from '../state/scope'
import { useUi, type Drawer } from '../state/ui'

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
const CARD_PICKERS: Tool[] = ['fringe-pick', 'add-pick', 'point-picker', 'wb-picker']

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

/** The cards the column shows now: in a mask, only those a mask carries. */
export function visibleCards(): CardId[] {
  const inMask = scoped.layer() !== null
  return CARDS.filter((c) => !inMask || c.inMask).map((c) => c.id)
}

/** Bring a card into view: the cards back if a tool's panel was up, the card open and scrolled to. */
export function jumpToCard(id: CardId): void {
  openDrawer('adjust')
  const ui = useUi.getState()
  ui.setCardOpen(id, true)
  ui.setFocusCard(id)
  // Once it has rendered open (and, in solo, the others have folded).
  requestAnimationFrame(() =>
    requestAnimationFrame(() =>
      document
        .querySelector(`[data-card="${id}"]`)
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    )
  )
}

/** The card before or after the focused one (wrapping). */
export function stepCard(dir: 1 | -1): void {
  const list = visibleCards()
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
