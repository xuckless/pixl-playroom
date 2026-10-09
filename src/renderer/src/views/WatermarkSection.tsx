/**
 * The export dialog's Watermark section: a PNG, where it sits (an anchor,
 * an inset), how big, how strong and how it blends, with a preview on the
 * first photo's thumbnail placed by the same arithmetic the export uses
 * (`shared/watermark.ts`).
 */
import { useEffect, useState } from 'react'
import type { WatermarkFile } from '../../../shared/ipc'
import {
  placeMark,
  WATERMARK_ANCHORS,
  type WatermarkAnchor,
  type WatermarkBlend,
  type WatermarkSettings
} from '../../../shared/watermark'
import { InfoTip } from '../components/InfoTip'
import { Card, Slider } from '../components/ui'
import { api, errorText } from '../lib/api'
import { t, tk } from '../lib/i18n'

const ANCHOR_TITLE: Record<WatermarkAnchor, string> = {
  tl: tk('Top left'),
  t: tk('Top'),
  tr: tk('Top right'),
  l: tk('Left'),
  c: tk('Centre'),
  r: tk('Right'),
  bl: tk('Bottom left'),
  b: tk('Bottom'),
  br: tk('Bottom right')
}

const BLEND_CSS: Record<WatermarkBlend, React.CSSProperties['mixBlendMode']> = {
  Normal: 'normal',
  Multiply: 'multiply',
  Screen: 'screen'
}

export function WatermarkSection({
  value: w,
  onChange,
  thumbUrl
}: {
  value: WatermarkSettings
  onChange: (w: WatermarkSettings) => void
  /** The first photo's thumbnail, to preview on. */
  thumbUrl: string | null
}): React.JSX.Element {
  const [read, setRead] = useState<WatermarkFile | null>(null)
  // Only the file the settings name (a removed or changed one is not shown).
  const file = read && read.path === w.path ? read : null
  const [error, setError] = useState<string | null>(null)
  const [thumb, setThumb] = useState<{ w: number; h: number } | null>(null)
  const set = (p: Partial<WatermarkSettings>): void => onChange({ ...w, ...p })

  // The chosen PNG (a preset's, or the last export's), read again.
  useEffect(() => {
    if (!w.path || read?.path === w.path) return
    let live = true
    api.export.readWatermark(w.path).then(
      (f) => {
        if (!live) return
        setRead(f)
        setError(null)
      },
      (e) => live && setError(errorText(e))
    )
    return () => {
      live = false
    }
  }, [w.path, read?.path])

  const choose = async (): Promise<void> => {
    try {
      const f = await api.export.chooseWatermark()
      if (!f) return
      setRead(f)
      setError(null)
      onChange({ ...w, path: f.path, enabled: true })
    } catch (e) {
      setError(errorText(e))
    }
  }

  // Placed on the thumbnail as on the export: fractions of the picture.
  const mark = file && thumb ? placeMark(w, thumb.w, thumb.h, file.width, file.height) : null

  return (
    <Card id="export.watermark" title={t('Watermark')} defaultOpen={w.enabled || !!w.path}>
      <label className="check">
        <input
          type="checkbox"
          checked={w.enabled}
          disabled={!w.path}
          onChange={(e) => set({ enabled: e.target.checked })}
        />{' '}
        {t('Add a watermark')}
      </label>
      <div className="wm-file">
        <span className="muted small" title={w.path ?? undefined}>
          {w.path ? w.path.split(/[\\/]/).pop() : t('No PNG chosen')}
        </span>
        <button className="sm" onClick={() => void choose()}>
          {w.path ? t('Change…') : t('Choose PNG…')}
        </button>
        {w.path && (
          <button
            className="sm ghost"
            onClick={() => onChange({ ...w, path: null, enabled: false })}
          >
            {t('Remove')}
          </button>
        )}
      </div>
      {error && <p className="error small">{error}</p>}
      {w.path && (
        <div className="wm-body">
          <div className="wm-preview" aria-label={t('Preview')}>
            {thumbUrl ? (
              <img
                src={thumbUrl}
                alt=""
                draggable={false}
                onLoad={(e) =>
                  setThumb({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
                }
              />
            ) : (
              <div className="wm-blank" />
            )}
            {file && mark && thumb && w.enabled && (
              <img
                className="wm-mark"
                src={file.url}
                alt=""
                draggable={false}
                style={{
                  left: `${(mark.x / thumb.w) * 100}%`,
                  top: `${(mark.y / thumb.h) * 100}%`,
                  width: `${(mark.width / thumb.w) * 100}%`,
                  opacity: w.opacity / 100,
                  mixBlendMode: BLEND_CSS[w.blend]
                }}
              />
            )}
          </div>
          <div className="wm-controls">
            <div className="wm-anchors" role="radiogroup" aria-label={t('Position')}>
              {WATERMARK_ANCHORS.map((a) => (
                <button
                  key={a}
                  role="radio"
                  aria-checked={w.anchor === a}
                  className={w.anchor === a ? 'on' : ''}
                  title={t(ANCHOR_TITLE[a])}
                  onClick={() => set({ anchor: a })}
                >
                  <i />
                </button>
              ))}
            </div>
            <Slider
              label={t('Size')}
              value={w.size}
              min={2}
              max={100}
              def={20}
              format={(v) => `${Math.round(v)}%`}
              title={t("The mark's width, as a share of the picture's shorter edge")}
              onChange={(size) => set({ size })}
              onCommit={() => undefined}
            />
            <Slider
              label={t('Inset')}
              value={w.inset}
              min={0}
              max={25}
              step={0.5}
              def={3}
              format={(v) => `${v.toFixed(1)}%`}
              title={t("From the nearest edges, as a share of the picture's shorter edge")}
              onChange={(inset) => set({ inset })}
              onCommit={() => undefined}
            />
            <Slider
              label={t('Opacity')}
              value={w.opacity}
              min={0}
              max={100}
              def={80}
              format={(v) => `${Math.round(v)}%`}
              onChange={(opacity) => set({ opacity })}
              onCommit={() => undefined}
            />
            <label
              className="field wm-blend"
              title={t('Multiply suits a dark mark on light pictures, Screen a light one on dark')}
            >
              <span>{t('Blend')}</span>
              <select
                value={w.blend}
                onChange={(e) => set({ blend: e.target.value as WatermarkBlend })}
              >
                <option value="Normal">{t('Normal')}</option>
                <option value="Multiply">{t('Multiply · darkens')}</option>
                <option value="Screen">{t('Screen · lightens')}</option>
              </select>
            </label>
          </div>
        </div>
      )}
      {file && (
        <p className="muted small">
          {file.width} × {file.height} PNG
          <InfoTip
            label={t('Watermark')}
            tip={{
              what: t('Laid on after the crop and resize, at the size the picture is exported.'),
              expect: t('It stays sharp at any size and is never graded with the photo.')
            }}
          />
        </p>
      )}
    </Card>
  )
}
