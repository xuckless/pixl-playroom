import { useEffect, useRef, useState } from 'react'
import type { KeyBand } from '../../../../shared/engine-types'
import {
  bandOutline,
  bandPart,
  bandValue,
  dragBand,
  inPlateau,
  type BandPart
} from '../../../../shared/keyband'

/** How near a handle a press must land to take it (px). */
const REACH_PX = 7

const STRIP: Record<'hue' | 'saturation' | 'luma', string> = {
  hue: `linear-gradient(90deg, ${[0, 60, 120, 180, 240, 300, 360].map((h) => `hsl(${h} 85% 55%)`).join(', ')})`,
  saturation: 'linear-gradient(90deg, hsl(210 0% 55%), hsl(210 90% 55%))',
  luma: 'linear-gradient(90deg, #000, #fff)'
}

const CURSOR: Record<BandPart, string> = {
  centre: 'grab',
  'width-left': 'ew-resize',
  'width-right': 'ew-resize',
  'soft-left': 'col-resize',
  'soft-right': 'col-resize'
}

/**
 * One axis of a range mask as Lightroom's luminance-range strip: the axis's
 * own colours under a plateau (full strength) with soft shoulders. Drag the
 * plateau to move it, its edges to widen it, its shoulders' ends to soften
 * it; a press outside it moves it there. The checkbox turns the axis on.
 */
export function BandBar({
  axis,
  label,
  band,
  max,
  def,
  onChange,
  onCommit
}: {
  axis: 'hue' | 'saturation' | 'luma'
  label: string
  band: KeyBand | null
  max: number
  def: KeyBand
  onChange: (band: KeyBand | null) => void
  onCommit: () => void
}): React.JSX.Element {
  const periodic = axis === 'hue'
  const strip = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  const [hover, setHover] = useState<BandPart | null>(null)
  useEffect(() => {
    const el = strip.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const fmt = (v: number): string => (max > 1 ? `${Math.round(v)}°` : `${Math.round(v * 100)}`)
  const at = (clientX: number): number => {
    const r = strip.current!.getBoundingClientRect()
    return ((clientX - r.left) / r.width) * max
  }
  const reach = (): number => (REACH_PX / Math.max(1, strip.current!.clientWidth)) * max

  const down = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!band || e.button !== 0) return
    e.preventDefault()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const v0 = at(e.clientX)
    const v = bandValue(v0, max, periodic)
    const part = bandPart(band, v, max, periodic, reach())
    // A press outside the plateau (and off its handles) moves the band there.
    const from =
      part === 'centre' && !inPlateau(band, v, max, periodic) ? { ...band, centre: v } : band
    if (from !== band) onChange(from)
    let moved = from !== band
    const move = (ev: PointerEvent): void => {
      moved = true
      onChange(dragBand(from, part, at(ev.clientX) - v0, max, periodic))
    }
    const up = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      if (moved) onCommit()
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  return (
    <div className={`band${band ? '' : ' off'}`}>
      <label className="band-head">
        <input
          type="checkbox"
          checked={band !== null}
          onChange={(e) => {
            onChange(e.target.checked ? def : null)
            onCommit()
          }}
        />
        <span className="band-label">{label}</span>
        {band && (
          <span className="band-read t-num">
            {fmt(band.centre)} · ±{fmt(band.width / 2)} · {fmt(band.softness)}
          </span>
        )}
      </label>
      <div
        ref={strip}
        className="band-strip"
        style={{ background: STRIP[axis], cursor: band && hover ? CURSOR[hover] : undefined }}
        title={band ? 'Drag to move · its edges widen · its slopes soften' : undefined}
        onPointerDown={down}
        onPointerMove={(e) => {
          if (!band || e.buttons) return
          setHover(bandPart(band, bandValue(at(e.clientX), max, periodic), max, periodic, reach()))
        }}
        onDoubleClick={() => {
          if (!band) return
          onChange(def)
          onCommit()
        }}
      >
        {band && w > 0 && (
          <svg width={w} height={18} aria-hidden>
            <defs>
              <mask id={`band-${axis}`}>
                <rect width={w} height={18} fill="#fff" />
                {bandOutline(band, max, periodic, w, 18).map((p, i) => (
                  <polygon key={i} points={p} fill="#000" />
                ))}
              </mask>
            </defs>
            <rect width={w} height={18} className="band-dim" mask={`url(#band-${axis})`} />
            {bandOutline(band, max, periodic, w, 18).map((p, i) => (
              <polygon key={i} points={p} className="band-shape" />
            ))}
          </svg>
        )}
      </div>
    </div>
  )
}
