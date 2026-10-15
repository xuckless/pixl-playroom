import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { FocusPicture, FocusTile, LibraryItem } from '../../../../shared/ipc'
import {
  FIT,
  visiblePart,
  zoomedRect,
  type P,
  type Rect,
  type Viewport
} from '../../../../shared/view'
import { Stars } from '../../components/ui'
import { api } from '../../lib/api'
import { LABEL_COLOURS } from '../../lib/helpers'
import { t } from '../../lib/i18n'
import { useDevelop } from '../../state/develop'
import { useHiddenByFilter, useLibrary } from '../../state/library'
import { DecodedImage } from '../loupe/DecodedImage'
import { useSize } from '../loupe/useSize'
import { libZoom, registerPane, useLibZoom, type PaneId } from './libzoom'
import { focusOf, previewable, usePreview } from './usePreview'

/** How long a zoomed view must rest before its 1:1 part is asked for. */
const SETTLE_MS = 180
/** A 1:1 part reaches this far past each edge of the view, so a short pan needs no new one. */
const MARGIN = 0.15
/** A press that moves less than this (CSS pixels) is a click, not a drag. */
const CLICK_SLOP = 4

/**
 * One photo in the Library's Loupe, Compare or Survey: its thumbnail at
 * once, its screen preview faded in over it, and (in a zoomable pane, Z or a
 * click) its 1:1, a picture of it whole or the part in view rendered once.
 * Its name, rating, flag and label at its foot, and what is worth knowing
 * on chips: shown in SDR, original offline, preview unavailable.
 */
export const PhotoPane = memo(function PhotoPane({
  item,
  pane,
  tag,
  active,
  onPress,
  onOpen,
  compact,
  where
}: {
  item: LibraryItem
  /** The zoomable pane this is; none for a Survey tile. */
  pane: PaneId | null
  /** Compare's 'Select' or 'Candidate'. */
  tag?: string
  /** The pane or tile the keys act on (outlined in the accent). */
  active?: boolean
  /** A press on it (Compare picks the pane, Survey the tile). */
  onPress?: () => void
  /** A double-click on a Survey tile. */
  onOpen?: () => void
  /** Survey's tiles: a shorter foot. */
  compact?: boolean
  /** "12 of 412", at the foot. */
  where?: string
}): React.JSX.Element {
  const [setEl, box] = useSize()
  const preview = usePreview(item)
  const shown = preview && preview !== 'failed' ? preview : null
  const base = shown?.url ?? item.thumbUrl
  const view = useLibZoom((s) => (pane ? s.views[pane] : FIT))
  const hidden = useHiddenByFilter(item)
  const setMeta = useLibrary((s) => s.setMeta)
  const [full, setFull] = useState<{ key: string; f: FocusPicture } | null>(null)
  const focus = full?.key === item.key ? full.f : null
  /** The last 1:1 size this pane had: the next shot of a burst is the same size. */
  const [lastFull, setLastFull] = useState<{ width: number; height: number } | null>(null)
  const dims = focus ?? lastFull ?? shown
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  const viewport: Viewport | null =
    box.w > 0 && dims ? { box, width: dims.width, height: dims.height, dpr } : null
  const zoomed = pane !== null && view.scale !== 'fit'
  const can = previewable(item)

  // What the zoom keys read: kept current without registering again.
  const now = useRef({ viewport, item, box, dpr })
  useEffect(() => {
    now.current = { viewport, item, box, dpr }
  })
  const pointer = useRef<P | null>(null)
  const loadFull = useCallback(async (): Promise<Viewport | null> => {
    const { item: it, box: b, dpr: d } = now.current
    if (!previewable(it)) return null
    const f = await focusOf(it)
    setFull({ key: it.key, f })
    setLastFull({ width: f.width, height: f.height })
    return b.w > 0 ? { box: b, width: f.width, height: f.height, dpr: d } : null
  }, [])
  useEffect(() => {
    if (!pane) return
    return registerPane(pane, {
      viewport: () => now.current.viewport,
      pointer: () => pointer.current,
      full: () => loadFull().catch(() => null)
    })
  }, [pane, loadFull])
  // Stepped to the next photo while zoomed: its 1:1 at once.
  useEffect(() => {
    if (zoomed && can && !focus) void loadFull().catch(() => undefined)
  }, [zoomed, can, focus, loadFull, item.key])

  const rect = zoomed && viewport ? zoomedRect(viewport, view) : null
  const place = (r: Rect): React.CSSProperties => ({
    left: r.x,
    top: r.y,
    width: r.w,
    height: r.h
  })

  // A press: a click toggles 1:1 at the pointer (picking the pane first); a drag pans.
  const press = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const at = (e: React.PointerEvent): P => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return
      press.current = { x: e.clientX, y: e.clientY, moved: false }
      ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    },
    onPointerMove: (e: React.PointerEvent) => {
      pointer.current = at(e)
      const p = press.current
      if (!p || !pane) return
      const dx = e.clientX - p.x
      const dy = e.clientY - p.y
      if (!p.moved && Math.hypot(dx, dy) < CLICK_SLOP) return
      p.moved = true
      if (zoomed) libZoom.pan(pane, dx, dy)
      p.x = e.clientX
      p.y = e.clientY
    },
    onPointerUp: () => {
      const p = press.current
      press.current = null
      if (!p || p.moved) return
      const picked = active !== false
      onPress?.()
      // Compare: the first click picks the pane, the next zooms it.
      if (pane && can && picked) void libZoom.toggle(pane)
    },
    onPointerLeave: () => {
      if (!press.current) pointer.current = null
    },
    onWheel: (e: React.WheelEvent) => {
      if (!pane || !zoomed) return
      libZoom.pan(pane, -e.deltaX, -e.deltaY)
    },
    onDoubleClick: onOpen
  }

  const cls = [
    'lib-pane',
    pane ? 'zoomable' : 'tile',
    zoomed && 'zoomed',
    active && 'active',
    item.flag === 'reject' && 'rejected',
    hidden && 'filtered-out'
  ]
    .filter(Boolean)
    .join(' ')
  const percent = pane && zoomed ? libZoom.percent(pane) : null
  return (
    <div className={cls}>
      <div ref={setEl} className="lib-canvas" {...handlers}>
        {!base ? (
          <div className="lib-wait">
            {item.unreadable ? t('Can’t read') : item.ext.toUpperCase()}
          </div>
        ) : rect ? (
          <>
            <img className="lib-pic-zoom" src={base} style={place(rect)} draggable={false} alt="" />
            {focus?.kind === 'whole' && (
              <img
                className="lib-pic-zoom full"
                src={focus.url}
                style={place(rect)}
                draggable={false}
                alt=""
              />
            )}
            {focus?.kind === 'region' && viewport && (
              <RegionTile itemKey={item.key} rect={rect} box={box} />
            )}
          </>
        ) : (
          <DecodedImage src={base} className="lib-pic" />
        )}
      </div>
      {tag && <span className={`lib-tag${active ? ' on' : ''}`}>{tag}</span>}
      <span className="lib-chips">
        {percent !== null && <span className="badge ghost t-num">{percent}%</span>}
        {item.offline && (
          <span className="badge ghost" title={t('Not found at {{path}}', { path: item.path })}>
            {t('Original offline')}
          </span>
        )}
        {preview === 'failed' && (
          <span className="badge ghost" title={t('The thumbnail is shown instead')}>
            {t('Preview unavailable')}
          </span>
        )}
        {shown?.sdr && (
          <button
            type="button"
            className="badge ghost sdr-chip"
            title={t('Shown in SDR here: open it in Develop to see it in HDR')}
            onClick={() => {
              const l = useLibrary.getState()
              l.setFocus(item.key)
              l.setView('develop')
              void useDevelop.getState().open(item.key)
            }}
          >
            {t('SDR preview')}
          </button>
        )}
        {hidden && <span className="badge ghost">{t('Hidden by filter')}</span>}
      </span>
      <div className={`lib-foot${compact ? ' compact' : ''}`}>
        <span className="lib-name" title={item.path}>
          {item.name}
        </span>
        {where && !compact && <span className="muted t-num">{where}</span>}
        <span className="spacer" />
        {item.label && (
          <span
            className="label-dot"
            style={{ background: LABEL_COLOURS[item.label], color: LABEL_COLOURS[item.label] }}
          />
        )}
        {item.flag === 'pick' && <span className="flag pick">{t('PICK')}</span>}
        {item.flag === 'reject' && <span className="flag reject">✕</span>}
        <Stars value={item.rating} onChange={(v) => void setMeta({ rating: v }, [item.key])} />
      </div>
    </div>
  )
})

