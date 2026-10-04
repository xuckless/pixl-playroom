/**
 * Before and after an engine update: the photo's library thumbnail as the
 * engine before 0.17 made it (main/legacy.ts) beside the one the new engine
 * makes. Shown once on a photo's first opening after the update, and from
 * the Edit menu. The user can send feedback, or remove the preview (one, or
 * every one); an update after this one removes them anyway.
 */
import { useEffect, useState } from 'react'
import type { LegacyPreview } from '../../../shared/ipc'
import { Modal } from '../components/ui'
import { api } from '../lib/api'
import { openReport } from '../lib/report'
import { useLegacy } from '../state/legacy'
import { useLibrary } from '../state/library'

type Side = 'before' | 'after' | 'both'

export function LegacyCompareDialog(): React.JSX.Element | null {
  const key = useLegacy((s) => s.key)
  const setDialog = useLibrary((s) => s.setDialog)
  const item = useLibrary((s) => s.items.find((i) => i.key === key))
  const [preview, setPreview] = useState<LegacyPreview | null>(null)
  const [others, setOthers] = useState(0)
  const [side, setSide] = useState<Side>('both')
  /** The thumbnail the item had when this opened: the new one is another. */
  const [started] = useState(item?.thumbUrl ?? null)

  useEffect(() => {
    if (!key) return
    let live = true
    void api.legacy.get(key).then((p) => live && setPreview(p))
    void api.legacy.count().then((n) => live && setOthers(n))
    void api.legacy.seen(key).catch(() => undefined)
    return () => {
      live = false
    }
  }, [key])

  if (!key) return null
  const close = (): void => setDialog(null)
  const after = item?.thumbUrl ?? null
  const ready = !!preview && (preview.fresh || after !== started) && !!after
  const engine = preview?.engine ?? '0.16'
  const remove = async (): Promise<void> => {
    await api.legacy.remove(key)
    close()
  }
  const removeAll = async (): Promise<void> => {
    await api.legacy.removeAll()
    close()
  }

  return (
    <Modal
      title="Before and after the engine update"
      onClose={close}
      icon="info"
      className="legacy-compare"
      footer={
        <>
          <button
            title="Delete this photo’s old preview. It is not needed for anything else."
            onClick={() => void remove()}
          >
            Remove this preview
          </button>
          {others > 1 && (
            <button
              title="Delete every old preview. A later update removes them on its own."
              onClick={() => void removeAll()}
            >
              Remove all ({others})
            </button>
          )}
          <button
            onClick={() => {
              close()
              openReport()
            }}
          >
            Send feedback
          </button>
          <button className="primary" autoFocus onClick={close}>
            Done
          </button>
        </>
      }
    >
      <p className="lc-lead">
        Playroom’s engine now works in PixlRGB. Edits that act on the colour channels themselves
        (curves, colour mixing, per-channel gain, HSL) can look a little different from before.
        Left: this photo under the engine before ({engine}). Right: now.
      </p>
      <div className="seg lc-seg" role="group" aria-label="What to show">
        {(['both', 'before', 'after'] as Side[]).map((s) => (
          <button
            key={s}
            className={side === s ? 'on' : ''}
            aria-pressed={side === s}
            onClick={() => setSide(s)}
          >
            {s === 'both' ? 'Side by side' : s === 'before' ? `Before (${engine})` : 'After'}
          </button>
        ))}
      </div>
      <div className={`lc-stage lc-${side}`}>
        {!preview && <span className="lc-wait">No old preview is kept for this photo.</span>}
        {preview && !ready && <span className="lc-wait">Making the new thumbnail…</span>}
        {ready && side !== 'after' && (
          <figure>
            <img src={preview.url} alt={`Before, engine ${engine}`} draggable={false} />
            <figcaption>Before ({engine})</figcaption>
          </figure>
        )}
        {ready && side !== 'before' && (
          <figure>
            <img src={after!} alt="After, the current engine" draggable={false} />
            <figcaption>After</figcaption>
          </figure>
        )}
      </div>
      <p className="lc-note">
        These are the library’s small thumbnails; open the photo to see it at full size. Old
        previews are removed by the next update.
      </p>
    </Modal>
  )
}
