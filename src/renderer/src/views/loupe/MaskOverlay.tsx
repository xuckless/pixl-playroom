import { memo, type CSSProperties } from 'react'
import type { ViewGeometry } from '../../../../shared/view'
import { useDevelop, wholeFrameTool } from '../../state/develop'
import { useUi, type OverlayMode } from '../../state/ui'
import { MaskCanvas } from './maskgl/MaskCanvas'
import { useMaskGlBroken } from './maskgl/state'

/** Tools that draw a mask: their overlay stays while they are in hand. */
const MASK_DRAWING: ReadonlySet<string> = new Set([
  'brush',
  'polygon',
  'linear',
  'radial',
  'bidirectional',
  'range-picker'
])

/** Whether the masks window is up and unfolded (its overlay shows only then). */
function useMasksShown(): boolean {
  return useUi((s) => s.masksWin.open && !s.masksWin.minimized)
}

/** Golden-angle hues, so every mask in "show all" gets its own colour. */
const hueFor = (i: number, base: number): number => (base + i * 137.5) % 360

function maskStyle(url: string): CSSProperties {
  return { maskImage: `url("${url}")`, WebkitMaskImage: `url("${url}")` }
}

/** Everywhere the mask is not: a solid layer with the plane cut out of it. */
function inverseStyle(url: string): CSSProperties {
  const layers = `url("${url}"), linear-gradient(#000, #000)`
  return {
    maskImage: layers,
    WebkitMaskImage: layers,
    maskMode: 'luminance, alpha',
    maskComposite: 'exclude',
    WebkitMaskComposite: 'xor'
  }
}

/** A mask plane shown over the picture in one of Lightroom's overlay modes. */
export const MaskPlane = memo(function MaskPlane({
  url,
  mode,
  hue,
  opacity
}: {
  url: string
  mode: OverlayMode
  hue: number
  opacity: number
}): React.JSX.Element {
  const a = opacity / 100
  switch (mode) {
    // Frosted glass without the loupe's own drawing: the photo blurred and
    // lifted where the mask is, faintly tinted.
    case 'glass':
      return (
        <div
          className="mask-overlay glass"
          style={{
            ...maskStyle(url),
            background: `hsl(${hue} 90% 55% / ${Math.min(0.3, a * 0.5)})`,
            opacity: 1
          }}
        />
      )
    // The outline needs the loupe's own drawing; CSS shows the colour instead.
    case 'color':
    case 'color-bw':
    case 'outline':
      return (
        <div
          className="mask-overlay"
          style={{ ...maskStyle(url), background: `hsl(${hue} 90% 55%)`, opacity: a }}
        />
      )
    case 'image-black':
    case 'image-white':
      return (
        <div
          className="mask-overlay matte"
          style={{
            ...inverseStyle(url),
            background: mode === 'image-black' ? '#000' : '#fff',
            opacity: Math.max(a, 0.85)
          }}
        />
      )
    case 'white-black':
      return (
        <>
          <div className="mask-overlay matte" style={{ background: '#000', opacity: 1 }} />
          <div
            className="mask-overlay matte"
            style={{ ...maskStyle(url), background: '#fff', opacity: 1 }}
          />
        </>
      )
  }
})

/**
 * The overlay for the loupe: the selected mask in the chosen mode, or with
 * "show all", every mask in its own colour from the masks' thumbnails. A
 * mask hovered in the masks panel (or on its pin) shows over it, in its own
 * colour, overlay on or off.
 */
