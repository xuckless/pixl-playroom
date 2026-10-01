import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { frameBitmap, isFrame } from '../../lib/frames'
import { isInteracting } from '../../lib/interacting'

/**
 * The longest a loaded picture waits on `decode()`. Chromium settles a
 * decode on the next frame it draws, and an idle window may not draw one for
 * seconds: Before, clicked after Split, kept the edited picture up that long.
 */
const DECODE_WAIT_MS = 120

/**
 * An image that swaps to a new `src` only once the new picture has loaded
 * (and, briefly, decoded), so a render arriving never blanks, half-paints or
 * stalls the loupe: the previous picture stays until the next is ready, then
 * fades across (or, during a live edit, swaps at once). A picture already in
 * memory (a Before or Split toggle) swaps on the spot, and so does a preview
 * frame (`frame:` ids, lib/frames.ts): its pixels are here before its event.
 */
export const DecodedImage = memo(function DecodedImage({
  src,
  className,
  style
}: {
  src: string
  className?: string
  style?: React.CSSProperties
}): React.JSX.Element {
  const [shown, setShown] = useState(src)
  const [prev, setPrev] = useState<string | null>(null)
  useEffect(() => {
    if (src === shown) return
    let live = true
    if (isFrame(src)) {
      // Already drawn pixels: swapped on the next tick, nothing to load.
      void Promise.resolve().then(() => {
        if (!live) return
        setPrev(isInteracting() ? null : shown)
        setShown(src)
      })
      return () => {
        live = false
      }
    }
    const img = new Image()
    const loaded = new Promise<void>((done) => {
      img.onload = img.onerror = () => done()
    })
    img.src = src
    const ready =
      img.complete && img.naturalWidth > 0
        ? Promise.resolve()
        : loaded.then(() =>
            Promise.race([
              img.decode().catch(() => undefined),
              new Promise((done) => setTimeout(done, DECODE_WAIT_MS))
            ])
          )
    void ready.then(() => {
      if (!live) return
      // Mid-drag the next picture is already on its way: swap, don't fade.
      setPrev(isInteracting() ? null : shown)
      setShown(src)
    })
    return () => {
      live = false
    }
  }, [src, shown])
  return (
    <>
      {prev && prev !== shown && (
        <Picture
          key={prev}
          src={prev}
          className={`${className ?? ''} decoded-prev`}
          style={style}
          onAnimationEnd={() => setPrev(null)}
        />
      )}
      <Picture key={shown} src={shown} className={`${className ?? ''} decoded-now`} style={style} />
    </>
  )
})

/** A file as an image, a frame drawn on a canvas sized to it (the CSS fits either the same). */
export function Picture({
  src,
  className,
  style,
  onAnimationEnd
}: {
  src: string
  className: string
  style?: React.CSSProperties
  onAnimationEnd?: () => void
}): React.JSX.Element {
  if (isFrame(src))
    return (
      <FrameCanvas src={src} className={className} style={style} onAnimationEnd={onAnimationEnd} />
    )
  return (
    <img
      src={src}
      draggable={false}
      className={className}
      style={style}
      onAnimationEnd={onAnimationEnd}
      alt=""
    />
  )
}

function FrameCanvas({
  src,
  className,
  style,
  onAnimationEnd
}: {
  src: string
  className: string
  style?: React.CSSProperties
  onAnimationEnd?: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  // Drawn before the frame is painted, so the canvas never shows blank.
  useLayoutEffect(() => {
    const c = ref.current
    const bmp = frameBitmap(src)
    if (!c || !bmp) return
    c.width = bmp.width
    c.height = bmp.height
    c.getContext('2d', { colorSpace: 'display-p3' })?.drawImage(bmp, 0, 0)
  }, [src])
  return (
    <canvas
      ref={ref}
      className={`frame ${className}`}
      style={style}
      onAnimationEnd={onAnimationEnd}
    />
  )
}
