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
 * "show all", every mask in its own colour from the masks' thumbnails.
 */
export function MaskOverlay(): React.JSX.Element | null {
  const mask = useDevelop((s) => s.mask)
  const layerId = useDevelop((s) => s.layerId)
  const overlay = useDevelop((s) => s.overlay)
  const tool = useDevelop((s) => s.tool)
  const thumbs = useDevelop((s) => s.maskThumbs)
  const layers = useDevelop((s) => s.recipe?.layers ?? [])
  const o = useUi((s) => s.maskOverlay)
  if (!overlay || tool === 'crop') return null
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
              hue={l.id === layerId ? o.hue : hueFor(i + 1, o.hue)}
              opacity={l.id === layerId ? o.opacity : o.opacity * 0.7}
            />
          )
        })}
      </>
    )
  }
  if (!mask || !layerId) return null
  return <MaskPlane url={mask.url} mode={o.mode} hue={o.hue} opacity={o.opacity} />
}
