import { memo, useEffect, useRef, useState } from 'react'
import type { MaskMode } from '../../../../shared/engine-types'
import { newId, type PolygonComponent } from '../../../../shared/recipe'
import { simplifyPath } from '../../../../shared/simplify'
import {
  baseToDisplay,
  displayToBase,
  normalisedIn,
  type P,
  type Rect,
  type ViewGeometry
} from '../../../../shared/view'
import { useDevelop } from '../../state/develop'
import { useUi } from '../../state/ui'
import { createMask, madeComponent, modeForNew } from '../../panels/masks/model'
import { useMaskDraft, useMaskGlBroken } from './maskgl/state'
import { t, tk } from '../../lib/i18n'

// ── Lasso ────────────────────────────────────────────────────────────────────

/** A click this near the first point (px) closes the lasso. */
const CLOSE_PX = 10
/** A click this near the last point (px) adds nothing (a double-click's second click). */
const SAME_PX = 4
/** A drag lays a point each time it has gone this far (px). */
const FREEHAND_STEP_PX = 3
/** How far a freehand path may stray from its simplified outline (px). */
const SIMPLIFY_PX = 0.75

/** A new lasso's edge: its feather inside the line drawn, not half outside it. */
const LASSO_FEATHER = 3

/**
 * The lasso: click to lay straight edges, drag to draw freehand, both in the
 * same outline. A shape drawn in one drag closes when let go (Photoshop's
 * lasso); otherwise click the first point, double-click or press Enter.
 * Backspace takes back the last point and Esc drops the outline (a second
 * Esc puts the tool down). Alt, held, subtracts, and the preview shows it.
 * While it is drawn the loupe's own mask shows it as it will be (feather
 * and all) through a draft component; the outline here is only its line.
 */
