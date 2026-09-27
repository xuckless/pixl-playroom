import { memo, useEffect, useState } from 'react'
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
 * memory (a Before or Split toggle) swaps on the spot.
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
        <img
          key={prev}
          src={prev}
          draggable={false}
          className={`${className ?? ''} decoded-prev`}
          style={style}
          onAnimationEnd={() => setPrev(null)}
          alt=""
        />
      )}
      <img
        key={shown}
        src={shown}
        draggable={false}
        className={`${className ?? ''} decoded-now`}
        style={style}
        alt=""
      />
    </>
  )
})
