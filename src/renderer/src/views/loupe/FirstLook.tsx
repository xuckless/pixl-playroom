import { useEffect } from 'react'
import { FIRST_LOOK_FADE_MS } from '../../lib/firstlook'
import { useDevelop } from '../../state/develop'
import { Spinner } from '../../fx'
import { t } from '../../lib/i18n'

/**
 * The photo while it opens (lib/firstlook.ts): its thumbnail or an unedited
 * RAW's embedded preview, fitted as the picture will be, marked as not yet
 * developed; it fades out over the develop's first picture.
 */
export function FirstLook(): React.JSX.Element | null {
  const look = useDevelop((s) => s.firstLook)
  const gone = useDevelop((s) => s.firstLookGone)
  useEffect(() => {
    if (!look?.leaving) return
    const timer = setTimeout(() => gone(look.key), FIRST_LOOK_FADE_MS)
    return () => clearTimeout(timer)
  }, [look, gone])
  if (!look) return null
  return (
    <div className={`first-look${look.leaving ? ' leaving' : ''}`} aria-hidden={look.leaving}>
      <img src={look.url} alt="" draggable={false} />
      <span
        className="hud first-look-chip"
        role="status"
        title={
          look.from === 'preview'
            ? t('The camera’s own preview, shown until PIXL’s develop is ready')
            : t('The library thumbnail, shown until the develop is ready')
        }
      >
        <span className="hud-item">
          <Spinner size={14} />
          {t('Developing…')}
        </span>
      </span>
    </div>
  )
}
