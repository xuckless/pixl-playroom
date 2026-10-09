import { lazy, Suspense } from 'react'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { CssAmbient } from './CssFallbacks'
import { disableWebgl, useFxMode } from './mode'
import { Aperture } from './Aperture'

const AmbientGl = lazy(() => import('./AmbientGradient'))

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
 * The inline loader for 16–34 px: the aperture (fx/apertureElement.ts), spinning
 * while the share is unknown, its ring filling when it is known.
 */
export function Spinner({
  size,
  progress = null
}: {
  size: number
  progress?: number | null
}): React.JSX.Element {
  return <Aperture size={size} progress={progress} />
}
