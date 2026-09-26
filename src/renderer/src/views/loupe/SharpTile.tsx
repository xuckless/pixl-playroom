import { memo, useEffect, useRef, useState } from 'react'
import type { RegionResult } from '../../../../shared/ipc'
import type { Recipe } from '../../../../shared/recipe'
import {
  displayToOriented,
  orientedToDisplay,
  visiblePart,
  type Rect,
  type ViewGeometry
} from '../../../../shared/view'
import { api } from '../../lib/api'
import { isInteracting } from '../../lib/interacting'
import { useDevelop } from '../../state/develop'

/** How long the view and the recipe must rest before a tile is asked for. */
const SETTLE_MS = 180
/** The tile reaches this far past each edge of the view, so a short pan needs no new one. */
const MARGIN = 0.15

interface Tile extends RegionResult {
  recipe: Recipe
}

/**
 * Past the preview's own resolution, the part of the photo in view rendered
 * by the engine from the full-resolution source, laid over the picture: the
 * zoomed loupe stays sharp. It follows the recipe once an edit rests, and
 * hides while one runs (the preview under it is the live picture). A
 * straightened frame has no tile; the engine renders regions of the
 * unrotated frame only.
 */
export const SharpTile = memo(function SharpTile({
  rect,
  box,
  g,
  scale,
  previewWidth
}: {
  rect: Rect
  box: { w: number; h: number }
  g: ViewGeometry
  /** Device pixels per photo pixel. */
  scale: number
  /** The preview's width in its own pixels. */
  previewWidth: number
}): React.JSX.Element | null {
  const session = useDevelop((s) => s.session)
  const recipe = useDevelop((s) => s.recipe)
  const [tile, setTile] = useState<Tile | null>(null)
  const request = useRef(0)
  const shownWidth = g.crop && !g.whole ? g.crop.width * g.width : g.width
  // The preview is enough while it has a pixel for every device pixel.
  const wanted = g.straighten === 0 && scale > (previewWidth / shownWidth) * 1.1

  useEffect(() => {
    if (!wanted || !session || !recipe) return
    const id = ++request.current
    const ask = (): void => {
      if (id !== request.current) return
      // An edit is running: the next rest asks again.
      if (isInteracting()) return void (timer = setTimeout(ask, SETTLE_MS))
      const vis = visiblePart(box, rect)
      if (vis.w <= 0 || vis.h <= 0) return
      const mx = (vis.w / rect.w) * MARGIN
      const my = (vis.h / rect.h) * MARGIN
      const a = displayToOriented(g, {
        x: Math.max(0, vis.x / rect.w - mx),
        y: Math.max(0, vis.y / rect.h - my)
      })
      const b = displayToOriented(g, {
        x: Math.min(1, (vis.x + vis.w) / rect.w + mx),
        y: Math.min(1, (vis.y + vis.h) / rect.h + my)
      })
      const x = Math.floor(Math.min(a.x, b.x) * g.width)
      const y = Math.floor(Math.min(a.y, b.y) * g.height)
      void api.develop
        .region({
          key: session.key,
          x,
          y,
          width: Math.ceil(Math.abs(b.x - a.x) * g.width),
          height: Math.ceil(Math.abs(b.y - a.y) * g.height),
          zoom: Math.min(1, scale),
          maskLayer: null
        })
        .then((r) => {
          if (id === request.current) setTile({ ...r, recipe })
        })
        .catch(() => undefined)
    }
    let timer = setTimeout(ask, SETTLE_MS)
    return () => clearTimeout(timer)
    // The rect follows the box and the view; the geometry follows the recipe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, session, recipe, rect.x, rect.y, rect.w, rect.h, box.w, box.h, scale])

  if (!wanted || !tile || tile.recipe !== recipe) return null
  const a = orientedToDisplay(g, { x: tile.x / g.width, y: tile.y / g.height })
  const b = orientedToDisplay(g, {
    x: (tile.x + tile.width) / g.width,
    y: (tile.y + tile.height) / g.height
  })
  return (
    <img
      className="sharp-tile"
      src={tile.url}
      draggable={false}
      alt=""
      style={{
        left: a.x * rect.w,
        top: a.y * rect.h,
        width: (b.x - a.x) * rect.w,
        height: (b.y - a.y) * rect.h,
        // Past 200%, each photo pixel shows as a crisp square.
        imageRendering: scale >= 2 ? 'pixelated' : 'auto'
      }}
    />
  )
})