export function MaskOverlay({
  g,
  w,
  h
}: {
  g: ViewGeometry | null
  w: number
  h: number
}): React.JSX.Element | null {
  const tool = useDevelop((s) => s.tool)
  const showAll = useUi((s) => s.maskOverlay.showAll)
  const autoToggle = useUi((s) => s.maskOverlay.autoToggle)
  const broken = useMaskGlBroken((s) => s.broken)
  const masksUp = useMasksShown()
  if (wholeFrameTool(tool)) return null
  // Put away (closed, or folded to its pill), the masks take their overlay
  // with them, unless a mask tool is still drawing.
  if (!masksUp && !MASK_DRAWING.has(tool)) return null
  // The loupe draws the selected mask itself where it can (in step with the
  // edit, then the engine's); every mask at once, and the fallback, are CSS.
  const gl = g !== null && !showAll && !broken
  return (
    // While a slider moves the overlay steps aside (auto toggle), so the edit shows.
    <div className={`mask-layer${autoToggle ? ' auto-hide' : ''}`}>
      {gl ? <MaskCanvas g={g} w={w} h={h} /> : <SelectedOverlay />}
      {gl ? <HoverCanvas g={g} w={w} h={h} /> : <HoverOverlay />}
    </div>
  )
}

/**
 * The mask under the pointer in the masks panel (or on its pin), drawn by
 * the loupe like the selected one: sharp, feathered, in its own colour,
 * overlay on or off. Kept mounted, so hovering down the list only redraws.
 */
function HoverCanvas({ g, w, h }: { g: ViewGeometry; w: number; h: number }): React.JSX.Element {
  const hoverLayer = useDevelop((s) => s.hoverLayer)
  const layerId = useDevelop((s) => s.layerId)
  const overlay = useDevelop((s) => s.overlay)
  // The selected mask already shows while the overlay is on.
  const shown = hoverLayer && !(hoverLayer === layerId && overlay) ? hoverLayer : null
  return <MaskCanvas g={g} w={w} h={h} hover={shown} />
}

/** The hovered mask without the loupe's drawing (no WebGL, or every mask shown): its thumbnail. */
function HoverOverlay(): React.JSX.Element | null {
  const hoverLayer = useDevelop((s) => s.hoverLayer)
  const layerId = useDevelop((s) => s.layerId)
  const overlay = useDevelop((s) => s.overlay)
  const mask = useDevelop((s) => s.mask)
  const thumb = useDevelop((s) => (s.hoverLayer ? s.maskThumbs[s.hoverLayer]?.url : undefined))
  const layers = useDevelop((s) => s.recipe?.layers)
  const o = useUi((s) => s.maskOverlay)
  if (!hoverLayer || !layers) return null
  // The selected mask already shows while the overlay is on.
  if (hoverLayer === layerId && overlay && !o.showAll) return null
  const i = layers.findIndex((l) => l.id === hoverLayer)
  const l = layers[i]
  const url = hoverLayer === layerId && mask ? mask.url : thumb
  if (!l || !url) return null
  return (
    <div className="mask-hover">
      <MaskPlane
        url={url}
        mode={o.mode === 'glass' ? 'glass' : 'color'}
        hue={l.overlayHue ?? (hoverLayer === layerId ? o.hue : hueFor(i + 1, o.hue))}
        opacity={Math.max(o.opacity, 55)}
      />
    </div>
  )
}

function SelectedOverlay(): React.JSX.Element | null {
  const mask = useDevelop((s) => s.mask)
  const layerId = useDevelop((s) => s.layerId)
  const overlay = useDevelop((s) => s.overlay)
  const thumbs = useDevelop((s) => s.maskThumbs)
  const layers = useDevelop((s) => s.recipe?.layers ?? [])
  const o = useUi((s) => s.maskOverlay)
  if (!overlay) return null
  if (o.showAll) {
    return (
      <>
        {layers.map((l, i) => {
          const t = l.id === layerId && mask ? mask.url : thumbs[l.id]?.url
          if (!t || !l.enabled) return null
          return (
            <MaskPlane
              key={l.id}
              url={t}
              mode="color"
              hue={l.overlayHue ?? (l.id === layerId ? o.hue : hueFor(i + 1, o.hue))}
              opacity={l.id === layerId ? o.opacity : o.opacity * 0.7}
            />
          )
        })}
      </>
    )
  }
  if (!mask || !layerId) return null
  const hue = layers.find((l) => l.id === layerId)?.overlayHue ?? o.hue
  return <MaskPlane url={mask.url} mode={o.mode} hue={hue} opacity={o.opacity} />
}
