/**
 * Where an AI tool meets a photo edited in HDR (AI Denoise, AI Remove, baked
 * heals, Enhance): those write into the photo's pixels, which an HDR photo
 * cannot take yet. Says so, and on a gain-map photo offers the SDR editing
 * space (views/EditingSpace.tsx).
 */
import { useDevelop } from '../state/develop'
import { useLibrary } from '../state/library'
import { t } from '../lib/i18n'

export function HdrAiNote({
  offer = true
}: {
  /** Offer Edit as SDR (not where the tool is held for everyone anyway: Enhance). */
  offer?: boolean
}): React.JSX.Element | null {
  const isHdr = useDevelop((s) => s.session?.isHdr === true)
  const switchable = useDevelop((s) => !!s.session?.info.gain_map)
  const setDialog = useLibrary((s) => s.setDialog)
  if (!isHdr) return null
  return (
    <div className="hdr-ai-note">
      <p className="small">
        {switchable
          ? t(
              'We’re working on bringing AI tools to HDR photos. For now they need the SDR editing space: to keep this photo in HDR, use the tools that don’t use AI.'
            )
          : t(
              'We’re working on bringing AI tools to HDR photos. For now they work on SDR photos only.'
            )}
      </p>
      {switchable && offer && (
        <button className="sm" onClick={() => setDialog('editing-space')}>
          {t('Edit as SDR…')}
        </button>
      )}
    </div>
  )
}
