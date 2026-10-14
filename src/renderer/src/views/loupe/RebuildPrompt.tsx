/**
 * A photo edited with the earlier pipeline, opened where today's has a
 * newer develop (shared/rebuild.ts): a bar over the loupe offers to rebuild
 * it (main/rebuild.ts; a Version of it as it is kept first, the rebuild one
 * History step). "Not now" until it is opened again; "Don't ask" for good.
 */
import { useState } from 'react'
import type { RebuildReason } from '../../../../shared/rebuild'
import { errorText } from '../../lib/api'
import { rebuild, usePipeline } from '../../lib/pipeline'
import { t, tk } from '../../lib/i18n'
import { useDevelop } from '../../state/develop'
import { useLibrary } from '../../state/library'
import { useUi } from '../../state/ui'

const REASON: Record<RebuildReason, string> = {
  rawDenoise: tk('its RAW denoise'),
  denoise: tk('its AI Denoise steps'),
  staleSteps: tk('steps made on the earlier develop'),
  oldEnhance: tk('Enhance steps from before PIXL Enhance')
}

export function RebuildPrompt(): React.JSX.Element | null {
  const session = useDevelop((s) => s.session)
  const quiet = useUi((s) => (session ? s.rebuildQuiet.includes(session.key) : true))
  const ready = usePipeline((p) => p.pixlDemosaic || p.pixlEnhance)
  // "Not now" and a rebuild started: for this opening of the photo.
  const [shut, setShut] = useState<string | null>(null)
  const reasons = session?.rebuild ?? []
  if (!session || !ready || quiet || reasons.length === 0 || shut === session.key) return null
  const go = (): void => {
    setShut(session.key)
    void rebuild([session.key]).catch((err) => useLibrary.getState().say(errorText(err), 'error'))
  }
  return (
    <div className="rebuild-prompt" role="status">
      <span className="rebuild-text">
        <strong>{t('Edited with an earlier develop')}</strong>
        <span>{reasons.map((r) => t(REASON[r])).join(' · ')}</span>
      </span>
      <span className="rebuild-acts">
        <button className="sm primary" onClick={go}>
          {t('Rebuild')}
        </button>
        <button className="sm ghost" onClick={() => setShut(session.key)}>
          {t('Not now')}
        </button>
        <button className="sm ghost" onClick={() => useUi.getState().setRebuildQuiet(session.key)}>
          {t('Don’t ask for this photo')}
        </button>
      </span>
    </div>
  )
}
