import { memo, type CSSProperties } from 'react'
import { useDevelop } from '../../state/develop'
import { useUi, type OverlayMode } from '../../state/ui'

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
    case 'color':
    case 'color-bw':
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
export function MaskOverlay(): React.JSX.Element | null {
  const tool = useDevelop((s) => s.tool)
  if (tool === 'crop') return null
  return (
    <>
      <SelectedOverlay />
      <HoverOverlay />
    </>
  )
}

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
        mode="color"
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