export const PolygonLayer = memo(function PolygonLayer({
  rect,
  g
}: {
  rect: Rect
  g: ViewGeometry
}): React.JSX.Element {
  const addMode = useDevelop((s) => s.addMode)
  const overlayHue = useUi((s) => s.maskOverlay.hue)
  const layerHue = useDevelop((s) => s.recipe?.layers.find((l) => l.id === s.layerId)?.overlayHue)
  const showAll = useUi((s) => s.maskOverlay.showAll)
  const glOff = useMaskGlBroken((s) => s.broken) || showAll
  const [pts, setPtsState] = useState<P[]>([])
  // The outline as of the last event, ahead of the next render (a fast
  // freehand drag lands several moves between renders).
  const list = useRef<P[]>([])
  const setPts = (next: P[] | ((was: P[]) => P[])): void => {
    list.current = typeof next === 'function' ? next(list.current) : next
    setPtsState(list.current)
  }
  const [hover, setHover] = useState<P | null>(null)
  const [alt, setAlt] = useState(false)
  // The press in progress: where it began, and whether it has drawn freehand.
  const press = useRef<{
    x: number
    y: number
    moved: boolean
    closing: boolean
    fresh: boolean
  } | null>(null)
  const px = (a: P, b: P): number => Math.hypot((a.x - b.x) * rect.w, (a.y - b.y) * rect.h)
  const at = (e: React.PointerEvent | React.MouseEvent): P =>
    normalisedIn(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect())
  const subtract = alt || addMode === 'Subtract'

  /** The mode the shape will join with, given what the mask holds now. */
  const modeNow = (sub: boolean): MaskMode => {
    const d = useDevelop.getState()
    const l = d.recipe?.layers.find((x) => x.id === d.layerId)
    if (!l || l.components.length === 0) return 'Add'
    return sub ? 'Subtract' : modeForNew(l)
  }

  /** The outline as a component, in the base frame (simplified when it closes). */
  const component = (list: P[], sub: boolean, simplify: boolean): PolygonComponent => {
    const shown = simplify
      ? simplifyPath(
          list.map((p) => ({ x: p.x * rect.w, y: p.y * rect.h })),
          SIMPLIFY_PX
        ).map((p) => ({ x: p.x / rect.w, y: p.y / rect.h }))
      : list
    return {
      id: 'draft',
      kind: 'polygon',
      mode: modeNow(sub),
      opacity: 100,
      invert: false,
      feather: LASSO_FEATHER,
      edge: { shift: 0, harden: 0, inside: true },
      points: shown.map((p) => {
        const b = displayToBase(g, p)
        return { x: Math.min(1, Math.max(0, b.x)), y: Math.min(1, Math.max(0, b.y)) }
      })
    }
  }

  const cancel = (): void => {
    press.current = null
    setPts([])
  }

  const close = (list: P[], sub: boolean): void => {
    press.current = null
    setPts([])
    const d = useDevelop.getState()
    if (list.length < 3 || !d.layerId) return
    const c = { ...component(list, sub, true), id: newId() }
    if (c.points.length < 3) return
    d.edit((r) => {
      r.layers.find((x) => x.id === d.layerId)?.components.push(c)
    })
    d.commit(c.mode === 'Subtract' ? tk('Lasso subtract') : tk('Lasso'))
    madeComponent(c.id)
  }

  const add = (p: P): void => {
    // Drawing needs a mask to draw into: a new one, as the gradients make.
    if (!useDevelop.getState().layerId) createMask()
    setPts((list) => {
      const last = list[list.length - 1]
      return last && px(p, last) < SAME_PX ? list : [...list, p]
    })
  }

  // The draft the loupe's mask shows: the outline so far, to the pointer.
  useEffect(() => {
    const list = hover && pts.length > 0 ? [...pts, hover] : pts
    const raf = requestAnimationFrame(() =>
      useMaskDraft.setState({ draft: list.length >= 3 ? component(list, subtract, false) : null })
    )
    return () => cancelAnimationFrame(raf)
    // `component` reads the geometry it is given; the outline is what changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pts, hover, subtract, g, rect.w, rect.h])
  useEffect(() => () => useMaskDraft.setState({ draft: null }), [])

  // Keys while an outline is being drawn, ahead of the app's shortcuts:
  // Backspace is the last point here, not the selected component.
  useEffect(() => {
    const typing = (e: KeyboardEvent): boolean => {
      const el = e.target as HTMLElement | null
      return (
        !!el &&
        (el.tagName === 'TEXTAREA' ||
          (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'text'))
      )
    }
    const down = (e: KeyboardEvent): void => {
      if (e.key === 'Alt') setAlt(true)
      if (typing(e) || pts.length === 0) return
      const take = (): void => {
        e.preventDefault()
        e.stopImmediatePropagation()
      }
      if (e.key === 'Escape') {
        take()
        cancel()
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        take()
        setPts((list) => list.slice(0, -1))
      } else if (e.key === 'Enter') {
        take()
        close(list.current, e.altKey || addMode === 'Subtract')
      }
    }
    const up = (e: KeyboardEvent): void => {
      if (e.key === 'Alt') setAlt(false)
    }
    const blur = (): void => setAlt(false)
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
      window.removeEventListener('blur', blur)
    }
  })

  const nearFirst = pts.length >= 3 && hover !== null && px(hover, pts[0]) < CLOSE_PX
  const path = (list: P[]): string => list.map((p) => `${p.x * rect.w},${p.y * rect.h}`).join(' ')
  const line = hover && pts.length > 0 ? [...pts, nearFirst ? pts[0] : hover] : pts
  const hue = layerHue ?? overlayHue
  return (
    <div
      className={`tool-layer polygon${nearFirst ? ' closing' : ''}`}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        setAlt(e.altKey)
        const p = at(e)
        const closing = pts.length >= 3 && px(p, pts[0]) < CLOSE_PX
        press.current = {
          x: e.clientX,
          y: e.clientY,
          moved: false,
          closing,
          fresh: pts.length === 0
        }
        if (!closing) add(p)
      }}
      onPointerMove={(e) => {
        const p = at(e)
        setHover(p)
        if (alt !== e.altKey) setAlt(e.altKey)
        const pr = press.current
        if (!pr) return
        if (!pr.moved && Math.hypot(e.clientX - pr.x, e.clientY - pr.y) < SAME_PX) return
        pr.moved = true
        pr.closing = false
        setPts((list) => {
          const last = list[list.length - 1]
          return last && px(p, last) < FREEHAND_STEP_PX ? list : [...list, p]
        })
      }}
      onPointerUp={(e) => {
        const pr = press.current
        press.current = null
        if (!pr) return
        const sub = e.altKey || addMode === 'Subtract'
        // A click on the first point closes; so does letting go of a shape
        // drawn in one drag.
        if (pr.closing && !pr.moved) close(list.current, sub)
        else if (pr.fresh && pr.moved) close(list.current, sub)
      }}
      onPointerCancel={cancel}
      onPointerLeave={() => setHover(null)}
      onDoubleClick={(e) => close(list.current, e.altKey || addMode === 'Subtract')}
    >
      <svg width={rect.w} height={rect.h}>
        {glOff && line.length >= 3 && (
          // Without the loupe's own mask (show all, no WebGL): a plain fill.
          <polygon
            points={path(line)}
            className="poly-fallback"
            style={subtract ? undefined : { fill: `hsl(${hue} 90% 55% / 0.3)` }}
          />
        )}
        {line.length > 1 && (
          <polyline points={path(line)} className={`poly drawing${subtract ? ' subtract' : ''}`} />
        )}
        {pts.map((p, i) => (
          <circle
            key={i}
            cx={p.x * rect.w}
            cy={p.y * rect.h}
            r={i === 0 ? (nearFirst ? 7 : 5) : 2.5}
            className={`poly-point${i === 0 && nearFirst ? ' close' : ''}`}
          />
        ))}
      </svg>
    </div>
  )
})

