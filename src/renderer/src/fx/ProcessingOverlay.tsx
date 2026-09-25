import { useEffect, useState } from 'react'
import { useBusy } from '../state/busy'
import { useDevelop } from '../state/develop'
import { ProgressRing, Sphere } from './index'

/** Work shorter than this never shows the sphere at all. */
const SHOW_AFTER_MS = 250

/**
 * The processing sphere over the loupe while something the user waits on is
 * running — a photo opening, auto tone, auto white balance, a noise
 * measurement. It never takes the pointer, so nothing under it is disturbed.
 */
export function ProcessingOverlay(): React.JSX.Element | null {
  const job = useBusy((s) => s.jobs.filter((j) => j.scope === 'loupe').at(-1) ?? null)
  const loading = useDevelop((s) => s.loading)
  const name = useDevelop((s) => s.session?.item.name ?? null)
  const busy = job !== null || loading
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!busy) {
      const t = setTimeout(() => setShown(false), 0)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setShown(true), loading ? 0 : SHOW_AFTER_MS)
    return () => clearTimeout(t)
  }, [busy, loading])
  if (!busy || !shown) return null
  const title = job?.title ?? 'Developing'
  const detail = job?.detail ?? (loading ? 'Reading the file and building proxies' : name)
  const progress = job?.progress ?? null
  return (
    <div className="proc" role="status" aria-live="polite">
      <div className="sphere-wrap">
        <Sphere />
        <ProgressRing progress={progress} />
      </div>
      <div className="proc-label">
        <span className="micro">{title}</span>
        {progress !== null ? (
          <span className="big t-num">
            {Math.round(progress * 100)}
            <small>%</small>
          </span>
        ) : null}
        {detail && <span className="proc-detail t-body">{detail}</span>}
      </div>
    </div>
  )
}
