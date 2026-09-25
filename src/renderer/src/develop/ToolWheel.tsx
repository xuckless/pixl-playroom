import { useEffect, useRef, useState } from 'react'
import { LiquidGlass } from '../components/glass/LiquidGlass'
import { Icon } from '../components/icons'
import { cyclicOffset, dragPlaces, wheelItem, wheelStep, wrapIndex } from '../lib/wheel'
import { useUi } from '../state/ui'
import { selectPanel, stepPanel, TOOLS } from './tools'

/** A wheel notch may not turn faster than this. */
const WHEEL_GAP_MS = 90

/**
 * The thumb-wheel: tool names on a small drum turning past a fixed pointer.
 * Scroll it, drag it, click a name, use the arrows, or focus it and use the
 * arrow keys. Names fade and frost as they roll away under frosted liquid
 * glass; the one at the pointer sits under a magnifying glass lens.
 */
export function ToolWheel(): React.JSX.Element {
  const panel = useUi((s) => s.panel)
  const n = TOOLS.length
  const index = Math.max(
    0,
    TOOLS.findIndex((t) => t.id === panel)
  )
  const [drag, setDrag] = useState<number | null>(null)
  const pointer = useRef<{ y0: number; moved: boolean } | null>(null)
  const drum = useRef<HTMLDivElement>(null)
  const acc = useRef(0)
  const last = useRef(0)

  // React's wheel handler is passive; this one must stop the panel scrolling.
  useEffect(() => {
    const el = drum.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const r = wheelStep(acc.current, e.deltaY)
      acc.current = r.acc
      const now = performance.now()
      if (r.step !== 0 && now - last.current > WHEEL_GAP_MS) {
        last.current = now
        stepPanel(r.step)
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const at = index + (drag ?? 0)
  return (
    <div
      className={`tw${drag !== null ? ' dragging' : ''}`}
      role="listbox"
      aria-label="Tool"
      aria-activedescendant={`tw-${panel}`}
      tabIndex={0}
      onKeyDown={(e) => {
        const k = e.key
        if (k === 'ArrowUp' || k === 'ArrowLeft') stepPanel(-1)
        else if (k === 'ArrowDown' || k === 'ArrowRight') stepPanel(1)
        else if (k === 'Home') selectPanel(TOOLS[0].id)
        else if (k === 'End') selectPanel(TOOLS[n - 1].id)
        else return
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <div
        ref={drum}
        className="tw-drum"
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.currentTarget.setPointerCapture(e.pointerId)
          pointer.current = { y0: e.clientY, moved: false }
        }}
        onPointerMove={(e) => {
          const p = pointer.current
          if (!p) return
          const dy = e.clientY - p.y0
          if (!p.moved && Math.abs(dy) < 3) return
          p.moved = true
          setDrag(dragPlaces(dy))
        }}
        onPointerUp={(e) => {
          const p = pointer.current
          pointer.current = null
          if (p?.moved) {
            selectPanel(TOOLS[wrapIndex(index + (drag ?? 0), n)].id)
            setDrag(null)
            return
          }
          // A click: whichever name is under the pointer.
          const hit = document
            .elementFromPoint(e.clientX, e.clientY)
            ?.closest<HTMLElement>('[data-tool]')
          if (hit?.dataset.tool) selectPanel(hit.dataset.tool as (typeof TOOLS)[number]['id'])
        }}
        onPointerCancel={() => {
          pointer.current = null
          setDrag(null)
        }}
      >
        <div className="tw-stack">
          {TOOLS.map((t, i) => {
            const off = cyclicOffset(i, at, n)
            const pose = wheelItem(off)
            const on = i === index && drag === null
            return (
              <div
                key={t.id}
                id={`tw-${t.id}`}
                role="option"
                aria-selected={i === index}
                data-tool={t.id}
                className={`tw-item${on ? ' on' : ''}`}
                style={{
                  transform: `translateY(${pose.y}px) rotateX(${pose.rx}deg) scale(${pose.scale})`,
                  opacity: pose.hidden ? 0 : pose.opacity,
                  filter: pose.blur > 0.05 ? `blur(${pose.blur}px)` : undefined,
                  visibility: pose.hidden ? 'hidden' : undefined
                }}
              >
                <span className="tick" />
                {t.short}
              </div>
            )
          })}
        </div>
      </div>
      <LiquidGlass className="tw-cap top" frost={2.5} bezel={6} strength={0.5} aria-hidden />
      <LiquidGlass className="tw-cap bottom" frost={2.5} bezel={6} strength={0.5} aria-hidden />
      <LiquidGlass
        className="tw-notch"
        radius={2}
        bezel={4}
        strength={0.55}
        frost={0}
        magnify
        aria-hidden
      />
      <div className="tw-arrows up">
        <button className="icon" aria-label="Previous tool" onClick={() => stepPanel(-1)}>
          <Icon name="chevronUp" />
        </button>
      </div>
      <div className="tw-arrows down">
        <button className="icon" aria-label="Next tool" onClick={() => stepPanel(1)}>
          <Icon name="chevronDown" />
        </button>
      </div>
    </div>
  )
}