/**
 * The selected lasso's points, editable after it was drawn: drag a point to
 * move it, Alt-click to remove it (three stay), double-click an edge to add
 * one there.
 */
export const LassoEditor = memo(function LassoEditor({
  rect,
  g
}: {
  rect: Rect
  g: ViewGeometry
}): React.JSX.Element | null {
  const compId = useDevelop((s) => s.compId)
  const comp = useDevelop((s) =>
    s.recipe?.layers.flatMap((l) => l.components).find((c) => c.id === s.compId)
  )
  const edit = useDevelop((s) => s.edit)
  const commit = useDevelop((s) => s.commit)
  const masksUp = useUi((s) => s.masksWin.open)
  const tool = useDevelop((s) => s.tool)
  const drag = useRef<{ i: number; moved: boolean } | null>(null)
  const svg = useRef<SVGSVGElement>(null)
  if (!comp || comp.kind !== 'polygon' || !masksUp || tool === 'heal') return null
  const pts = comp.points.map((p) => baseToDisplay(g, p))
  const toBase = (e: React.PointerEvent | React.MouseEvent): P => {
    const b = svg.current?.getBoundingClientRect()
    const d = b ? normalisedIn(e.clientX, e.clientY, b) : { x: 0, y: 0 }
    const q = displayToBase(g, d)
    return { x: Math.min(1, Math.max(0, q.x)), y: Math.min(1, Math.max(0, q.y)) }
  }
  const setPoints = (fn: (points: P[]) => P[], live: boolean): void =>
    edit((r) => {
      for (const l of r.layers) {
        const c = l.components.find((x) => x.id === compId)
        if (c?.kind === 'polygon') c.points = fn(c.points)
      }
    }, live)
  return (
    <svg
      ref={svg}
      className="lasso-editor on-hover"
      width={rect.w}
      height={rect.h}
      style={{ left: rect.x, top: rect.y }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        d.moved = true
        const q = toBase(e)
        setPoints((p) => p.map((x, i) => (i === d.i ? q : x)), true)
      }}
      onPointerUp={() => {
        const d = drag.current
        drag.current = null
        if (d?.moved) commit(tk('Move lasso point'))
      }}
    >
      {pts.map((p, i) => {
        const q = pts[(i + 1) % pts.length]
        return (
          <line
            key={`e${i}`}
            className="lasso-edge"
            x1={p.x * rect.w}
            y1={p.y * rect.h}
            x2={q.x * rect.w}
            y2={q.y * rect.h}
            onDoubleClick={(e) => {
              e.stopPropagation()
              const at = toBase(e)
              setPoints((list) => [...list.slice(0, i + 1), at, ...list.slice(i + 1)], false)
              commit(tk('Add lasso point'))
            }}
          >
            <title>{t('Double-click to add a point')}</title>
          </line>
        )
      })}
      {pts.map((p, i) => (
        <circle
          key={`v${i}`}
          className="lasso-vertex"
          cx={p.x * rect.w}
          cy={p.y * rect.h}
          r={5}
          onPointerDown={(e) => {
            e.stopPropagation()
            if (e.altKey) {
              if (pts.length > 3) {
                setPoints((list) => list.filter((_, j) => j !== i), false)
                commit(tk('Remove lasso point'))
              }
              return
            }
            ;(e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(e.pointerId)
            drag.current = { i, moved: false }
          }}
        >
          <title>{t('Drag to move · Alt-click to remove')}</title>
        </circle>
      ))}
    </svg>
  )
})
