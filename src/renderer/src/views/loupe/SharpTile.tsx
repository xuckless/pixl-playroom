import { memo, useEffect, useRef, useState } from 'react'
import type { RegionResult } from '../../../../shared/ipc'
import type { Recipe } from '../../../../shared/recipe'
import { visiblePart, type Rect, type ViewGeometry } from '../../../../shared/view'
import { api } from '../../lib/api'
import { isFrame, whenFrame } from '../../lib/frames'
import { Picture } from './DecodedImage'
import { isInteracting } from '../../lib/interacting'
import { useDevelop } from '../../state/develop'
import { useUi } from '../../state/ui'
import { renderDisplay, useDisplay } from '../../state/display'

/** How long the view and the recipe must rest before a tile is asked for. */
const SETTLE_MS = 180
/** The tile reaches this far past each edge of the view, so a short pan needs no new one. */
const MARGIN = 0.15

interface Tile extends RegionResult {
  recipe: Recipe
  /** Made for the crop tool's whole frame (its fractions are of that picture). */
  whole: boolean
  /** The display it was made for (Full HDR), as `hdrKey`. */
  hdr: string
}

/**
 * Past the preview's own resolution, the part of the photo in view rendered
 * by the engine from the full-resolution source, laid over the picture: the
 * zoomed loupe stays sharp. It follows the recipe once an edit rests, and
 * hides while one runs (the preview under it is the live picture). Asked
 * for and placed as fractions of the picture as shown: since engine 0.16 a
 * region of a straightened, warped, lens-corrected or cropped photo is the
 * full render's own pixels there. Only the crop tool's view of an Upright
 * (its empty wedges transparent, which a JPEG tile cannot show) has none.
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
  /** The tile a better one replaces, kept under it while it fades in. */
  const [under, setUnder] = useState<Tile | null>(null)
  /** Bumped when main says the tile's source got better: the same view is asked for again. */
  const [better, setBetter] = useState(0)
  useEffect(
    () =>
      api.develop.onTileStale((e) => {
        if (e.key !== useDevelop.getState().session?.key) return
        asked.current = null
        setBetter((n) => n + 1)
      }),
    []
  )
  // Full HDR on or off, or another display: the tile is made again for it.
  const hdr = JSON.stringify(
    renderDisplay(
      useUi((s) => s.fullHdr),
      useDisplay((s) => s.display)
    )
  )
  const request = useRef(0)
  /** The ask in flight or shown, by what it is of: the same again is not asked (it would cancel it). */
  const asked = useRef<string | null>(null)
  const shownWidth = g.crop && !g.whole ? g.crop.width * g.width : g.width
  // The preview is enough while it has a pixel for every device pixel.
  const wanted = scale > (previewWidth / shownWidth) * 1.1 && !(g.whole && g.transform)

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
      const x0 = Math.max(0, vis.x / rect.w - mx)
      const y0 = Math.max(0, vis.y / rect.h - my)
      const x1 = Math.min(1, (vis.x + vis.w) / rect.w + mx)
      const y1 = Math.min(1, (vis.y + vis.h) / rect.h + my)
      // 1:1 is 1 (the view's arithmetic can land a hair under it).
      const zoom = scale >= 0.9999 ? 1 : Math.min(1, scale)
      const part = { key: session.key, x: x0, y: y0, width: x1 - x0, height: y1 - y0, zoom }
      // Asked already, for the same pixels (a re-render that changed nothing
      // the tile shows): asking again would cancel the one on its way.
      const what = JSON.stringify([part, g.whole === true, hdr, recipe])
      if (what === asked.current) return
      asked.current = what
      void api.develop
        .region(part)
        .then(async (r) => {
          // A Full HDR tile is a frame: here once its pixels are (their own port).
          if (isFrame(r.url) && !(await whenFrame(r.url))) throw new Error('frame gone')
          if (id !== request.current) return
          setTile((was) => {
            const next = { ...r, recipe, whole: g.whole === true, hdr }
            // The same view made better: the old one stays under it while it fades in.
            setUnder(was && was.recipe === recipe && was.hdr === hdr ? was : null)
            return next
          })
        })
        .catch(() => {
          // Cancelled or failed: the next rest may ask again.
          if (asked.current === what) asked.current = null
        })
    }
    let timer = setTimeout(ask, SETTLE_MS)
    return () => clearTimeout(timer)
    // The rect follows the box and the view; the geometry follows the recipe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    wanted,
    session,
    recipe,
    rect.x,
    rect.y,
    rect.w,
    rect.h,
    box.w,
    box.h,
    scale,
    g.whole,
    hdr,
    better
  ])

  if (
    !wanted ||
    !tile ||
    tile.recipe !== recipe ||
    tile.whole !== (g.whole === true) ||
    tile.hdr !== hdr
  )
    return null
  const place = (t: Tile): React.CSSProperties => ({
    left: t.x * rect.w,
    top: t.y * rect.h,
    width: t.width * rect.w,
    height: t.height * rect.h,
    // Past 200%, each photo pixel shows as a crisp square.
    imageRendering: scale >= 2 ? 'pixelated' : 'auto'
  })
  return (
    <>
      {under && under.url !== tile.url && (
        <Picture key={under.url} src={under.url} className="sharp-tile" style={place(under)} />
      )}
      <Picture
        key={tile.url}
        src={tile.url}
        className={`sharp-tile${under ? ' fresh' : ''}`}
        style={place(tile)}
        onAnimationEnd={() => setUnder(null)}
      />
    </>
  )
})
