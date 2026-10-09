import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Aperture } from '../fx/Aperture'
import type { PixlAperture } from '../fx/apertureElement'
import { CssAmbient } from '../fx/CssFallbacks'
import { stillNow } from '../lib/efficient'
import { BOOT_STEPS, useBoot } from '../state/boot'
import { useLibrary } from '../state/library'
import { t } from '../lib/i18n'

/** However quick the launch, the splash stays this long, so it never just flickers. */
const MIN_SHOWN_MS = 1500
/** The fade out, matching `.splash.out` in splash.css (no motion: the shutter's stand-in). */
const FADE_MS = 500

const reducedMotion = (): boolean =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/**
 * The launch splash, from the brand kit: the aperture turning over the
 * ambient light, the wordmark settling in, and a lit hairline filling as the
 * engine, the index and the last folder come up. It leaves once they have
 * (an engine that failed to start ends it too; the banner then says why),
 * through the shutter: the blades close over it, the app is swapped in at
 * the shut frame, and they open onto it (the motion kit's app launch). With
 * no motion (reduced, or Playroom behind another app) it fades instead.
 */
export function Splash(): React.JSX.Element | null {
  const finished = useBoot((s) => s.finished)
  const ended = useBoot((s) => s.ended)
  const version = useLibrary((s) => s.engine?.version)
  // in → shutter (closing over it) → open (the app under the opening blades) → gone; or in → out (fading) → gone.
  const [phase, setPhase] = useState<'in' | 'shutter' | 'open' | 'out' | 'gone'>('in')
  const [shownAt] = useState(() => performance.now())
  const shutter = useRef<PixlAperture>(null)
  // The shutter waits opened past the window's edges, out of sight.
  useLayoutEffect(() => {
    const o = shutter.current
    if (o) void o.setT(-o.openPast, 0)
  }, [])
  useEffect(() => {
    if (!ended) return
    let fade: ReturnType<typeof setTimeout> | undefined
    const wait = Math.max(0, MIN_SHOWN_MS - (performance.now() - shownAt))
    const leave = setTimeout(() => {
      const o = shutter.current
      if (!o || stillNow() || reducedMotion()) {
        setPhase('out')
        fade = setTimeout(() => setPhase('gone'), FADE_MS)
        return
      }
      setPhase('shutter')
      void o.click(() => setPhase('open')).then(() => setPhase('gone'))
    }, wait)
    return () => {
      clearTimeout(leave)
      clearTimeout(fade)
    }
  }, [ended, shownAt])
  if (phase === 'gone') return null
  const status = t(
    ended ? 'Ready' : (BOOT_STEPS.find((s) => !finished.includes(s.id))?.label ?? 'Ready')
  )
  const share = ended ? 1 : finished.length / (BOOT_STEPS.length + 1)
  return (
    <>
      {phase !== 'open' && (
        <div className={`splash${phase === 'out' ? ' out' : ''}`} role="status" aria-live="polite">
          <div className="ambient" aria-hidden>
            <CssAmbient intensity={0.8} />
            <div className="vignette" />
          </div>
          <div className="splash-center">
            <div className="splash-mark">
              <Aperture size={200} tone="glass" glow />
            </div>
            <span className="wordmark splash-word">
              PIXL <em>PLAYROOM</em>
            </span>
          </div>
          <div className="splash-foot">
            <div className="splash-track">
              <div className="splash-fill" style={{ width: `${share * 100}%` }} />
            </div>
            <div className="splash-row">
              <span className="micro splash-status">
                <i className="status-dot busy" />
                <span>{status}</span>
              </span>
              <span className="splash-version">PIXL Engine{version ? ` ${version}` : ''}</span>
            </div>
          </div>
        </div>
      )}
      <pixl-aperture
        ref={shutter}
        mode="overlay"
        state="idle"
        class="splash-shutter"
        aria-hidden="true"
      />
    </>
  )
}
