/**
 * A Depth range's map in its card: the photo's depth in grey (near light,
 * far dark), what the range takes tinted, redrawn as Near, Far and Softness
 * move. The mask itself shows on the photo from the render.
 */
import { useEffect, useRef, useState } from 'react'
import { DEPTH_SOFTNESS_MAX } from '../../../../shared/compile'
import type { DepthComponent } from '../../../../shared/recipe'
import { coverage, depthMap, depthOf, type DepthMap } from '../../lib/depth'
import { t } from '../../lib/i18n'

/** The tint of what the range takes (the masks' own red). */
const TINT = [255, 64, 96]

export function DepthPreview({ c }: { c: DepthComponent }): React.JSX.Element | null {
  const [map, setMap] = useState<DepthMap | null>(null)
  const [failed, setFailed] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let live = true
    depthMap(c).then(
      (m) => live && setMap(m),
      () => live && setFailed(true)
    )
    return () => {
      live = false
    }
    // The plane, not the band: a new map only when the component's plane changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.ref, c.png])
  useEffect(() => {
    const el = canvas.current
    if (!el || !map) return
    el.width = map.width
    el.height = map.height
    const ctx = el.getContext('2d')
    if (!ctx) return
    const img = ctx.createImageData(map.width, map.height)
    const soft = c.softness * DEPTH_SOFTNESS_MAX
    // One coverage per grey level: the map has 256 at most.
    const cover = new Float32Array(256)
    for (let g = 0; g < 256; g++) cover[g] = coverage(depthOf(g), c.near, c.far, soft)
    for (let i = 0; i < map.data.length; i++) {
      const g = map.data[i]
      const k = c.invert ? 1 - cover[g] : cover[g]
      const grey = 40 + g * 0.6
      img.data[i * 4] = grey + (TINT[0] - grey) * k * 0.75
      img.data[i * 4 + 1] = grey + (TINT[1] - grey) * k * 0.75
      img.data[i * 4 + 2] = grey + (TINT[2] - grey) * k * 0.75
      img.data[i * 4 + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
  }, [map, c.near, c.far, c.softness, c.invert])
  if (failed) return <p className="muted small">{t('The depth map could not be read.')}</p>
  return (
    <canvas
      ref={canvas}
      className="depth-preview"
      aria-label={t("The photo's depth, the range tinted")}
    />
  )
}
