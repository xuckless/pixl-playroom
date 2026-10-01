import { useEffect, useState } from 'react'
import { geometricCentre } from '../../../../shared/masks'
import { baseToDisplay, type Rect, type ViewGeometry } from '../../../../shared/view'
import { LiquidGlass } from '../../components/glass/LiquidGlass'
import { loadImage } from '../../lib/image'
import { useDevelop, wholeFrameTool } from '../../state/develop'
import { useUi } from '../../state/ui'

const centroids = new Map<string, { x: number; y: number } | null>()

/** Where a mask plane's weight sits, normalised; null for an empty plane. */
async function centroidOf(url: string): Promise<{ x: number; y: number } | null> {
  const known = centroids.get(url)
  if (known !== undefined) return known
  const img = await loadImage(url)
  const w = 64
  const h = Math.max(1, Math.round((64 * img.naturalHeight) / img.naturalWidth))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
  ctx.drawImage(img, 0, 0, w, h)
  const d = ctx.getImageData(0, 0, w, h).data
  let sum = 0
  let sx = 0
  let sy = 0
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = d[(y * w + x) * 4]
      sum += v
      sx += v * (x + 0.5)
      sy += v * (y + 0.5)
    }
  const p = sum > 0 ? { x: sx / sum / w, y: sy / sum / h } : null
  if (centroids.size > 200) centroids.clear()
  centroids.set(url, p)
  return p
}

/**
 * A glass pin on each mask, where its selection is centred, as Lightroom
 * shows them: click one to select its mask, hover it to see the mask. A
 * mask made of shapes (gradients, lassos) is pinned between them, so its pin
 * moves with them at once; a painted or keyed one where its plane's weight
 * sits. Pins show while the pointer is over the photo (Auto), always, or
 * never.
 */
export function MaskPins({
  rect,
  g
}: {
  rect: Rect
  g: ViewGeometry | null
}): React.JSX.Element | null {
  const layers = useDevelop((s) => s.recipe?.layers ?? null)
  const thumbs = useDevelop((s) => s.maskThumbs)
  const layerId = useDevelop((s) => s.layerId)
  const setLayer = useDevelop((s) => s.setLayer)
  const setHover = useDevelop((s) => s.setHoverLayer)
  const tool = useDevelop((s) => s.tool)
  const pins = useUi((s) => s.maskOverlay.pins)
  const masksUp = useUi((s) => s.masksWin.open)
  const [where, setWhere] = useState<Record<string, { x: number; y: number } | null>>({})
  const urls = layers?.map((l) => thumbs[l.id]?.url ?? '').join('|') ?? ''
  useEffect(() => {
    if (!layers) return
    let live = true
    void Promise.all(
      layers.map(async (l) => {
        const u = thumbs[l.id]?.url
        return [l.id, u ? await centroidOf(u).catch(() => null) : null] as const
      })
    ).then((pairs) => live && setWhere(Object.fromEntries(pairs)))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urls])
  if (!layers || !masksUp || tool === 'heal' || pins === 'never' || wholeFrameTool(tool))
    return null
  return (
    <div
      className={`mask-pins ${pins}`}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    >
      {layers.map((l) => {
        const shape = g ? geometricCentre(l.components) : null
        const p = shape ? baseToDisplay(g!, shape) : where[l.id]
        if (!p || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return null
        return (
          <LiquidGlass
            as="button"
            key={l.id}
            className={`mask-pin${l.id === layerId ? ' on' : ''}${l.enabled ? '' : ' off'}`}
            radius={9}
            bezel={5}
            strength={1.2}
            frost={0.5}
            magnify
            style={{ left: p.x * rect.w, top: p.y * rect.h }}
            title={l.name}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerEnter={() => setHover(l.id)}
            onPointerLeave={() => setHover(null)}
            onClick={(e) => {
              e.stopPropagation()
              setLayer(l.id)
            }}
          >
            <i />
          </LiquidGlass>
        )
      })}
    </div>
  )
}
