import { useCallback, useEffect, useMemo, useState } from 'react'
import { type MaskComponentSetting } from '../../../../shared/recipe'
import {
  displaySize,
  displayToOriented,
  fitRect,
  normalisedIn,
  viewGeometry,
  type Rect
} from '../../../../shared/view'
import { api, errorText } from '../../lib/api'
import { emptyRange } from '../../lib/helpers'
import { samplePatch } from '../../lib/image'
import { useDevelop } from '../../state/develop'
import { useLibrary } from '../../state/library'
import { BrushLayer } from './BrushTool'
import { ClippingOverlay } from './ClippingOverlay'
import { CropTool } from './CropTool'
import { DecodedImage } from './DecodedImage'
import { Guides } from './Guides'
import { PolygonLayer } from './LassoTool'
import { LoupeHud } from './LoupeHud'
import { RegionView } from './RegionView'
import { regionCentre } from './regionCentre'
import { useSize } from './useSize'

/** How long the loupe must keep a size before the renderer is asked for that many pixels. */
const EDGE_SETTLE_MS = 250

export function Loupe(): React.JSX.Element {
  const session = useDevelop((s) => s.session)
  const recipe = useDevelop((s) => s.recipe)
  const picture = useDevelop((s) => s.picture)
  const before = useDevelop((s) => s.before)
  const mask = useDevelop((s) => s.mask)
  const tool = useDevelop((s) => s.tool)
  const compare = useDevelop((s) => s.compare)
  const clipping = useDevelop((s) => s.clipping)
  const zoom = useDevelop((s) => s.zoom)
  const overlay = useDevelop((s) => s.overlay)
  const layerId = useDevelop((s) => s.layerId)
  const loading = useDevelop((s) => s.loading)
  const error = useDevelop((s) => s.error)
  const setTool = useDevelop((s) => s.setTool)
  const setZoom = useDevelop((s) => s.setZoom)
  const replace = useDevelop((s) => s.replace)
  const setTargetEdge = useDevelop((s) => s.setTargetEdge)
  const gesture = useDevelop((s) => s.gesture)
  const [boxRef, size] = useSize()
  const [split, setSplit] = useState(0.5)

  // A loupe being resized (a panel sliding open, the window dragged) asks
  // for new pixels once it has settled, not on every frame of the change.
  useEffect(() => {
    if (size.w <= 0) return
    const t = setTimeout(
      () => setTargetEdge(Math.round(Math.max(size.w, size.h) * (window.devicePixelRatio || 1))),
      EDGE_SETTLE_MS
    )
    return () => clearTimeout(t)
  }, [size.w, size.h, setTargetEdge])

  const g = useMemo(
    () =>
      session && recipe
        ? viewGeometry(recipe, session.frameWidth, session.frameHeight, tool === 'crop')
        : null,
    [session, recipe, tool]
  )

  // Where the picture sits in the loupe. In the crop tool the frame comes
  // from the geometry, which a render cannot change, so the crop box and the
  // picture under it hold still while renders come and go. Elsewhere the
  // picture's own aspect is shown; the geometry is the fallback.
  const rect: Rect | null = useMemo(() => {
    if (size.w === 0) return null
    const fromGeometry = (): Rect | null => {
      if (!g) return null
      const d = displaySize(g)
      return fitRect(size, d.width, d.height)
    }
    if (tool === 'crop')
      return fromGeometry() ?? (picture ? fitRect(size, picture.width, picture.height, 4) : null)
    if (picture && !picture.cropMode) return fitRect(size, picture.width, picture.height, 4)
    return fromGeometry() ?? (picture ? fitRect(size, picture.width, picture.height, 4) : null)
  }, [picture, size, g, tool])

  const pick = useCallback(
    async (e: React.MouseEvent<HTMLDivElement>) => {
      if (!session || !recipe || !g || !rect) return
      const box = e.currentTarget.getBoundingClientRect()
      const p = normalisedIn(e.clientX, e.clientY, {
        left: box.left + rect.x,
        top: box.top + rect.y,
        width: rect.w,
        height: rect.h
      })
      if (p.x < 0 || p.y < 0 || p.x > 1 || p.y > 1) return
      if (tool === 'wb-picker') {
        const o = displayToOriented(g, p)
        try {
          const s = await api.develop.sample(session.key, o.x, o.y)
          if (!s.wb)
            return useLibrary
              .getState()
              .say('That pixel cannot be made neutral (a channel is black)', 'error')
          replace(
            {
              ...recipe,
              wb: { mode: 'custom', temperature: s.wb.temperature, tint: s.wb.tint, preset: null }
            },
            'White balance: picker'
          )
          if (s.wb.clamped)
            useLibrary.getState().say('The picked white reached the end of the range')
        } catch (err) {
          useLibrary.getState().say(errorText(err), 'error')
        }
        setTool('none')
      } else if (tool === 'range-picker' && picture) {
        const layer = recipe.layers.find((l) => l.id === layerId)
        if (!layer) return useLibrary.getState().say('Select a mask first', 'error')
        const [r, gg, b] = await samplePatch(picture.url, p.x, p.y)
        const max = Math.max(r, gg, b)
        const min = Math.min(r, gg, b)
        const chroma = max - min
        let hue = 0
        if (chroma > 0) {
          if (max === r) hue = 60 * (((gg - b) / chroma + 6) % 6)
          else if (max === gg) hue = 60 * ((b - r) / chroma + 2)
          else hue = 60 * ((r - gg) / chroma + 4)
        }
        const sat = max > 0 ? chroma / max : 0
        const luma = 0.2289 * r + 0.6917 * gg + 0.0793 * b // Display P3 luminance weights
        const next = structuredClone(recipe)
        const l = next.layers.find((x) => x.id === layerId)
        if (!l) return
        let comp: MaskComponentSetting | undefined = [...l.components]
          .reverse()
          .find((x) => x.kind === 'range')
        if (!comp) {
          comp = emptyRange(sat > 0.15 ? 'color' : 'luminance')
          l.components.push(comp)
        }
        if (comp.kind === 'range') {
          if (comp.hue || sat > 0.15)
            comp.hue = { centre: Math.round(hue), width: 30, softness: 20 }
          if (comp.saturation || sat > 0.15)
            comp.saturation = { centre: Math.round(sat * 100) / 100, width: 0.5, softness: 0.2 }
          if (comp.luma || sat <= 0.15)
            comp.luma = { centre: Math.round(luma * 100) / 100, width: 0.25, softness: 0.12 }
        }
        replace(next, 'Pick range')
        setTool('none')
      }
    },
    [session, recipe, g, rect, tool, picture, layerId, replace, setTool]
  )

  if (loading) return <div className="loupe empty">Developing…</div>
  if (!session || !recipe) return <div className="loupe empty">{error ?? 'Choose a photo'}</div>
  if (zoom === 1) {
    return (
      <div ref={boxRef} className="loupe">
        {size.w > 0 && <RegionView size={size} />}
      </div>
    )
  }
  const shown = compare === 'before' && before ? before : picture
  const rotate =
    tool === 'crop' && recipe.geometry.straighten !== 0
      ? `rotate(${recipe.geometry.straighten}deg)`
      : undefined
  return (
    <div
      ref={boxRef}
      className={`loupe tool-${tool}`}
      onClick={(e) => {
        if (tool === 'wb-picker' || tool === 'range-picker') void pick(e)
      }}
      onDoubleClick={(e) => {
        if (tool !== 'none' || !g || !rect) return
        const box = e.currentTarget.getBoundingClientRect()
        const p = normalisedIn(e.clientX, e.clientY, {
          left: box.left + rect.x,
          top: box.top + rect.y,
          width: rect.w,
          height: rect.h
        })
        regionCentre.value = displayToOriented(g, p)
        setZoom(1)
      }}
    >
      {shown && rect && (
        <div
          className="picture"
          style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, transform: rotate }}
        >
          <DecodedImage src={shown.url} />
          {compare === 'split' && before && (
            <div
              className="split-before"
              style={{ clipPath: `inset(0 ${(1 - split) * 100}% 0 0)` }}
            >
              <DecodedImage src={before.url} />
            </div>
          )}
          {mask && overlay && layerId && tool !== 'crop' && (
            <div
              className="mask-overlay"
              style={{ maskImage: `url("${mask.url}")`, WebkitMaskImage: `url("${mask.url}")` }}
            />
          )}
          {clipping && picture && <ClippingOverlay url={picture.url} />}
        </div>
      )}
      {compare === 'split' && rect && (
        <div
          className="split-handle"
          style={{ left: rect.x + rect.w * split, top: rect.y, height: rect.h }}
          onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
          onPointerMove={(e) => {
            if (e.buttons !== 1) return
            const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
            setSplit(Math.min(1, Math.max(0, (e.clientX - box.left - rect.x) / rect.w)))
          }}
        />
      )}
      {tool === 'crop' && rect && g && <CropTool rect={rect} g={g} />}
      {gesture === 'straighten' && tool !== 'crop' && rect && (
        // Straightening from the panel: a fine grid over the picture to line a horizon up against.
        <div
          className="straighten-grid"
          style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
        >
          <Guides kind="grid" w={rect.w} h={rect.h} fine strong />
        </div>
      )}
      {tool === 'brush' && rect && g && <BrushLayer rect={rect} g={g} />}
      {tool === 'polygon' && rect && g && <PolygonLayer rect={rect} g={g} />}
      <LoupeHud />
    </div>
  )
}
