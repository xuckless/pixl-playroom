/**
 * The Library's Loupe and Compare zoom, apart from Develop's one loupe
 * (views/loupe/zoom.ts): a view per pane (shared/view.ts `ZoomView`, scale in
 * device pixels per photo pixel of the photo's full size), Compare's two
 * linked unless L unlinks them. Each pane says where it is and what it shows
 * (`registerPane`); the keys act on the pane the view's keys go to
 * (`keyPane`): the Loupe's, or Compare's picked one.
 */
import { create } from 'zustand'
import {
  FIT,
  panBy,
  scaleOf,
  zoomAt,
  zoomTo,
  type P,
  type Viewport,
  type ZoomView
} from '../../../../shared/view'
import { useLibrary } from '../../state/library'

export type PaneId = 'loupe' | 'select' | 'candidate'

interface LibZoom {
  views: Record<PaneId, ZoomView>
  /** Compare's panes zoom and pan together. */
  linked: boolean
}

export const useLibZoom = create<LibZoom>(() => ({
  views: { loupe: FIT, select: FIT, candidate: FIT },
  linked: true
}))

/** What a pane tells the keys: its box and photo, the pointer over it, and how to learn the photo's full size. */
export interface PaneHandle {
  viewport: () => Viewport | null
  pointer: () => P | null
  /** The photo's full size (its 1:1), fetched when first wanted: the viewport has it after. */
  full: () => Promise<Viewport | null>
}

const panes = new Map<PaneId, PaneHandle>()

export function registerPane(id: PaneId, h: PaneHandle): () => void {
  panes.set(id, h)
  return () => {
    if (panes.get(id) === h) panes.delete(id)
  }
}

/** The pane the zoom keys act on now. */
export function keyPane(): PaneId | null {
  const l = useLibrary.getState()
  if (l.view !== 'library') return null
  if (l.mode === 'loupe') return 'loupe'
  if (l.mode === 'compare') return l.active === 'candidate' ? 'candidate' : 'select'
  return null
}

/** A pane's view set (and its twin's, while Compare's are linked). */
function setView(id: PaneId, view: ZoomView): void {
  useLibZoom.setState((s) => {
    const views = { ...s.views, [id]: view }
    if (s.linked && id !== 'loupe') {
      views.select = view
      views.candidate = view
    }
    return { views }
  })
}

/** The box's centre, where a key zooms when the pointer is elsewhere. */
const centre = (v: Viewport): P => ({ x: v.box.w / 2, y: v.box.h / 2 })

async function zoomWith(
  id: PaneId | null,
  fn: (v: Viewport, view: ZoomView, at: P) => ZoomView
): Promise<void> {
  if (!id) return
  const pane = panes.get(id)
  if (!pane) return
  // The photo's full size first: 1:1 means its pixels, not the preview's.
  const v = (await pane.full()) ?? pane.viewport()
  if (!v) return
  const view = useLibZoom.getState().views[id]
  setView(id, fn(v, view, pane.pointer() ?? centre(v)))
}

export const libZoom = {
  /** Z, or a click: Fit and 1:1 in turn, at the pointer. */
  toggle: (id = keyPane()): Promise<void> =>
    zoomWith(id, (v, view, at) => (view.scale === 'fit' ? zoomTo(v, view, 1, at) : FIT)),
  zoomIn: (id = keyPane()): Promise<void> => zoomWith(id, (v, view, at) => zoomAt(v, view, 2, at)),
  zoomOut: (id = keyPane()): Promise<void> =>
    zoomWith(id, (v, view, at) => zoomAt(v, view, 0.5, at)),
  fit: (id = keyPane()): void => {
    if (id) setView(id, FIT)
  },
  /** A drag or a scroll moved the zoomed picture by (dx, dy) box pixels. */
  pan(id: PaneId, dx: number, dy: number): void {
    const v = panes.get(id)?.viewport()
    if (!v) return
    setView(id, panBy(v, useLibZoom.getState().views[id], dx, dy))
  },
  /** L: Compare's panes zoom together, or apart. */
  toggleLink(): void {
    const s = useLibZoom.getState()
    const linked = !s.linked
    // Linked again: both follow the pane the keys act on.
    const lead = keyPane() === 'candidate' ? 'candidate' : 'select'
    useLibZoom.setState({
      linked,
      views: linked ? { ...s.views, select: s.views[lead], candidate: s.views[lead] } : s.views
    })
  },
  /** The pane's scale as a share of 1:1, for its chip (null when fitted). */
  percent(id: PaneId): number | null {
    const view = useLibZoom.getState().views[id]
    const v = panes.get(id)?.viewport()
    if (view.scale === 'fit' || !v) return null
    return Math.round(scaleOf(v, view) * 100)
  }
}
