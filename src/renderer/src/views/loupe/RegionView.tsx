import { useEffect, useRef, useState } from 'react'
import type { RegionResult } from '../../../../shared/ipc'
import { viewGeometry, type P } from '../../../../shared/view'
import { LiquidGlass } from '../../components/glass/LiquidGlass'
import { api, errorText } from '../../lib/api'
import { regionCentre } from './regionCentre'
import { MaskPlane } from './MaskOverlay'
import { useUi } from '../../state/ui'
import { useDevelop } from '../../state/develop'

function useRegionCentre(): { get: () => P; set: (p: P) => void } {
  return {
    get: () => regionCentre.value,
    set: (p) => (regionCentre.value = p)
  }
}

// ── 1:1 region view ──────────────────────────────────────────────────────────

export function RegionView({ size }: { size: { w: number; h: number } }): React.JSX.Element {
  const session = useDevelop((s) => s.session)
  const recipe = useDevelop((s) => s.recipe)
  const setZoom = useDevelop((s) => s.setZoom)
  const layerId = useDevelop((s) => s.layerId)
  const showMask = useDevelop((s) => s.overlay && s.layerId !== null)
  const o = useUi((s) => s.maskOverlay)
  const centre = useRegionCentre()
  const [region, setRegion] = useState<RegionResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const drag = useRef<{ x: number; y: number; c: P; moved: boolean } | null>(null)
  const dpr = window.devicePixelRatio || 1
  const g =
    session && recipe ? viewGeometry(recipe, session.frameWidth, session.frameHeight, true) : null
  const vw = Math.round(size.w * dpr)
  const vh = Math.round(size.h * dpr)
  const [c, setC] = useState<P>(centre.get())
  const request = useRef(0)
  useEffect(() => {
    if (!session || !g) return
    const id = ++request.current
    const t = setTimeout(() => {
      setBusy(true)
      const x = Math.round(c.x * g.width - vw / 2)
      const y = Math.round(c.y * g.height - vh / 2)
      api.develop
        .region({
          key: session.key,
          x: Math.max(0, x),
          y: Math.max(0, y),
          width: vw,
          height: vh,
          zoom: 1,
          maskLayer: showMask ? layerId : null
        })
        .then((r) => {
          if (id === request.current) {
            setRegion(r)
            setErr(null)
          }
        })
        .catch((e) => setErr(errorText(e)))
        .finally(() => id === request.current && setBusy(false))
    }, 120)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.x, c.y, vw, vh, recipe, session?.key, showMask, layerId])
  if (!g) return <div />
  const left = region ? (region.x - (c.x * g.width - vw / 2)) / dpr : 0
  const top = region ? (region.y - (c.y * g.height - vh / 2)) / dpr : 0
  return (
    <div
      className="region-view"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { x: e.clientX, y: e.clientY, c, moved: false }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        const dx = ((e.clientX - d.x) * dpr) / g.width
        const dy = ((e.clientY - d.y) * dpr) / g.height
        if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3) d.moved = true
        const next = {
          x: Math.min(1, Math.max(0, d.c.x - dx)),
          y: Math.min(1, Math.max(0, d.c.y - dy))
        }
        setC(next)
        centre.set(next)
      }}
      onPointerUp={() => {
        const d = drag.current
        drag.current = null
        if (d && !d.moved) setZoom('fit')
      }}
    >
      {region && (
        <div
          className="region-frame"
          style={{ left, top, width: region.width / dpr, height: region.height / dpr }}
        >
          <img className="region-img" src={region.url} draggable={false} alt="" />
          {showMask && region.maskUrl && !o.showAll && (
            <MaskPlane url={region.maskUrl} mode={o.mode} hue={o.hue} opacity={o.opacity} />
          )}
        </div>
      )}
      <LiquidGlass className="hud region-badge" radius={2} bezel={8}>
        <span className="hud-item accent">100%</span>
        <span className="hud-item">{busy ? 'Rendering' : region ? `${region.ms} ms` : ''}</span>
        <span className="hud-item muted">uncropped frame · drag to pan · click to fit</span>
        {err && <span className="hud-item error">{err}</span>}
      </LiquidGlass>
    </div>
  )
}
