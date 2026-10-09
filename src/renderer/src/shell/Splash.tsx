import { useEffect, useState } from 'react'
import { Mark } from '../components/Mark'
import { CssAmbient } from '../fx/CssFallbacks'
import { BOOT_STEPS, useBoot } from '../state/boot'
import { useLibrary } from '../state/library'
import { t } from '../lib/i18n'

/** However quick the launch, the splash stays this long, so it never just flickers. */
const MIN_SHOWN_MS = 1500
/** The fade out, matching `.splash.out` in splash.css. */
const FADE_MS = 500

/**
 * The launch splash, from the brand kit: the mark breathing over the ambient
 * light, the wordmark settling in, and a lit hairline filling as the engine,
 * the index and the last folder come up. It leaves once they have (an engine
 * that failed to start ends it too; the banner then says why).
 */
export function Splash(): React.JSX.Element | null {
  const finished = useBoot((s) => s.finished)
  const ended = useBoot((s) => s.ended)
  const version = useLibrary((s) => s.engine?.version)
  const [phase, setPhase] = useState<'in' | 'out' | 'gone'>('in')
  const [shownAt] = useState(() => performance.now())
  useEffect(() => {
    if (!ended) return
    const wait = Math.max(0, MIN_SHOWN_MS - (performance.now() - shownAt))
    const out = setTimeout(() => setPhase('out'), wait)
    const gone = setTimeout(() => setPhase('gone'), wait + FADE_MS)
    return () => {
      clearTimeout(out)
      clearTimeout(gone)
    }
  }, [ended, shownAt])
  if (phase === 'gone') return null
  const status = t(
    ended ? 'Ready' : (BOOT_STEPS.find((s) => !finished.includes(s.id))?.label ?? 'Ready')
  )
  const share = ended ? 1 : finished.length / (BOOT_STEPS.length + 1)
  return (
    <div className={`splash${phase === 'out' ? ' out' : ''}`} role="status" aria-live="polite">
      <div className="ambient" aria-hidden>
        <CssAmbient intensity={0.8} />
        <div className="vignette" />
      </div>
      <div className="splash-center">
        <div className="splash-mark">
          <div className="splash-breathe">
            <Mark size={200} glow drift label="Pixl Playroom" />
          </div>
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
  )
}
