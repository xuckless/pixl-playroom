import { memo, useEffect, useState } from 'react'

/**
 * An image that swaps to a new `src` only once the new picture is decoded,
 * so a render arriving never blanks, half-paints or stalls the loupe: the
 * previous picture stays until the next is ready, then fades across.
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
    img.src = src
    img
      .decode()
      .catch(() => undefined)
      .then(() => {
        if (!live) return
        setPrev(shown)
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
