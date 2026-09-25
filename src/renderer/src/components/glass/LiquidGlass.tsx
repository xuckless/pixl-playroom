import {
  createElement,
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode
} from 'react'
import { glassMaps } from './maps'

/** Sizes are measured in 4px steps, so a surface that grows by a pixel reuses its maps. */
const BUCKET = 4

const REDUCED = '(prefers-reduced-transparency: reduce)'
function subscribeReduced(cb: () => void): () => void {
  const mq = window.matchMedia(REDUCED)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}
const reducedNow = (): boolean => window.matchMedia(REDUCED).matches

export interface LiquidGlassProps extends HTMLAttributes<HTMLElement> {
  as?: 'div' | 'button' | 'span' | 'aside' | 'section'
  /** Corner radius of the lens, px. Surfaces stay square; pins are round. */
  radius?: number
  /** Width of the refracting rim, px. */
  bezel?: number
  /** How strongly the rim bends light. */
  strength?: number
  /** Blur behind the glass, px (frost). */
  frost?: number
  /** Magnify the whole face (a loupe crystal), not only the rim. */
  magnify?: boolean
  /** Only frosted blur, no refraction. */
  flat?: boolean
  disabled?: boolean
  type?: 'button' | 'submit'
  children?: ReactNode
}

/**
 * A surface of liquid glass: whatever sits behind it is refracted by a
 * curved rim, blurred a little, lifted in saturation, and lit along the
 * edge that faces the light. It is a real lens over the backdrop (an SVG
 * displacement filter used as the element's backdrop-filter), sized to the
 * element and redrawn when the element changes size. With reduced
 * transparency, or where the filter cannot run, it is frosted glass.
 */
export const LiquidGlass = forwardRef<HTMLElement, LiquidGlassProps>(function LiquidGlass(
  {
    as = 'div',
    radius = 2,
    bezel = 10,
    strength = 1,
    frost = 1.5,
    magnify = false,
    flat = false,
    className,
    style,
    children,
    ...rest
  },
  ref
) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const filterId = `lg-${id}`
  const [el, setEl] = useState<HTMLElement | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const reduced = useSyncExternalStore(subscribeReduced, reducedNow, () => false)

  useEffect(() => {
    if (!el) return
    const ro = new ResizeObserver(() => {
      const w = Math.round(el.offsetWidth / BUCKET) * BUCKET
      const h = Math.round(el.offsetHeight / BUCKET) * BUCKET
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])

  const refract = !flat && !reduced && size.w > 0
  const maps = useMemo(
    () =>
      refract
        ? glassMaps({ width: size.w, height: size.h, radius, bezel, strength, magnify })
        : null,
    [refract, size.w, size.h, radius, bezel, strength, magnify]
  )

  const setRefs = useCallback(
    (node: HTMLElement | null): void => {
      setEl(node)
      if (typeof ref === 'function') ref(node)
      else if (ref) ref.current = node
    },
    [ref]
  )

  const glassStyle: CSSProperties = maps
    ? {
        ...style,
        backdropFilter: `url(#${filterId}) blur(${frost * 0.5}px)`,
        WebkitBackdropFilter: `url(#${filterId}) blur(${frost * 0.5}px)`
      }
    : { ...style }

  return createElement(
    as,
    {
      ...rest,
      ref: setRefs,
      className: `glass liquid${maps ? ' refracting' : ''}${className ? ` ${className}` : ''}`,
      style: glassStyle,
      'data-glass': maps ? 'refract' : 'frost'
    },
    maps && (
      <svg className="lg-defs" width="0" height="0" aria-hidden focusable="false">
        <filter
          id={filterId}
          x="0"
          y="0"
          width={size.w}
          height={size.h}
          filterUnits="userSpaceOnUse"
          primitiveUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur in="SourceGraphic" stdDeviation={frost} result="frost" />
          <feImage
            href={maps.displacement}
            x="0"
            y="0"
            width={size.w}
            height={size.h}
            preserveAspectRatio="none"
            result="lens"
          />
          <feDisplacementMap
            in="frost"
            in2="lens"
            scale={maps.scale}
            xChannelSelector="R"
            yChannelSelector="G"
            result="bent"
          />
          <feColorMatrix in="bent" type="saturate" values="1.45" result="vivid" />
          <feImage
            href={maps.specular}
            x="0"
            y="0"
            width={size.w}
            height={size.h}
            preserveAspectRatio="none"
            result="rim"
          />
          <feComposite in="rim" in2="vivid" operator="over" />
        </filter>
      </svg>
    ),
    children
  )
})
