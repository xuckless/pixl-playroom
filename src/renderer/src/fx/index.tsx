import { lazy, Suspense, useId, type CSSProperties } from 'react'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { CssAmbient, CssSphere } from './CssFallbacks'
import { disableWebgl, useFxMode } from './mode'

const SphereGl = lazy(() => import('./ProcessingSphere'))
const AmbientGl = lazy(() => import('./AmbientGradient'))

/**
 * The sphere's radius as a share of its box: the WebGL sphere (radius 1, seen
 * from 3.1 at a 40° field) fills more of it than the SVG disc (78 of 220).
 */
const SPHERE_RADIUS = {
  webgl: Math.tan(Math.asin(1 / 3.1)) / Math.tan((20 * Math.PI) / 180) / 2,
  css: 78 / 220
}

/**
 * The brand's highlight pixel: a white square on the sphere's lit side, a
 * quarter of its radius across (the mark's own proportions). It stays put
 * while the sphere turns under it, like a specular.
 */
function SpherePixel({ radius }: { radius: number }): React.JSX.Element {
  return <i className="sphere-pixel" style={{ '--sr': radius } as CSSProperties} aria-hidden />
}

/** The processing sphere: WebGL where it can run, else the SVG stand-in. */
export function Sphere({ active = true }: { active?: boolean }): React.JSX.Element {
  const mode = useFxMode()
  if (mode !== 'webgl') {
    return (
      <>
        <CssSphere still={mode === 'static'} />
        <SpherePixel radius={SPHERE_RADIUS.css} />
      </>
    )
  }
  const fallback = (
    <>
      <CssSphere />
      <SpherePixel radius={SPHERE_RADIUS.css} />
    </>
  )
  return (
    <ErrorBoundary fallback={fallback} onError={disableWebgl}>
      <Suspense fallback={fallback}>
        <SphereGl active={active} />
        <SpherePixel radius={SPHERE_RADIUS.webgl} />
      </Suspense>
    </ErrorBoundary>
  )
}

/** The ambient shader gradient behind empty canvases and dialogs. */
export function Ambient({
  intensity = 1,
  still = false
}: {
  intensity?: number
  /** One frame and no clock (behind a dialog). */
  still?: boolean
}): React.JSX.Element {
  const mode = useFxMode()
  return (
    <div className="ambient" aria-hidden>
      {mode === 'webgl' ? (
        <ErrorBoundary fallback={<CssAmbient intensity={intensity} />} onError={disableWebgl}>
          <Suspense fallback={<CssAmbient intensity={intensity} />}>
            <AmbientGl intensity={intensity} still={still} />
          </Suspense>
        </ErrorBoundary>
      ) : (
        <CssAmbient still={still || mode === 'static'} intensity={intensity} />
      )}
      <div className="vignette" />
    </div>
  )
}

/**
 * A thin ring around the sphere: how far along, or a turning arc when that
 * cannot be known. Lilac fading to purple, and when the share is known a
 * pixel rides the head of the arc.
 */
export function ProgressRing({ progress }: { progress: number | null }): React.JSX.Element {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const r = 112
  const c = 2 * Math.PI * r
  const known = progress !== null
  const p = known ? Math.max(0, Math.min(1, progress)) : 0
  const a = ((-90 + 360 * p) * Math.PI) / 180
  return (
    <svg className={`proc-ring${known ? '' : ' spinning'}`} viewBox="0 0 240 240" aria-hidden>
      <defs>
        <linearGradient id={`ring-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e6dfff" />
          <stop offset="1" stopColor="#7b68d8" />
        </linearGradient>
      </defs>
      <circle className="bg" cx="120" cy="120" r={r} />
      <circle
        className="fg"
        cx="120"
        cy="120"
        r={r}
        style={{ stroke: `url(#ring-${id})` }}
        strokeDasharray={known ? c : `${c * 0.18} ${c}`}
        strokeDashoffset={known ? c * (1 - p) : 0}
      />
      {known && p > 0 && p < 1 && (
        <rect
          className="head"
          x={120 + r * Math.cos(a) - 5.5}
          y={120 + r * Math.sin(a) - 5.5}
          width="11"
          height="11"
        />
      )}
    </svg>
  )
}

/**
 * The inline loader for 16–34 px: a small lit sphere inside a gradient ring,
 * turning (1.4 s) while the share is unknown, filling when it is known. No
 * noise at this size.
 */
export function Spinner({
  size,
  progress = null
}: {
  size: number
  progress?: number | null
}): React.JSX.Element {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const r = 104
  const c = 2 * Math.PI * r
  const known = progress !== null
  return (
    <svg className="spinner" viewBox="0 0 240 240" width={size} height={size} aria-hidden>
      <defs>
        <radialGradient id={`sp-${id}`} cx="36%" cy="30%" r="75%">
          <stop offset="0" stopColor="#f1ecff" />
          <stop offset="0.22" stopColor="#bba9ff" />
          <stop offset="0.55" stopColor="#7b68d8" />
          <stop offset="0.85" stopColor="#2b1f66" />
          <stop offset="1" stopColor="#0d0a1f" />
        </radialGradient>
        <linearGradient id={`rg-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e6dfff" />
          <stop offset="1" stopColor="#7b68d8" />
        </linearGradient>
      </defs>
      <circle cx="120" cy="120" r="70" fill={`url(#sp-${id})`} />
      {known ? (
        <>
          <circle className="track" cx="120" cy="120" r={r} />
          <circle
            className="arc"
            cx="120"
            cy="120"
            r={r}
            stroke={`url(#rg-${id})`}
            strokeDasharray={c}
            strokeDashoffset={c * (1 - Math.max(0, Math.min(1, progress)))}
            transform="rotate(-90 120 120)"
          />
        </>
      ) : (
        <g className="turning">
          <circle
            className="arc"
            cx="120"
            cy="120"
            r={r}
            stroke={`url(#rg-${id})`}
            strokeDasharray={`${c * 0.66} ${c}`}
          />
        </g>
      )}
    </svg>
  )
}
