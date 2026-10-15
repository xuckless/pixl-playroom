import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { frameBitmap, frameFloat, isFrame } from '../../lib/frames'
import { drawFloat, releaseFloat, type FloatFrame } from '../../lib/floatcanvas'
import { isInteracting } from '../../lib/interacting'
import { fadeDone, slotKey, swapPicture, type PictureSlots } from '../../lib/pictureslots'

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
 *
 * Two slots hold the pictures (lib/pictureslots.ts): a swap at once draws
 * the next into the same element (a drag's frames go to one canvas, its GPU
 * set-up kept), and a fade hands the shown one's element to the fading
 * picture as it is, with the next in the other.
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
  const [slots, setSlots] = useState<PictureSlots>({ shown: src, prev: null, slot: 0 })
  const { shown, prev, slot } = slots
  useEffect(() => {
    if (src === shown) return
    let live = true
    // Mid-drag the next picture is already on its way: swap, don't fade.
    const swap = (): void => {
      if (live) setSlots((s) => swapPicture(s, src, !isInteracting()))
    }
    if (isFrame(src)) {
      // Already drawn pixels: swapped on the next tick, nothing to load.
      void Promise.resolve().then(swap)
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
    void ready.then(swap)
    return () => {
      live = false
    }
  }, [src, shown])
  return (
    <>
      {prev && prev !== shown && (
        <Picture
          key={slotKey(slot === 0 ? 1 : 0)}
          src={prev}
          className={`${className ?? ''} decoded-prev`}
          style={style}
          onAnimationEnd={() => setSlots(fadeDone)}
        />
      )}
      <Picture
        key={slotKey(slot)}
        src={shown}
        className={`${className ?? ''} decoded-now`}
        style={style}
      />
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
  const float = frameFloat(src)
  // Drawn before the frame is painted, so the canvas never shows blank.
  useLayoutEffect(() => {
    const c = ref.current
    const bmp = frameBitmap(src)
    if (!c || !bmp || float) return
    drawBitmap(c, bmp)
  }, [src, float])
  if (float)
    return (
      <FloatFrameCanvas
        src={src}
        frame={float}
        className={className}
        style={style}
        onAnimationEnd={onAnimationEnd}
      />
    )
  return (
    <canvas
      ref={ref}
      className={`frame ${className}`}
      style={style}
      onAnimationEnd={onAnimationEnd}
    />
  )
}

/**
 * A Full HDR frame on a WebGPU canvas (lib/floatcanvas.ts). Where WebGPU
 * will not draw it, its SDR companion is drawn instead, on a 2D canvas.
 */
function FloatFrameCanvas({
  src,
  frame,
  className,
  style,
  onAnimationEnd
}: {
  src: string
  frame: FloatFrame
  className: string
  style?: React.CSSProperties
  onAnimationEnd?: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  const [fallback, setFallback] = useState(false)
  useLayoutEffect(() => {
    const c = ref.current
    if (!c) return
    if (fallback) {
      const bmp = frameBitmap(src)
      if (bmp) drawBitmap(c, bmp)
      return
    }
    // Sized at once, so the layout never sees a blank 300 × 150 canvas.
    sizeCanvas(c, frame.width, frame.height)
    void drawFloat(c, frame).then((ok) => !ok && setFallback(true))
  }, [src, frame, fallback])
  // The canvas's texture goes with it.
  useEffect(() => {
    const c = ref.current
    return () => {
      if (c) releaseFloat(c)
    }
  }, [fallback])
  return (
    <canvas
      key={fallback ? 'sdr' : 'hdr'}
      ref={ref}
      className={`frame ${className}`}
      style={style}
      onAnimationEnd={onAnimationEnd}
    />
  )
}

/** A canvas at `w` × `h`; left as it is when it already is (a new size clears and reallocates it). */
function sizeCanvas(c: HTMLCanvasElement, w: number, h: number): void {
  if (c.width !== w) c.width = w
  if (c.height !== h) c.height = h
}

/** A frame's bitmap on a 2D canvas, over whatever the canvas showed before. */
function drawBitmap(c: HTMLCanvasElement, bmp: ImageBitmap): void {
  const same = c.width === bmp.width && c.height === bmp.height
  sizeCanvas(c, bmp.width, bmp.height)
  const ctx = c.getContext('2d', { colorSpace: 'display-p3' })
  if (!ctx) return
  // A frame can have empty corners (the crop tool's warp): nothing of the last shows through.
  if (same) ctx.clearRect(0, 0, c.width, c.height)
  ctx.drawImage(bmp, 0, 0)
}
