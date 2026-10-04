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

const ANCHOR_TITLE: Record<WatermarkAnchor, string> = {
  tl: 'Top left',
  t: 'Top',
  tr: 'Top right',
  l: 'Left',
  c: 'Centre',
  r: 'Right',
  bl: 'Bottom left',
  b: 'Bottom',
  br: 'Bottom right'
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
    <Card id="export.watermark" title="Watermark" defaultOpen={w.enabled || !!w.path}>
      <label className="check">
        <input
          type="checkbox"
          checked={w.enabled}
          disabled={!w.path}
          onChange={(e) => set({ enabled: e.target.checked })}
        />{' '}
        Add a watermark
      </label>
      <div className="wm-file">
        <span className="muted small" title={w.path ?? undefined}>
          {w.path ? w.path.split(/[\\/]/).pop() : 'No PNG chosen'}
        </span>
        <button className="sm" onClick={() => void choose()}>
          {w.path ? 'Change…' : 'Choose PNG…'}
        </button>
        {w.path && (
          <button
            className="sm ghost"
            onClick={() => onChange({ ...w, path: null, enabled: false })}
          >
            Remove
          </button>
        )}
      </div>
      {error && <p className="error small">{error}</p>}
      {w.path && (
        <div className="wm-body">
          <div className="wm-preview" aria-label="Preview">
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
            <div className="wm-anchors" role="radiogroup" aria-label="Position">
              {WATERMARK_ANCHORS.map((a) => (
                <button
                  key={a}
                  role="radio"
                  aria-checked={w.anchor === a}
                  className={w.anchor === a ? 'on' : ''}
                  title={ANCHOR_TITLE[a]}
                  onClick={() => set({ anchor: a })}
                >
                  <i />
                </button>
              ))}
            </div>
            <Slider
              label="Size"
              value={w.size}
              min={2}
              max={100}
              def={20}
              format={(v) => `${Math.round(v)}%`}
              title="The mark's width, as a share of the picture's shorter edge"
              onChange={(size) => set({ size })}
              onCommit={() => undefined}
            />
            <Slider
              label="Inset"
              value={w.inset}
              min={0}
              max={25}
              step={0.5}
              def={3}
              format={(v) => `${v.toFixed(1)}%`}
              title="From the nearest edges, as a share of the picture's shorter edge"
              onChange={(inset) => set({ inset })}
              onCommit={() => undefined}
            />
            <Slider
              label="Opacity"
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
              title="Multiply suits a dark mark on light pictures, Screen a light one on dark"
            >
              <span>Blend</span>
              <select
                value={w.blend}
                onChange={(e) => set({ blend: e.target.value as WatermarkBlend })}
              >
                <option value="Normal">Normal</option>
                <option value="Multiply">Multiply · darkens</option>
                <option value="Screen">Screen · lightens</option>
              </select>
            </label>
          </div>
        </div>
      )}
      {file && (
        <p className="muted small">
          {file.width} × {file.height} PNG
          <InfoTip
            label="Watermark"
            tip={{
              what: 'Laid on after the crop and resize, at the size the picture is exported.',
              expect: 'It stays sharp at any size and is never graded with the photo.'
            }}
          />
        </p>
      )}
    </Card>
  )
}