/**
 * The part of a photo in view at 1:1, rendered once by the engine (no
 * Develop session) when the view rests, over the preview; panned along with
 * it (it is placed as fractions of the picture). "Sharpening…" while one
 * comes.
 */
function RegionTile({
  itemKey,
  rect,
  box
}: {
  itemKey: string
  rect: Rect
  box: { w: number; h: number }
}): React.JSX.Element {
  const [tile, setTile] = useState<{ key: string; t: FocusTile } | null>(null)
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)
  const vis = visiblePart(box, rect)
  const want = {
    x: vis.x / rect.w,
    y: vis.y / rect.h,
    width: vis.w / rect.w,
    height: vis.h / rect.h
  }
  const have = tile?.key === itemKey ? tile.t : null
  const covered =
    !!have &&
    want.x >= have.x - 1e-4 &&
    want.y >= have.y - 1e-4 &&
    want.x + want.width <= have.x + have.width + 1e-4 &&
    want.y + want.height <= have.y + have.height + 1e-4
  const wantKey = covered
    ? null
    : [want.x, want.y, want.width, want.height].map((v) => v.toFixed(3)).join(',')
  useEffect(() => {
    if (!wantKey) return
    const [x, y, w, h] = wantKey.split(',').map(Number)
    const mine = ++seq.current
    const timer = setTimeout(() => {
      setBusy(true)
      const ask = {
        x: Math.max(0, x - w * MARGIN),
        y: Math.max(0, y - h * MARGIN),
        width: Math.min(1, w * (1 + 2 * MARGIN)),
        height: Math.min(1, h * (1 + 2 * MARGIN))
      }
      void api.library
        .focusRegion(itemKey, ask)
        .then((t) => {
          if (mine === seq.current) setTile({ key: itemKey, t })
        })
        .catch(() => undefined)
        .finally(() => {
          if (mine === seq.current) setBusy(false)
        })
    }, SETTLE_MS)
    return () => clearTimeout(timer)
  }, [itemKey, wantKey])
  return (
    <>
      {have && (
        <img
          className="lib-pic-zoom tile"
          src={have.url}
          style={{
            left: rect.x + have.x * rect.w,
            top: rect.y + have.y * rect.h,
            width: have.width * rect.w,
            height: have.height * rect.h
          }}
          draggable={false}
          alt=""
        />
      )}
      {busy && <span className="lib-sharpening badge ghost">{t('Sharpening…')}</span>}
    </>
  )
}
