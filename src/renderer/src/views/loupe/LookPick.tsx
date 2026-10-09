/**
 * A smart look asks the user to point at an object it could not find by
 * itself ("Click the car for Rain City Noir"): a click, or a box dragged
 * around it, on the loupe, sent back to the look's run as SAM2's prompt in
 * the photo's base frame. Esc (or Skip) leaves the object out.
 */
import { memo, useEffect, useRef, useState } from 'react'
import type { FramePoint } from '../../../../shared/looks/smart'
import { displayToBase, normalisedIn, type Rect, type ViewGeometry } from '../../../../shared/view'
import { boxAround } from '../../../../shared/prompt'
import { answerPick } from '../../lib/applyLook'
import { useDevelop } from '../../state/develop'
import { useLooks } from '../../state/looks'
import { rich, t } from '../../lib/i18n'

/** A drag shorter than this (px) is a click. */
const CLICK_PX = 6

export const LookPick = memo(function LookPick({
  rect,
  g
}: {
  rect: Rect
  g: ViewGeometry
}): React.JSX.Element | null {
  const pick = useLooks((s) => s.pick)
  const key = useDevelop((s) => s.session?.key ?? null)
  const tool = useDevelop((s) => s.tool)
  const layer = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const mine = pick !== null && pick.key === key

  // The question was asked while another photo was open: the tool comes up with this one.
  useEffect(() => {
    if (mine && tool !== 'look-pick') useDevelop.getState().setTool('look-pick')
  }, [mine, tool])

  useEffect(() => {
    if (!mine) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      answerPick({ kind: 'skip' })
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [mine])

  if (!mine || tool !== 'look-pick') return null

  const local = (e: React.PointerEvent): { x: number; y: number } => {
    const b = layer.current!.getBoundingClientRect()
    return { x: e.clientX - b.left, y: e.clientY - b.top }
  }
  const toBase = (x: number, y: number): FramePoint => {
    const b = layer.current!.getBoundingClientRect()
    return displayToBase(g, normalisedIn(b.left + x, b.top + y, b))
  }
  const down = (e: React.PointerEvent): void => {
    if (e.button !== 0) return
    e.stopPropagation()
    layer.current?.setPointerCapture(e.pointerId)
    const p = local(e)
    setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
  }
  const move = (e: React.PointerEvent): void => {
    if (!drag) return
    const p = local(e)
    setDrag({ ...drag, x1: p.x, y1: p.y })
  }
  const up = (): void => {
    const d = drag
    setDrag(null)
    if (!d) return
    if (Math.hypot(d.x1 - d.x0, d.y1 - d.y0) < CLICK_PX)
      return answerPick({ kind: 'point', point: toBase(d.x0, d.y0) })
    // The box on screen, as the base frame's box around its four corners: on
    // a straightened or turned view two corners alone would cut it short.
    const r = boxAround([
      toBase(d.x0, d.y0),
      toBase(d.x1, d.y0),
      toBase(d.x0, d.y1),
      toBase(d.x1, d.y1)
    ])
    if (!r) return answerPick({ kind: 'point', point: toBase(d.x0, d.y0) })
    answerPick({
      kind: 'box',
      from: { x: r.x, y: r.y },
      to: { x: r.x + r.width, y: r.y + r.height }
    })
  }

  const box = drag && {
    left: Math.min(drag.x0, drag.x1),
    top: Math.min(drag.y0, drag.y1),
    width: Math.abs(drag.x1 - drag.x0),
    height: Math.abs(drag.y1 - drag.y0)
  }
  return (
    <div
      ref={layer}
      className="tool-layer look-pick"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => setDrag(null)}
    >
      {box && box.width + box.height >= CLICK_PX && <div className="look-pick-box" style={box} />}
      <div className="look-pick-note" onPointerDown={(e) => e.stopPropagation()}>
        <span>
          {rich(
            'Click the {{object}} for {{look}} · drag for a box',
            { object: <strong>{pick.label}</strong> },
            { look: pick.look }
          )}
        </span>
        <button className="sm ghost" onClick={() => answerPick({ kind: 'skip' })}>
          {t('Skip')}
        </button>
      </div>
    </div>
  )
})
