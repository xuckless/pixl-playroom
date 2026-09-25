import { lazy, Suspense } from 'react'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { CssAmbient, CssSphere } from './CssFallbacks'
import { disableWebgl, useFxMode } from './mode'

const SphereGl = lazy(() => import('./ProcessingSphere'))
const AmbientGl = lazy(() => import('./AmbientGradient'))

/** The processing sphere: WebGL where it can run, else the SVG stand-in. */
export function Sphere({ active = true }: { active?: boolean }): React.JSX.Element {
  const mode = useFxMode()
  if (mode !== 'webgl') return <CssSphere still={mode === 'static'} />
  const fallback = <CssSphere />
  return (
    <ErrorBoundary fallback={fallback} onError={disableWebgl}>
      <Suspense fallback={fallback}>
        <SphereGl active={active} />
      </Suspense>
    </ErrorBoundary>
  )
}

/** The ambient shader gradient behind empty canvases and dialogs. */
export function Ambient({ intensity = 1 }: { intensity?: number }): React.JSX.Element {
  const mode = useFxMode()
  return (
    <div className="ambient" aria-hidden>
      {mode === 'webgl' ? (
        <ErrorBoundary fallback={<CssAmbient intensity={intensity} />} onError={disableWebgl}>
          <Suspense fallback={<CssAmbient intensity={intensity} />}>
            <AmbientGl intensity={intensity} />
          </Suspense>
        </ErrorBoundary>
      ) : (
        <CssAmbient still={mode === 'static'} intensity={intensity} />
      )}
      <div className="vignette" />
    </div>
  )
}

/** A thin ring around the sphere: how far along, or a turning arc when that cannot be known. */
export function ProgressRing({ progress }: { progress: number | null }): React.JSX.Element {
  const r = 112
  const c = 2 * Math.PI * r
  const known = progress !== null
  return (
    <svg className={`proc-ring${known ? '' : ' spinning'}`} viewBox="0 0 240 240" aria-hidden>
      <circle className="bg" cx="120" cy="120" r={r} />
      <circle
        className="fg"
        cx="120"
        cy="120"
        r={r}
        strokeDasharray={known ? c : `${c * 0.18} ${c}`}
        strokeDashoffset={known ? c * (1 - Math.max(0, Math.min(1, progress))) : 0}
      />
    </svg>
  )
}
